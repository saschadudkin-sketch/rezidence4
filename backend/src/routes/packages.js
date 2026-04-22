'use strict';

const express     = require('express');
const requireAuth = require('../middleware/auth');
const { isStaff } = require('../constants');
const { dispatch: notifyDispatch } = require('../services/notificationService');

const router = express.Router();
router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateUuid(req, res, next) {
  if (!UUID_RE.test(req.params.id || '')) {
    return res.status(400).json({ error: { code: 'INVALID_ID', message: 'Invalid id format' } });
  }
  next();
}

async function writeAudit(db, actorUid, actorRole, action, resourceId, changes) {
  try {
    await db.query(
      `INSERT INTO audit_log (actor_uid, actor_role, action, resource_type, resource_id, changes)
       VALUES ($1, $2, $3, 'package', $4, $5)`,
      [actorUid, actorRole, action, resourceId, JSON.stringify(changes)],
    );
  } catch (_err) {
    // Audit failures must never block the main response.
  }
}

// ─── GET /api/v1/packages ─────────────────────────────────────────────────────
// Residents see only their own packages (by uid or apartment).
// Staff/admin see all packages with optional filters ?status= &apartment=
router.get('/', async (req, res, next) => {
  try {
    const db   = req.db;
    const user = req.user;

    const params     = [];
    const conditions = [];
    let idx = 1;

    if (!isStaff(user.role) && user.role !== 'admin') {
      // Resident: own packages matched by uid OR apartment
      const orClauses = [];
      orClauses.push(`recipient_user_id = $${idx++}`);
      params.push(user.uid);
      if (user.apartment) {
        orClauses.push(`recipient_apartment = $${idx++}`);
        params.push(user.apartment);
      }
      conditions.push(`(${orClauses.join(' OR ')})`);
    } else {
      // Staff/admin: optional filters
      const { status, apartment } = req.query;
      if (status)    { conditions.push(`status = $${idx++}`);                params.push(status); }
      if (apartment) { conditions.push(`recipient_apartment = $${idx++}`);   params.push(apartment); }
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await db.query(
      `SELECT id, recipient_user_id, recipient_apartment, recipient_name,
              sender_name, tracking_number, carrier, photo_url,
              received_at, received_by, picked_up_at, picked_up_by_name,
              notified_at, reminder_sent_at, status, notes, created_at
       FROM packages
       ${where}
       ORDER BY received_at DESC`,
      params,
    );

    return res.json({ packages: rows });
  } catch (err) { next(err); }
});

// ─── POST /api/v1/packages ────────────────────────────────────────────────────
// Staff/admin only. Auto-resolves recipient_user_id from apartment.
// Dispatches 'package.arrived' push notification to recipient.
router.post('/', async (req, res, next) => {
  try {
    if (!isStaff(req.user.role) && req.user.role !== 'admin') {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Staff or admin required' } });
    }

    const {
      recipient_apartment,
      recipient_name,
      sender_name,
      tracking_number,
      carrier,
      photo_url,
      notes,
    } = req.body;

    if (!recipient_apartment || !recipient_name) {
      return res.status(400).json({
        error: { code: 'MISSING_FIELDS', message: 'recipient_apartment and recipient_name are required' },
      });
    }

    const db = req.db;

    // Auto-lookup resident by apartment
    const { rows: userRows } = await db.query(
      `SELECT uid FROM users WHERE apartment = $1 AND deleted_at IS NULL LIMIT 1`,
      [recipient_apartment],
    );
    const recipientUserId = userRows.length > 0 ? userRows[0].uid : null;

    const { rows } = await db.query(
      `INSERT INTO packages
         (recipient_user_id, recipient_apartment, recipient_name,
          sender_name, tracking_number, carrier, photo_url,
          received_by, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, recipient_user_id, recipient_apartment, recipient_name,
                 sender_name, tracking_number, carrier, photo_url,
                 received_at, received_by, picked_up_at, picked_up_by_name,
                 notified_at, reminder_sent_at, status, notes, created_at`,
      [
        recipientUserId,
        recipient_apartment,
        recipient_name,
        sender_name        || null,
        tracking_number    || null,
        carrier            || null,
        photo_url          || null,
        req.user.uid,
        notes              || null,
      ],
    );

    const pkg = rows[0];

    // Mark notified_at so we know the notification was sent
    if (recipientUserId) {
      notifyDispatch(
        'package.arrived',
        { userId: recipientUserId, packageId: pkg.id },
        db,
        req.property || null,
      ).catch(() => {});

      db.query(
        `UPDATE packages SET notified_at = NOW() WHERE id = $1`,
        [pkg.id],
      ).catch(() => {});
    }

    await writeAudit(db, req.user.uid, req.user.role, 'package.received', pkg.id, {
      recipient_apartment,
      recipient_name,
      tracking_number: tracking_number || null,
    });

    return res.status(201).json({ package: pkg });
  } catch (err) { next(err); }
});

// ─── PATCH /api/v1/packages/:id/pickup ───────────────────────────────────────
// Staff/admin only. Marks the package as picked up.
router.patch('/:id/pickup', validateUuid, async (req, res, next) => {
  try {
    if (!isStaff(req.user.role) && req.user.role !== 'admin') {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Staff or admin required' } });
    }

    const { picked_up_by_name } = req.body;
    const db = req.db;

    const { rows } = await db.query(
      `UPDATE packages
         SET status = 'picked_up',
             picked_up_at = NOW(),
             picked_up_by_name = $1
       WHERE id = $2
         AND status = 'awaiting_pickup'
       RETURNING id, recipient_user_id, recipient_apartment, recipient_name,
                 sender_name, tracking_number, carrier, photo_url,
                 received_at, received_by, picked_up_at, picked_up_by_name,
                 notified_at, reminder_sent_at, status, notes, created_at`,
      [picked_up_by_name || null, req.params.id],
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Package not found or already processed' } });
    }

    const pkg = rows[0];
    await writeAudit(db, req.user.uid, req.user.role, 'package.pickedup', pkg.id, {
      picked_up_by_name: picked_up_by_name || null,
    });

    return res.json({ package: pkg });
  } catch (err) { next(err); }
});

// ─── PATCH /api/v1/packages/:id/return ───────────────────────────────────────
// Staff/admin only. Marks the package as returned to sender.
router.patch('/:id/return', validateUuid, async (req, res, next) => {
  try {
    if (!isStaff(req.user.role) && req.user.role !== 'admin') {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Staff or admin required' } });
    }

    const db = req.db;

    const { rows } = await db.query(
      `UPDATE packages
         SET status = 'returned'
       WHERE id = $1
         AND status = 'awaiting_pickup'
       RETURNING id, recipient_user_id, recipient_apartment, recipient_name,
                 sender_name, tracking_number, carrier, photo_url,
                 received_at, received_by, picked_up_at, picked_up_by_name,
                 notified_at, reminder_sent_at, status, notes, created_at`,
      [req.params.id],
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Package not found or already processed' } });
    }

    return res.json({ package: rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
