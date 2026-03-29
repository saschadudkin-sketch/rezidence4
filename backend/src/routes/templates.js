'use strict';
const express = require('express');
const db      = require('../db');
const requireAuth = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// FIX [AUDIT]: лимиты на items — без них авторизованный пользователь сохраняет
// 9MB JSON-шаблон. При следующей синхронизации он рассылается через SSE всем клиентам.
const MAX_TEMPLATE_ITEMS   = 200;   // максимум шаблонов на пользователя
const MAX_TEMPLATE_PAYLOAD = 50_000; // байт — ~50KB для JSONB
const MAX_TEMPLATE_NAME    = 100;   // символов на название шаблона

function validateItems(items, res) {
  if (!Array.isArray(items)) {
    res.status(400).json({ error: 'items must be an array' });
    return false;
  }
  if (items.length > MAX_TEMPLATE_ITEMS) {
    res.status(400).json({ error: `Too many templates (max ${MAX_TEMPLATE_ITEMS})` });
    return false;
  }
  const serialized = JSON.stringify(items);
  if (serialized.length > MAX_TEMPLATE_PAYLOAD) {
    res.status(400).json({ error: `Templates payload too large (max ${MAX_TEMPLATE_PAYLOAD / 1000}KB)` });
    return false;
  }
  // Проверяем каждое поле шаблона
  for (const item of items) {
    if (item.name && typeof item.name === 'string' && item.name.length > MAX_TEMPLATE_NAME) {
      res.status(400).json({ error: `Template name too long (max ${MAX_TEMPLATE_NAME} chars)` });
      return false;
    }
  }
  return true;
}

// ─── GET /api/templates/:uid ──────────────────────────────────────────────────

router.get('/:uid', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT items FROM templates WHERE uid=$1`,
      [req.params.uid],
    );
    res.json(rows[0]?.items || []);
  } catch (err) { next(err); }
});

// ─── POST /api/templates ──────────────────────────────────────────────────────

router.post('/', async (req, res, next) => {
  try {
    const { uid: callerUid, role } = req.user;
    const { uid, items } = req.body;

    if (callerUid !== uid && role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (!validateItems(items, res)) return;

    await db.query(
      `INSERT INTO templates(uid, items) VALUES($1,$2)
       ON CONFLICT (uid) DO UPDATE SET items=EXCLUDED.items`,
      [uid, JSON.stringify(items)],
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
