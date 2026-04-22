'use strict';

/**
 * routes/bookings.js — Space booking management (Phase 3).
 *
 * GET    /api/v1/bookings                   — resident: own; admin/staff: all
 * POST   /api/v1/spaces/:id/bookings        — create booking for a space
 * PATCH  /api/v1/bookings/:id/cancel        — cancel booking
 */

const express     = require('express');
const requireAuth = require('../middleware/auth');
const { isStaff } = require('../constants');
const { dispatch: notifyDispatch } = require('../services/notificationService');

const router = express.Router();
router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateUuid(req, res, next) {
  const id = req.params.id || req.params.spaceId || '';
  if (!UUID_RE.test(id)) {
    return res.status(400).json({ error: { code: 'INVALID_ID', message: 'Invalid id format' } });
  }
  next();
}

const BOOKING_COLS = `
  id, space_id, user_id, starts_at, ends_at, status,
  attendees_count, notes, cancelled_reason, cancelled_at, cancelled_by,
  created_at, updated_at
`;

// ─── GET /api/v1/bookings ─────────────────────────────────────────────────────
// Resident: own bookings only.
// Staff/admin: all bookings with optional ?space_id, ?date, ?status filters.
router.get('/', async (req, res, next) => {
  try {
    const { space_id, date, status } = req.query;
    const db   = req.db;
    const user = req.user;

    const params = [];
    const conditions = [];
    let idx = 1;

    if (!isStaff(user.role)) {
      conditions.push(`b.user_id = $${idx++}`);
      params.push(user.uid);
    } else {
      if (space_id) {
        if (!UUID_RE.test(space_id)) {
          return res.status(400).json({ error: { code: 'INVALID_SPACE_ID', message: 'Invalid space_id format' } });
        }
        conditions.push(`b.space_id = $${idx++}`);
        params.push(space_id);
      }
      if (date) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return res.status(400).json({ error: { code: 'INVALID_DATE', message: 'date must be YYYY-MM-DD' } });
        }
        // Bookings that overlap the requested calendar date
        conditions.push(`b.starts_at::DATE = $${idx++}`);
        params.push(date);
      }
      if (status) {
        const VALID_STATUSES = new Set(['confirmed', 'cancelled', 'completed', 'pending_approval']);
        if (!VALID_STATUSES.has(status)) {
          return res.status(400).json({ error: { code: 'INVALID_STATUS', message: 'Invalid status value' } });
        }
        conditions.push(`b.status = $${idx++}`);
        params.push(status);
      }
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await db.query(
      `SELECT ${BOOKING_COLS}, s.name AS space_name
       FROM space_bookings b
       JOIN spaces s ON s.id = b.space_id
       ${where}
       ORDER BY b.starts_at DESC`,
      params,
    );

    res.json({ bookings: rows });
  } catch (err) { next(err); }
});

// ─── POST /api/v1/spaces/:spaceId/bookings ────────────────────────────────────
// Create a booking for a specific space.
// Validates time bounds, advance window, open/close hours, then checks overlap.
router.post('/spaces/:spaceId/bookings', async (req, res, next) => {
  try {
    const { spaceId } = req.params;
    if (!UUID_RE.test(spaceId)) {
      return res.status(400).json({ error: { code: 'INVALID_ID', message: 'Invalid space id format' } });
    }

    const { starts_at, ends_at, attendees_count, notes } = req.body;
    if (!starts_at || !ends_at) {
      return res.status(400).json({ error: { code: 'MISSING_FIELDS', message: 'starts_at and ends_at are required' } });
    }

    const start = new Date(starts_at);
    const end   = new Date(ends_at);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({ error: { code: 'INVALID_DATETIME', message: 'starts_at and ends_at must be valid ISO timestamps' } });
    }
    if (start >= end) {
      return res.status(400).json({ error: { code: 'INVALID_RANGE', message: 'starts_at must be before ends_at' } });
    }
    if (start <= new Date()) {
      return res.status(400).json({ error: { code: 'PAST_SLOT', message: 'Booking must be in the future' } });
    }

    const db = req.db;

    // Fetch space config
    const { rows: spaceRows } = await db.query(
      `SELECT id, name, open_time, close_time, advance_days, is_active
       FROM spaces WHERE id = $1`,
      [spaceId],
    );
    if (spaceRows.length === 0 || !spaceRows[0].is_active) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Space not found or inactive' } });
    }
    const space = spaceRows[0];

    // Validate within advance_days window
    const maxAdvanceMs = space.advance_days * 24 * 60 * 60 * 1000;
    if (start.getTime() - Date.now() > maxAdvanceMs) {
      return res.status(400).json({
        error: {
          code: 'TOO_FAR_IN_ADVANCE',
          message: `Cannot book more than ${space.advance_days} days in advance`,
        },
      });
    }

    // Validate within open/close hours (using booking date for reference)
    const bookingDate = start.toISOString().slice(0, 10);
    const openBound  = new Date(`${bookingDate}T${space.open_time}`);
    const closeBound = new Date(`${bookingDate}T${space.close_time}`);
    if (start < openBound || end > closeBound) {
      return res.status(400).json({
        error: {
          code: 'OUTSIDE_OPERATING_HOURS',
          message: `Space is only available between ${space.open_time} and ${space.close_time}`,
        },
      });
    }

    // App-level overlap check (DB-level exclusion constraint may also fire)
    const { rows: overlapRows } = await db.query(
      `SELECT COUNT(*) AS cnt
       FROM space_bookings
       WHERE space_id = $1
         AND status != 'cancelled'
         AND starts_at < $2
         AND ends_at   > $3`,
      [spaceId, end.toISOString(), start.toISOString()],
    );
    if (parseInt(overlapRows[0].cnt, 10) > 0) {
      return res.status(409).json({
        error: { code: 'TIME_SLOT_UNAVAILABLE', message: 'The requested time slot is already booked' },
      });
    }

    // Insert booking
    let booking;
    try {
      const { rows } = await db.query(
        `INSERT INTO space_bookings
           (space_id, user_id, starts_at, ends_at, attendees_count, notes)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING ${BOOKING_COLS}`,
        [
          spaceId,
          req.user.uid,
          start.toISOString(),
          end.toISOString(),
          attendees_count ? Number.parseInt(attendees_count, 10) : 1,
          notes || null,
        ],
      );
      booking = rows[0];
    } catch (dbErr) {
      // Catch DB-level exclusion constraint violation as well
      if (dbErr.code === '23P01' || dbErr.code === '23505') {
        return res.status(409).json({
          error: { code: 'TIME_SLOT_UNAVAILABLE', message: 'The requested time slot is already booked' },
        });
      }
      throw dbErr;
    }

    // Fire-and-forget booking.confirmed notification
    notifyDispatch(
      'booking.confirmed',
      {
        userId:    req.user.uid,
        bookingId: booking.id,
        spaceName: space.name,
        startsAt:  booking.starts_at,
      },
      db,
      req.property || null,
    ).catch(() => {});

    res.status(201).json({ booking });
  } catch (err) { next(err); }
});

// ─── PATCH /api/v1/bookings/:id/cancel ───────────────────────────────────────
// Resident can cancel own booking; admin/staff can cancel any.
router.patch('/:id/cancel', validateUuid, async (req, res, next) => {
  try {
    const { cancelled_reason } = req.body;
    const db   = req.db;
    const user = req.user;

    // Fetch existing booking
    const { rows: existing } = await db.query(
      `SELECT id, user_id, status FROM space_bookings WHERE id = $1`,
      [req.params.id],
    );
    if (existing.length === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Booking not found' } });
    }

    const booking = existing[0];

    // Ownership check for non-staff
    if (!isStaff(user.role) && booking.user_id !== user.uid) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Cannot cancel another resident\'s booking' } });
    }

    if (booking.status === 'cancelled') {
      return res.status(409).json({ error: { code: 'ALREADY_CANCELLED', message: 'Booking is already cancelled' } });
    }

    const { rows } = await db.query(
      `UPDATE space_bookings
       SET status           = 'cancelled',
           cancelled_at     = NOW(),
           cancelled_by     = $1,
           cancelled_reason = $2,
           updated_at       = NOW()
       WHERE id = $3
       RETURNING ${BOOKING_COLS}`,
      [user.uid, cancelled_reason || null, req.params.id],
    );

    res.json({ booking: rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
