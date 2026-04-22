'use strict';

const express     = require('express');
const requireAuth = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_TYPES = new Set(['party_room', 'sauna', 'gym', 'bbq', 'roof', 'conference', 'other']);

function validateUuid(req, res, next) {
  if (!UUID_RE.test(req.params.id || '')) {
    return res.status(400).json({ error: { code: 'INVALID_ID', message: 'Invalid id format' } });
  }
  next();
}

// ─── GET /api/v1/spaces ───────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await req.db.query(
      `SELECT id, name, description, type, capacity, price_per_slot,
              slot_duration_minutes, open_time, close_time, advance_days,
              max_concurrent_bookings, photo_url, rules, sort_order, created_at
       FROM spaces
       WHERE is_active = true
       ORDER BY sort_order ASC, name ASC`,
    );
    res.json({ spaces: rows });
  } catch (err) { next(err); }
});

// ─── GET /api/v1/spaces/:id ───────────────────────────────────────────────────
router.get('/:id', validateUuid, async (req, res, next) => {
  try {
    const { rows } = await req.db.query(
      `SELECT id, name, description, type, capacity, price_per_slot,
              slot_duration_minutes, open_time, close_time, advance_days,
              max_concurrent_bookings, is_active, photo_url, rules, sort_order, created_at
       FROM spaces
       WHERE id = $1`,
      [req.params.id],
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Space not found' } });
    }
    res.json({ space: rows[0] });
  } catch (err) { next(err); }
});

// ─── GET /api/v1/spaces/:id/availability ─────────────────────────────────────
router.get('/:id/availability', validateUuid, async (req, res, next) => {
  try {
    const { date } = req.query;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: { code: 'INVALID_DATE', message: 'date query param required (YYYY-MM-DD)' } });
    }

    const db = req.db;

    const { rows: spaceRows } = await db.query(
      `SELECT id, open_time, close_time, slot_duration_minutes
       FROM spaces WHERE id = $1 AND is_active = true`,
      [req.params.id],
    );
    if (spaceRows.length === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Space not found' } });
    }

    const space = spaceRows[0];
    const dayStart = new Date(`${date}T${space.open_time}`);
    const dayEnd   = new Date(`${date}T${space.close_time}`);

    // Get all active bookings for this space on this date
    const { rows: bookings } = await db.query(
      `SELECT id, starts_at, ends_at
       FROM space_bookings
       WHERE space_id = $1
         AND status != 'cancelled'
         AND starts_at < $2::TIMESTAMPTZ
         AND ends_at   > $3::TIMESTAMPTZ`,
      [req.params.id, dayEnd.toISOString(), dayStart.toISOString()],
    );

    // Build slot grid
    const slotMinutes = Math.max(15, Number.parseInt(space.slot_duration_minutes, 10) || 60);
    const slots = [];
    let cursor = new Date(dayStart);

    while (cursor < dayEnd) {
      const slotEnd = new Date(cursor.getTime() + slotMinutes * 60_000);
      if (slotEnd > dayEnd) break;

      const slotStartIso = cursor.toISOString();
      const slotEndIso   = slotEnd.toISOString();

      const overlap = bookings.find(b =>
        new Date(b.starts_at) < slotEnd && new Date(b.ends_at) > cursor,
      );

      slots.push({
        startsAt:  slotStartIso,
        endsAt:    slotEndIso,
        available: !overlap,
        ...(overlap ? { bookingId: overlap.id } : {}),
      });

      cursor = slotEnd;
    }

    res.json({ date, slots });
  } catch (err) { next(err); }
});

// ─── POST /api/v1/spaces ─────────────────────────────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Admin only' } });
    }

    const {
      name, type, description, capacity, price_per_slot,
      slot_duration_minutes, open_time, close_time,
      advance_days, rules, photo_url, sort_order,
    } = req.body;

    if (!name || !type) {
      return res.status(400).json({ error: { code: 'MISSING_FIELDS', message: 'name and type are required' } });
    }
    if (!VALID_TYPES.has(type)) {
      return res.status(400).json({ error: { code: 'INVALID_TYPE', message: 'Invalid space type' } });
    }

    const { rows } = await req.db.query(
      `INSERT INTO spaces
         (name, type, description, capacity, price_per_slot, slot_duration_minutes,
          open_time, close_time, advance_days, rules, photo_url, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id, name, description, type, capacity, price_per_slot,
                 slot_duration_minutes, open_time, close_time, advance_days,
                 max_concurrent_bookings, is_active, photo_url, rules, sort_order, created_at`,
      [
        name,
        type,
        description   || null,
        capacity      ? Number.parseInt(capacity, 10)      : null,
        price_per_slot != null ? Number(price_per_slot)    : 0,
        slot_duration_minutes  ? Number.parseInt(slot_duration_minutes, 10) : 60,
        open_time     || '08:00',
        close_time    || '22:00',
        advance_days  ? Number.parseInt(advance_days, 10)  : 14,
        rules         || null,
        photo_url     || null,
        sort_order    != null ? Number.parseInt(sort_order, 10) : 0,
      ],
    );

    res.status(201).json({ space: rows[0] });
  } catch (err) { next(err); }
});

// ─── PATCH /api/v1/spaces/:id ─────────────────────────────────────────────────
router.patch('/:id', validateUuid, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Admin only' } });
    }

    const allowed = [
      'name', 'description', 'type', 'capacity', 'price_per_slot',
      'slot_duration_minutes', 'open_time', 'close_time', 'advance_days',
      'max_concurrent_bookings', 'is_active', 'photo_url', 'rules', 'sort_order',
    ];

    const setClauses = [];
    const params = [];
    let idx = 1;

    for (const field of allowed) {
      if (req.body[field] !== undefined) {
        if (field === 'type' && !VALID_TYPES.has(req.body[field])) {
          return res.status(400).json({ error: { code: 'INVALID_TYPE', message: 'Invalid space type' } });
        }
        setClauses.push(`${field} = $${idx++}`);
        params.push(req.body[field]);
      }
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: { code: 'NO_FIELDS', message: 'No updatable fields provided' } });
    }

    params.push(req.params.id);
    const { rows } = await req.db.query(
      `UPDATE spaces
       SET ${setClauses.join(', ')}
       WHERE id = $${idx}
       RETURNING id, name, description, type, capacity, price_per_slot,
                 slot_duration_minutes, open_time, close_time, advance_days,
                 max_concurrent_bookings, is_active, photo_url, rules, sort_order, created_at`,
      params,
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Space not found' } });
    }

    res.json({ space: rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
