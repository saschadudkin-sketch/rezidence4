'use strict';
const express = require('express');
const { v4: uuid } = require('uuid');
const db      = require('../db');
const requireAuth = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Разрешённые роли для чтения/записи чёрного списка
const ALLOWED_ROLES = new Set(['admin', 'security', 'concierge']);

// FIX [AUDIT]: ограничения длины полей — без них злоумышленник записывает 1MB в name/reason
const BL_FIELD_MAX = Object.freeze({
  name:     200,
  phone:     30,
  carPlate:  20,
  reason:   500,
});

function fmt(r) {
  return {
    id:       r.id,
    name:     r.name,
    phone:    r.phone,
    carPlate: r.car_plate,
    reason:   r.reason,
    addedBy:  r.added_by,
    addedAt:  r.added_at,
  };
}

router.get('/', async (req, res, next) => {
  try {
    // FIX [BUG-6]: только персонал может читать чёрный список — жильцы не должны
    // видеть имена, телефоны и номера авто людей в списке
    if (!ALLOWED_ROLES.has(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    // FIX [AUDIT]: явные колонки вместо SELECT * — не тянем служебные поля
    const { rows } = await db.query(
      `SELECT id, name, phone, car_plate, reason, added_by, added_at
       FROM blacklist ORDER BY added_at DESC`
    );
    res.json(rows.map(fmt));
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    if (!ALLOWED_ROLES.has(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { name, phone, carPlate, reason } = req.body;

    // FIX [AUDIT]: валидация длины — без неё авторизованный сотрудник записывал
    // 9MB в поле reason, это попадало в БД и рассылалось через SSE broadcast
    for (const [field, max] of Object.entries(BL_FIELD_MAX)) {
      const val = req.body[field];
      if (val != null && typeof val === 'string' && val.length > max) {
        return res.status(400).json({ error: `${field} too long (max ${max} chars)` });
      }
    }

    const { rows } = await db.query(
      `INSERT INTO blacklist(id, name, phone, car_plate, reason, added_by)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [uuid(), name || null, phone || null, carPlate || null, reason || null, req.user.name],
    );
    res.status(201).json(fmt(rows[0]));
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    if (!ALLOWED_ROLES.has(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await db.query(`DELETE FROM blacklist WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
