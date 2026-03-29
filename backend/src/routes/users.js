'use strict';
const express = require('express');
const { v4: uuid } = require('uuid');
const db      = require('../db');
const requireAuth = require('../middleware/auth');
const { isStaff, normalizePhone } = require('../constants'); // FIX [CODE-1]: убираем магические строки + normalizePhone

const router = express.Router();
router.use(requireAuth);

const ALLOWED_ROLES = ['owner','tenant','contractor','concierge','security','admin'];

function fmt(u) {
  return {
    uid:       u.uid,
    phone:     u.phone,
    name:      u.name,
    role:      u.role,
    apartment: u.apartment,
    avatar:    u.avatar,
  };
}

// ─── GET /api/users ───────────────────────────────────────────────────────────

router.get('/', async (req, res, next) => {
  try {
    if (!isStaff(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    // FIX [PERF-1]: явные колонки вместо SELECT *
    const { rows } = await db.query(
      `SELECT uid, phone, name, role, apartment, avatar FROM users ORDER BY name`,
    );
    res.json(rows.map(fmt));
  } catch (err) { next(err); }
});

// ─── POST /api/users — create user (admin only) ───────────────────────────────

router.post('/', async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });

    const { phone, role, apartment } = req.body;
    // FIX [AUDIT]: trim() перед проверкой — name="   " (пробелы) раньше проходило валидацию
    // и записывалось в БД как пустое имя, отображаясь как пустота в заголовке и карточках.
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!phone || !name) return res.status(400).json({ error: 'phone and name required' });
    if (name.length > 100) return res.status(400).json({ error: 'name too long (max 100 chars)' });
    if (apartment && typeof apartment === 'string' && apartment.length > 20) {
      return res.status(400).json({ error: 'apartment too long (max 20 chars)' });
    }
    if (!role) return res.status(400).json({ error: 'role required' });
    if (!ALLOWED_ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });

    const uid        = uuid();
    const normalised = normalizePhone(phone);

    const { rows } = await db.query(
      `INSERT INTO users(uid, phone, name, role, apartment)
       VALUES($1,$2,$3,$4,$5) RETURNING *`,
      [uid, normalised, name, role, apartment || null],
    );
    res.status(201).json(fmt(rows[0]));
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Телефон уже зарегистрирован' });
    next(err);
  }
});

// ─── PATCH /api/users/:uid ────────────────────────────────────────────────────

router.patch('/:uid', async (req, res, next) => {
  try {
    const isAdmin  = req.user.role === 'admin';
    const isSelf   = req.user.uid  === req.params.uid;

    if (!isAdmin && !isSelf) return res.status(403).json({ error: 'Forbidden' });

    const { role, avatar } = req.body;

    // FIX [AUDIT]: trim() + type-check для name и apartment.
    // Без trim() name="   " проходило валидацию и сохранялось как пустое имя.
    // Без typeof-проверки name.length кидало TypeError если name — число или null.
    let name      = req.body.name      !== undefined ? req.body.name      : undefined;
    let apartment = req.body.apartment !== undefined ? req.body.apartment : undefined;

    if (name !== undefined) {
      if (typeof name !== 'string') return res.status(400).json({ error: 'name must be a string' });
      name = name.trim();
      if (!name)           return res.status(400).json({ error: 'name cannot be empty' });
      if (name.length > 100) return res.status(400).json({ error: 'name too long (max 100 chars)' });
    }
    if (apartment !== undefined && apartment !== null) {
      if (typeof apartment !== 'string') return res.status(400).json({ error: 'apartment must be a string' });
      apartment = apartment.trim();
      if (apartment.length > 20) return res.status(400).json({ error: 'apartment too long (max 20 chars)' });
    }

    const fields = [];
    const vals   = [];
    let   i      = 1;

    if (name      !== undefined) { fields.push(`name=$${i++}`);      vals.push(name); }
    if (apartment !== undefined) { fields.push(`apartment=$${i++}`); vals.push(apartment); }
    if (avatar    !== undefined) {
      // FIX [SEC-6]: avatar принимает только null или URL нашего /uploads/
      // Предотвращаем сохранение javascript: URI или внешних трекеров.
      if (avatar !== null) {
        const backendUrl = process.env.BACKEND_URL || '';
        const isLocalUpload = avatar.startsWith(backendUrl + '/uploads/')
          || avatar.startsWith('/uploads/');
        if (!isLocalUpload) {
          return res.status(400).json({ error: 'avatar must be a local upload URL (/uploads/...)' });
        }
      }
      fields.push(`avatar=$${i++}`);
      vals.push(avatar);
    }
    if (role      !== undefined && isAdmin) {
      if (!ALLOWED_ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
      fields.push(`role=$${i++}`);
      vals.push(role);
    }

    if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });

    vals.push(req.params.uid);
    const { rows } = await db.query(
      `UPDATE users SET ${fields.join(',')} WHERE uid=$${i} RETURNING *`,
      vals,
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(fmt(rows[0]));
  } catch (err) { next(err); }
});

// ─── DELETE /api/users/:uid ───────────────────────────────────────────────────

router.delete('/:uid', async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    if (req.user.uid === req.params.uid) return res.status(400).json({ error: 'Cannot delete yourself' });

    await db.query(`DELETE FROM users WHERE uid=$1`, [req.params.uid]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
