'use strict';
const express = require('express');
const db      = require('../db');
const requireAuth = require('../middleware/auth');
const { isStaff } = require('../constants');
const { TEMPLATE_LIMITS } = require('../constants/validationLimits');

const router = express.Router();
router.use(requireAuth);

// FIX [AUDIT]: лимиты на items — без них авторизованный пользователь сохраняет
// 9MB JSON-шаблон. При следующей синхронизации он рассылается через SSE всем клиентам.
function validateItems(items, res) {
  if (!Array.isArray(items)) {
    res.status(400).json({ error: 'items must be an array' });
    return false;
  }
  if (items.length > TEMPLATE_LIMITS.maxItems) {
    res.status(400).json({ error: `Too many templates (max ${TEMPLATE_LIMITS.maxItems})` });
    return false;
  }
  const serialized = JSON.stringify(items);
  if (serialized.length > TEMPLATE_LIMITS.maxPayloadBytes) {
    res.status(400).json({ error: `Templates payload too large (max ${TEMPLATE_LIMITS.maxPayloadBytes / 1000}KB)` });
    return false;
  }
  // Проверяем каждое поле шаблона
  for (const item of items) {
    if (item.name && typeof item.name === 'string' && item.name.length > TEMPLATE_LIMITS.name) {
      res.status(400).json({ error: `Template name too long (max ${TEMPLATE_LIMITS.name} chars)` });
      return false;
    }
  }
  return true;
}

function canReadTemplates(user, targetUid) {
  return user.uid === targetUid || isStaff(user.role);
}

function canWriteTemplates(user, targetUid) {
  return user.uid === targetUid || user.role === 'admin';
}

// ─── GET /api/templates/:uid ──────────────────────────────────────────────────

router.get('/:uid', async (req, res, next) => {
  try {
    if (!canReadTemplates(req.user, req.params.uid)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
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
    const { uid, items } = req.body;

    if (!canWriteTemplates(req.user, uid)) {
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
