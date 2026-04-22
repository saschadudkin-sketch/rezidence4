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
       VALUES ($1, $2, $3, 'billing_record', $4, $5)`,
      [actorUid, actorRole, action, resourceId, JSON.stringify(changes)],
    );
  } catch (_err) {
    // Audit failures must never block the main response.
  }
}

// ─── GET /api/v1/billing ─────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { apartment, status, year, month } = req.query;
    const db   = req.db;
    const user = req.user;

    const params = [];
    const conditions = [];
    let idx = 1;

    if (!isStaff(user.role)) {
      conditions.push(`user_id = $${idx++}`);
      params.push(user.uid);
    } else {
      if (apartment) { conditions.push(`apartment = $${idx++}`); params.push(apartment); }
      if (status)    { conditions.push(`status = $${idx++}`);    params.push(status); }
      if (year)      { conditions.push(`period_year = $${idx++}`); params.push(Number.parseInt(year, 10)); }
      if (month)     { conditions.push(`period_month = $${idx++}`); params.push(Number.parseInt(month, 10)); }
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await db.query(
      `SELECT id, user_id, apartment, period_year, period_month, description,
              amount, currency, status, due_date, paid_at, payment_link,
              invoice_url, external_id, created_at, updated_at
       FROM billing_records
       ${where}
       ORDER BY period_year DESC, period_month DESC, created_at DESC`,
      params,
    );

    let summary;
    if (isStaff(user.role)) {
      const { rows: sumRows } = await db.query(
        `SELECT
           SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END) AS total_pending,
           SUM(CASE WHEN status = 'overdue' THEN amount ELSE 0 END) AS total_overdue
         FROM billing_records`,
      );
      summary = {
        total_pending: parseFloat(sumRows[0].total_pending || 0),
        total_overdue: parseFloat(sumRows[0].total_overdue || 0),
      };
    }

    res.json({ records: rows, ...(summary ? { summary } : {}) });
  } catch (err) { next(err); }
});

// ─── GET /api/v1/billing/:id ─────────────────────────────────────────────────
router.get('/:id', validateUuid, async (req, res, next) => {
  try {
    const db   = req.db;
    const user = req.user;

    const { rows } = await db.query(
      `SELECT id, user_id, apartment, period_year, period_month, description,
              amount, currency, status, due_date, paid_at, payment_link,
              invoice_url, external_id, created_at, updated_at
       FROM billing_records
       WHERE id = $1`,
      [req.params.id],
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Billing record not found' } });
    }

    const record = rows[0];

    // Residents can only see their own records
    if (!isStaff(user.role) && record.user_id !== user.uid) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Billing record not found' } });
    }

    res.json({ record });
  } catch (err) { next(err); }
});

// ─── POST /api/v1/billing ────────────────────────────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    if (!isStaff(req.user.role) || req.user.role !== 'admin') {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Admin only' } });
    }

    const {
      user_id, apartment, period_year, period_month,
      description, amount, due_date, payment_link, invoice_url, external_id,
    } = req.body;

    if (!apartment || !period_year || !period_month || amount == null) {
      return res.status(400).json({ error: { code: 'MISSING_FIELDS', message: 'apartment, period_year, period_month, amount are required' } });
    }
    const numAmount = Number(amount);
    if (!Number.isFinite(numAmount) || numAmount < 0) {
      return res.status(400).json({ error: { code: 'INVALID_AMOUNT', message: 'amount must be a non-negative number' } });
    }

    const db = req.db;

    // Resolve user_id from apartment if not provided
    let resolvedUserId = user_id || null;
    if (!resolvedUserId) {
      const { rows: userRows } = await db.query(
        `SELECT uid FROM users WHERE apartment = $1 AND deleted_at IS NULL LIMIT 1`,
        [apartment],
      );
      if (userRows.length > 0) resolvedUserId = userRows[0].uid;
    }

    // Immediately set overdue if due_date is in the past
    const parsedDueDate = due_date ? new Date(due_date) : null;
    const initialStatus = (parsedDueDate && parsedDueDate < new Date()) ? 'overdue' : 'pending';

    const { rows } = await db.query(
      `INSERT INTO billing_records
         (user_id, apartment, period_year, period_month, description, amount,
          status, due_date, payment_link, invoice_url, external_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, user_id, apartment, period_year, period_month, description,
                 amount, currency, status, due_date, paid_at, payment_link,
                 invoice_url, external_id, created_at, updated_at`,
      [
        resolvedUserId,
        apartment,
        Number.parseInt(period_year, 10),
        Number.parseInt(period_month, 10),
        description || null,
        numAmount,
        initialStatus,
        due_date || null,
        payment_link || null,
        invoice_url || null,
        external_id || null,
      ],
    );

    const record = rows[0];
    await writeAudit(db, req.user.uid, req.user.role, 'billing.created', record.id, { amount: numAmount, apartment });

    res.status(201).json({ record });
  } catch (err) { next(err); }
});

// ─── PATCH /api/v1/billing/:id ────────────────────────────────────────────────
router.patch('/:id', validateUuid, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Admin only' } });
    }

    const { description, amount, status, due_date, payment_link, invoice_url } = req.body;
    const db = req.db;

    const VALID_STATUSES = new Set(['pending', 'paid', 'overdue', 'cancelled']);
    if (status && !VALID_STATUSES.has(status)) {
      return res.status(400).json({ error: { code: 'INVALID_STATUS', message: 'Invalid status' } });
    }

    const setClauses = ['updated_at = NOW()'];
    const params = [];
    let idx = 1;

    if (description !== undefined) { setClauses.push(`description = $${idx++}`); params.push(description); }
    if (amount !== undefined) {
      const numAmount = Number(amount);
      if (!Number.isFinite(numAmount) || numAmount < 0) {
        return res.status(400).json({ error: { code: 'INVALID_AMOUNT', message: 'Invalid amount' } });
      }
      setClauses.push(`amount = $${idx++}`); params.push(numAmount);
    }
    if (status !== undefined)       { setClauses.push(`status = $${idx++}`);       params.push(status); }
    if (due_date !== undefined)     { setClauses.push(`due_date = $${idx++}`);     params.push(due_date || null); }
    if (payment_link !== undefined) { setClauses.push(`payment_link = $${idx++}`); params.push(payment_link || null); }
    if (invoice_url !== undefined)  { setClauses.push(`invoice_url = $${idx++}`);  params.push(invoice_url || null); }

    params.push(req.params.id);
    const { rows } = await db.query(
      `UPDATE billing_records
       SET ${setClauses.join(', ')}
       WHERE id = $${idx}
       RETURNING id, user_id, apartment, period_year, period_month, description,
                 amount, currency, status, due_date, paid_at, payment_link,
                 invoice_url, external_id, created_at, updated_at`,
      params,
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Billing record not found' } });
    }

    const record = rows[0];
    await writeAudit(db, req.user.uid, req.user.role, 'billing.updated', record.id, req.body);

    res.json({ record });
  } catch (err) { next(err); }
});

// ─── POST /api/v1/billing/:id/mark-paid ──────────────────────────────────────
router.post('/:id/mark-paid', validateUuid, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Admin only' } });
    }

    const { paid_at } = req.body;
    const db = req.db;

    const { rows } = await db.query(
      `UPDATE billing_records
       SET status = 'paid', paid_at = COALESCE($1::TIMESTAMPTZ, NOW()), updated_at = NOW()
       WHERE id = $2
       RETURNING id, user_id, apartment, period_year, period_month, description,
                 amount, currency, status, due_date, paid_at, payment_link,
                 invoice_url, external_id, created_at, updated_at`,
      [paid_at || null, req.params.id],
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Billing record not found' } });
    }

    const record = rows[0];
    await writeAudit(db, req.user.uid, req.user.role, 'billing.paid', record.id, { paid_at: record.paid_at });

    res.json({ record });
  } catch (err) { next(err); }
});

module.exports = router;
