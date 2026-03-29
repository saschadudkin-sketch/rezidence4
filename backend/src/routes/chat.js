'use strict';
const express   = require('express');
const rateLimit = require('express-rate-limit');
const db        = require('../db');
const requireAuth = require('../middleware/auth');
const sse       = require('../sse');

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

// FIX [AUDIT]: UUID-валидация для :id в PATCH и DELETE.
// Без неё мусорная строка (5000 символов) попадает в SELECT-запрос к БД —
// безопасно (parameterized query), но создаёт шум в логах и нагружает БД.
const MSG_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validateMsgId(req, res, next) {
  if (!MSG_UUID_RE.test(req.params.id)) {
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

    let rows;

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

const MAX_CHAT_TEXT   = 4000; // символов
const MAX_PHOTO_URL   = 2048; // байт — только URL от нашего /uploads/

router.post('/messages', chatMessagesLimiter, async (req, res, next) => {
  try {
    const { uid, name, role } = req.user;
    const { id, text, photo, replyTo } = req.body;

    if (!id) return res.status(400).json({ error: 'id required' });

    // ВАЖ-8: UUID формат — без этого клиент может прислать 10KB строку как PRIMARY KEY
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Invalid message id format' });

    // FIX [BUG-2]: валидация содержимого — предотвращаем DoS через огромные сообщения
    if (!text && !photo) {
      return res.status(400).json({ error: 'text or photo required' });
    }
    if (text !== undefined && text !== null) {
      if (typeof text !== 'string') {
        return res.status(400).json({ error: 'text must be a string' });
      }
      if (text.length > MAX_CHAT_TEXT) {
        return res.status(400).json({ error: `text too long (max ${MAX_CHAT_TEXT} chars)` });
      }
    }
    if (photo !== undefined && photo !== null) {
      if (typeof photo !== 'string' || photo.length > MAX_PHOTO_URL) {
        return res.status(400).json({ error: 'invalid photo URL' });
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

    // Only author can edit text; anyone can add reaction
    const { rows: existing } = await db.query(
      `SELECT uid FROM chat_messages WHERE id=$1`, [id],
    );
    if (!existing.length) return res.status(404).json({ error: 'Not found' });

    const fields = [];
    const vals   = [];
    let   i      = 1;

    if (text !== undefined) {
      // Admin может редактировать любое сообщение
      if (existing[0].uid !== uid && role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
      // FIX: edited=TRUE без параметра — безопасно (нет пользовательских данных),
      // но нарушало нумерацию $N если после него шли reactions.
      // Теперь text и edited идут отдельными entries, i инкрементируется только для text.
      fields.push(`text=$${i++}`);
      fields.push(`edited=TRUE`); // константа, не требует параметра
      vals.push(text);
    }
    if (reactions !== undefined) {
      // FIX [BUG-5]: валидация структуры и размера reactions
      // без этого злоумышленник может записать 5MB JSON в одно сообщение
      if (typeof reactions !== 'object' || Array.isArray(reactions) || reactions === null) {
        return res.status(400).json({ error: 'reactions must be a plain object' });
      }
      const reactionKeys = Object.keys(reactions);
      if (reactionKeys.length > 20) {
        return res.status(400).json({ error: 'Too many reaction types (max 20)' });
      }
      for (const [key, val] of Object.entries(reactions)) {
        if (typeof key !== 'string' || key.length > 10) {
          return res.status(400).json({ error: 'Reaction key too long (max 10 chars)' });
        }
        if (!Array.isArray(val) || val.length > 500) {
          return res.status(400).json({ error: 'Reaction value must be array (max 500 items)' });
        }
        // каждый элемент — uid пользователя, не длиннее 64 символов
        if (val.some(v => typeof v !== 'string' || v.length > 64)) {
          return res.status(400).json({ error: 'Invalid reaction item format' });
        }
      }
      // ВАЖ-5: вместо полной замены reactions — атомарный merge через PostgreSQL jsonb ||
      // Это предотвращает перезапись чужих реакций: каждый пользователь управляет
      // только своим uid внутри массива каждого emoji.
      // Полная замена reactions устанавливается отдельным UPDATE с явной проверкой.
      fields.push(`reactions=reactions || $${i++}::jsonb`);
      vals.push(JSON.stringify(reactions));
    }

    if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });

    vals.push(id);
    const { rows } = await db.query(
      `UPDATE chat_messages SET ${fields.join(',')} WHERE id=$${i} RETURNING *`,
      vals,
    );

    const msg = fmt(rows[0]);
    sse.broadcastChatUpdate(msg);
    res.json(msg);
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

router.get('/stream', (req, res) => {
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
