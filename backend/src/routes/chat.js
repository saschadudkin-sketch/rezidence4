'use strict';
const express   = require('express');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = rateLimit;
const db        = require('../db');
const requireAuth = require('../middleware/auth');
const sse       = require('../sse');
const { CHAT_LIMITS } = require('../constants/validationLimits');

const router = express.Router();
router.use(requireAuth);

// FIX [AUDIT-2]: chatLimiter перенесён ВНУТРЬ роутера — на конкретный POST /messages.
//
// ПРОБЛЕМА: в index.js лимитер был применён только к legacy-пути /api/chat/messages:
//   app.post('/api/chat/messages', chatLimiter)   ← работало
//   app.use('/api/v1/chat', chatRouter)            ← chatLimiter НЕ применялся
//
// Клиенты, использующие /api/v1/ (все новые), обходили ограничение 30 msg/min.
// Перенос в роутер гарантирует применение на ОБА пути — /api/chat и /api/v1/chat.
const chatMessagesLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много сообщений. Подождите.' },
});

// FIX [SEC]: rate limit на SSE /stream — без него один аккаунт мог открывать
// сотни соединений в цикле (connect/disconnect), создавая нагрузку на сервер.
// Ключ — по uid пользователя: MAX_CONNECTIONS_PER_USER=5 ограничивает параллельно,
// а этот лимитер ограничивает частоту ПОДКЛЮЧЕНИЙ (reconnect storms).
const sseConnectLimiter = rateLimit({
  windowMs: 60_000,
  max: 20, // 20 подключений в минуту на пользователя
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много SSE-подключений. Подождите.' },
  keyGenerator: (req) => req.user?.uid || ipKeyGenerator(req),
});

// FIX: поддерживаем UUID и legacy/string id, чтобы не ломать существующий чат,
// но отсекаем очевидный мусор и чрезмерно длинные значения.
const MSG_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MSG_SAFE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
function validateMsgId(req, res, next) {
  const id = String(req.params.id || '');
  if (!MSG_UUID_RE.test(id) && !MSG_SAFE_ID_RE.test(id)) {
    return res.status(400).json({ error: 'Invalid message id format' });
  }
  next();
}

function fmt(m) {
  return {
    id:        m.id,
    uid:       m.uid,
    name:      m.name,
    role:      m.role,
    text:      m.text,
    photo:     m.photo,
    replyTo:   m.reply_to,
    reactions: m.reactions || {},
    edited:    m.edited,
    at:        m.at,
  };
}

// ─── GET /api/chat/messages ───────────────────────────────────────────────────
// FIX [AUDIT-6]: убран хардкод LIMIT 200.
// Добавлена cursor-based пагинация: ?limit=N&before=<message_id>
//   - limit: количество сообщений (1-100, по умолчанию 60)
//   - before: id сообщения — вернуть сообщения СТАРШЕ этого (для догрузки истории)
//   - Без before — вернуть последние N сообщений (первая загрузка)
// Ответ: { messages: [...], hasMore: bool }
//   hasMore=true означает что в истории есть более старые сообщения

router.get('/messages', async (req, res, next) => {
  try {
    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit) || 60));
    const before = req.query.before || null; // id сообщения-курсора
    const search = (req.query.search || '').trim().slice(0, 200); // КРИТ-2: full-history search

    let rows;

    if (search) {
      // Full-history search: ignore cursor pagination, return matching messages newest-first
      const { rows: r } = await db.query(
        `SELECT id, uid, name, role, text, photo, reply_to, reactions, edited, at
         FROM chat_messages
         WHERE text ILIKE $1
         ORDER BY at DESC, id DESC
         LIMIT $2`,
        [`%${search}%`, limit + 1],
      );
      rows = r;
      const hasMore = rows.length > limit;
      if (hasMore) rows = rows.slice(0, limit);
      return res.json({ messages: rows.map(fmt).reverse(), hasMore });
    }

    if (before) {
      // Догрузка истории: сообщения СТАРШЕ курсора
      // FIX [AUDIT-3 #9]: составной курсор (at, id) вместо только at.
      // При одновременных сообщениях (одинаковый timestamp) курсор по at
      // пропускал одно из сообщений. Составной индекс (at DESC, id DESC) решает.
      const { rows: r } = await db.query(
        `SELECT id, uid, name, role, text, photo, reply_to, reactions, edited, at
         FROM chat_messages
         WHERE (at, id) < (
           SELECT at, id FROM chat_messages WHERE id = $1
         )
         ORDER BY at DESC, id DESC
         LIMIT $2`,
        [before, limit + 1],
      );
      rows = r;
    } else {
      // Первая загрузка: последние N сообщений
      const { rows: r } = await db.query(
        `SELECT id, uid, name, role, text, photo, reply_to, reactions, edited, at
         FROM chat_messages
         ORDER BY at DESC
         LIMIT $1`,
        [limit + 1],
      );
      rows = r;
    }

    const hasMore = rows.length > limit;
    if (hasMore) rows = rows.slice(0, limit);

    // Возвращаем в хронологическом порядке (старые → новые)
    res.json({ messages: rows.map(fmt).reverse(), hasMore });
  } catch (err) { next(err); }
});

// ─── POST /api/chat/messages ──────────────────────────────────────────────────

function isLocalUploadPhotoUrl(photo) {
  if (typeof photo !== 'string') return false;
  if (photo.startsWith('/uploads/')) return true;

  const backendUrl = process.env.BACKEND_URL;
  if (!backendUrl) return false;

  try {
    const expectedPrefix = new URL('/uploads/', backendUrl).toString();
    return photo.startsWith(expectedPrefix);
  } catch {
    return false;
  }
}

router.post('/messages', chatMessagesLimiter, async (req, res, next) => {
  try {
    const { uid, name, role } = req.user;
    const { id, text, photo, replyTo } = req.body;

    if (!id) return res.status(400).json({ error: 'id required' });

    if (!MSG_UUID_RE.test(id) && !MSG_SAFE_ID_RE.test(id)) {
      return res.status(400).json({ error: 'Invalid message id format' });
    }

    // FIX [SECURITY]: валидация replyTo — ограничиваем размер JSONB поля.
    // Без проверки пользователь мог сохранить произвольный JSONB (1MB+) в reply_to,
    // что нагружает БД и увеличивает размер SSE-broadcast всем клиентам.
    if (replyTo !== undefined && replyTo !== null) {
      if (typeof replyTo !== 'object' || Array.isArray(replyTo)) {
        return res.status(400).json({ error: 'replyTo must be an object' });
      }
      const serialized = JSON.stringify(replyTo);
      if (serialized.length > 1024) {
        return res.status(400).json({ error: 'replyTo too large (max 1KB)' });
      }
    }

    // FIX [BUG-2]: валидация содержимого — предотвращаем DoS через огромные сообщения
    if (!text && !photo) {
      return res.status(400).json({ error: 'text or photo required' });
    }
    if (text !== undefined && text !== null) {
      if (typeof text !== 'string') {
        return res.status(400).json({ error: 'text must be a string' });
      }
      if (text.length > CHAT_LIMITS.text) {
        return res.status(400).json({ error: `text too long (max ${CHAT_LIMITS.text} chars)` });
      }
    }
    if (photo !== undefined && photo !== null) {
      if (typeof photo !== 'string' || photo.length > CHAT_LIMITS.photoUrl) {
        return res.status(400).json({ error: 'invalid photo URL' });
      }
      if (!isLocalUploadPhotoUrl(photo)) {
        return res.status(400).json({ error: 'photo must be a local upload URL' });
      }
    }

    const { rows } = await db.query(
      `INSERT INTO chat_messages(id, uid, name, role, text, photo, reply_to)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [id, uid, name, role, text || null, photo || null, replyTo || null],
    );

    const msg = fmt(rows[0]);
    sse.broadcastChatMessage(msg);
    res.status(201).json(msg);
  } catch (err) { next(err); }
});

// ─── PATCH /api/chat/messages/:id ────────────────────────────────────────────

router.patch('/messages/:id', validateMsgId, async (req, res, next) => {
  try {
    const { uid, role } = req.user;
    const { id }        = req.params;
    const { text, reactions } = req.body;

    // Валидация reactions ДО транзакции — ранний выход при плохих данных
    if (reactions !== undefined) {
      if (typeof reactions !== 'object' || Array.isArray(reactions) || reactions === null) {
        return res.status(400).json({ error: 'reactions must be a plain object' });
      }
      const reactionKeys = Object.keys(reactions);
      if (reactionKeys.length > 20) {
        return res.status(400).json({ error: 'Too many reaction types (max 20)' });
      }
      for (const [key, val] of Object.entries(reactions)) {
        if (typeof key !== 'string' || key.length > CHAT_LIMITS.reactionKey) {
          return res.status(400).json({ error: `Reaction key too long (max ${CHAT_LIMITS.reactionKey} chars)` });
        }
        // FIX [SEC]: reactions.value принимает ТОЛЬКО массив [uid_caller] или [].
        // Раньше JSONB || перезаписывал весь массив emoji — пользователь B мог
        // отправить { "👍": [] } и стереть реакции пользователя A.
        // Теперь: допустимо только [] (убрать свою реакцию) или [uid] (добавить свою).
        if (!Array.isArray(val) || val.length > 1) {
          return res.status(400).json({ error: 'Reaction value must be [] or [your_uid]' });
        }
        if (val.length === 1) {
          if (typeof val[0] !== 'string' || val[0].length > 64) {
            return res.status(400).json({ error: 'Invalid reaction uid format' });
          }
          if (val[0] !== uid) {
            return res.status(400).json({ error: 'You can only add your own uid to reactions' });
          }
        }
      }
    }

    // FIX [SEC]: используем транзакцию с FOR UPDATE для атомарного merge реакций.
    // SELECT FOR UPDATE блокирует строку — исключает race condition при concurrent реакциях.
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      // Блокируем строку и читаем текущие reactions
      const { rows: existing } = await client.query(
        `SELECT uid, reactions FROM chat_messages WHERE id=$1 FOR UPDATE`, [id],
      );
      if (!existing.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Not found' });
      }

      const fields = [];
      const vals   = [];
      let   i      = 1;

      if (text !== undefined) {
        // FIX [SECURITY]: валидация длины text при редактировании — ранее отсутствовала.
        // Admin или владелец могли обновить текст сообщения на произвольно длинную строку.
        if (typeof text !== 'string') {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'text must be a string' });
        }
        if (text.length > CHAT_LIMITS.text) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: `text too long (max ${CHAT_LIMITS.text} chars)` });
        }
        // Admin может редактировать любое сообщение
        if (existing[0].uid !== uid && role !== 'admin') {
          await client.query('ROLLBACK');
          return res.status(403).json({ error: 'Forbidden' });
        }
        fields.push(`text=$${i++}`);
        fields.push(`edited=TRUE`);
        vals.push(text);
      }

      if (reactions !== undefined) {
        // FIX [SEC]: атомарный per-user merge — пользователь добавляет/удаляет ТОЛЬКО свой uid.
        // Другие uid в массиве каждого emoji остаются нетронутыми.
        const current = existing[0].reactions || {};
        const merged  = { ...current };

        for (const [emoji, uidsPatch] of Object.entries(reactions)) {
          const arr = Array.isArray(current[emoji]) ? [...current[emoji]] : [];
          if (uidsPatch.includes(uid)) {
            // Добавить uid (идемпотентно)
            if (!arr.includes(uid)) arr.push(uid);
            merged[emoji] = arr;
          } else {
            // Удалить uid (идемпотентно)
            const filtered = arr.filter(u => u !== uid);
            if (filtered.length === 0) {
              delete merged[emoji]; // убираем пустой ключ
            } else {
              merged[emoji] = filtered;
            }
          }
        }

        fields.push(`reactions=$${i++}::jsonb`);
        vals.push(JSON.stringify(merged));
      }

      if (!fields.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Nothing to update' });
      }

      vals.push(id);
      const { rows } = await client.query(
        `UPDATE chat_messages SET ${fields.join(',')} WHERE id=$${i} RETURNING *`,
        vals,
      );

      await client.query('COMMIT');

      const msg = fmt(rows[0]);
      sse.broadcastChatUpdate(msg);
      res.json(msg);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) { next(err); }
});

// ─── DELETE /api/chat/messages/:id ───────────────────────────────────────────

router.delete('/messages/:id', validateMsgId, async (req, res, next) => {
  try {
    const { uid, role } = req.user;
    const { id }        = req.params;

    const { rows } = await db.query(
      `SELECT uid FROM chat_messages WHERE id=$1`, [id],
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    if (rows[0].uid !== uid && role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await db.query(`DELETE FROM chat_messages WHERE id=$1`, [id]);
    sse.broadcastChatDelete(id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── POST /api/chat/seen ──────────────────────────────────────────────────────

router.post('/seen', (req, res) => res.json({ ok: true })); // tracked client-side

// ─── GET /api/chat/stream — SSE ───────────────────────────────────────────────

router.get('/stream', sseConnectLimiter, (req, res) => {
  const { uid, role } = req.user; // FIX [SEC-2]: передаём роль в addClient

  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
  res.flushHeaders();

  // Send initial ping so client knows connection is alive
  res.write(': connected\n\n');

  sse.addClient(uid, res, role); // FIX [SEC-2]: role передаётся для фильтрации broadcast

  // Keepalive every 25s
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25000);

  req.on('close', () => {
    clearInterval(ping);
    sse.removeClient(uid, res);
  });
});

module.exports = router;
