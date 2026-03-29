'use strict';
const express = require('express');
const db      = require('../db');
const requireAuth = require('../middleware/auth');
const { isStaff } = require('../constants');

const router = express.Router();
router.use(requireAuth);

// FIX [AUDIT]: лимиты на items — без них авторизованный пользователь сохраняет
// 9MB JSON-массив разрешений. При следующей синхронизации он рассылается через SSE.
const MAX_PERM_ITEMS   = 500;    // максимум записей в одном списке (visitors или workers)
const MAX_PERM_PAYLOAD = 50_000; // байт — ~50KB для JSONB
const MAX_PERM_NAME    = 200;    // символов на имя в списке
const MAX_PERM_PHONE   = 30;     // символов на телефон

function validatePermsItems(items, res) {
  if (!Array.isArray(items)) {
    res.status(400).json({ error: 'items must be an array' });
    return false;
  }
  if (items.length > MAX_PERM_ITEMS) {
    res.status(400).json({ error: `Too many permission entries (max ${MAX_PERM_ITEMS})` });
    return false;
  }
  const serialized = JSON.stringify(items);
  if (serialized.length > MAX_PERM_PAYLOAD) {
    res.status(400).json({ error: `Permissions payload too large (max ${MAX_PERM_PAYLOAD / 1000}KB)` });
    return false;
  }
  // Проверяем каждую запись
  for (const item of items) {
    if (item.name && typeof item.name === 'string' && item.name.length > MAX_PERM_NAME) {
      res.status(400).json({ error: `Permission name too long (max ${MAX_PERM_NAME} chars)` });
      return false;
    }
    if (item.phone && typeof item.phone === 'string' && item.phone.length > MAX_PERM_PHONE) {
      res.status(400).json({ error: `Permission phone too long (max ${MAX_PERM_PHONE} chars)` });
      return false;
    }
  }
  return true;
}

// ─── GET /api/perms/:uid ──────────────────────────────────────────────────────
// FIX [SEC]: добавлена авторизация — ранее любой аутентифицированный пользователь
// мог прочитать список посетителей/работников ЛЮБОГО другого пользователя.
// Теперь: только сам пользователь или персонал (staff) может читать чужие perms.
router.get('/:uid', async (req, res, next) => {
  try {
    const { uid: callerUid, role } = req.user;
    if (callerUid !== req.params.uid && !isStaff(role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { rows } = await db.query(
      `SELECT type, items FROM perms WHERE uid=$1`,
      [req.params.uid],
    );
    const out = { visitors: [], workers: [] };
    for (const r of rows) out[r.type] = r.items;
    res.json(out);
  } catch (err) { next(err); }
});

// ─── POST /api/perms ──────────────────────────────────────────────────────────

router.post('/', async (req, res, next) => {
  try {
    const { uid: callerUid, role } = req.user;
    const { uid, items, type } = req.body;  // FIX [DATA-2]: type передаётся явно

    if (callerUid !== uid && role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // FIX [DATA-2]: валидация type — пустой массив больше не затирает workers
    if (!['visitors', 'workers'].includes(type)) {
      return res.status(400).json({ error: "Invalid type. Must be 'visitors' or 'workers'" });
    }

    if (!validatePermsItems(items, res)) return;

    await db.query(
      `INSERT INTO perms(uid, type, items) VALUES($1,$2,$3)
       ON CONFLICT (uid, type) DO UPDATE SET items=EXCLUDED.items`,
      [uid, type, JSON.stringify(items)],
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
