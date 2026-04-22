'use strict';

/**
 * routes/integrations.js — inbound machine-to-machine webhook endpoints (Phase 5).
 *
 * Authentication is done via the X-Integration-Secret header checked against
 * the BILLING_SYNC_SECRET env var.  Cookie / JWT auth is NOT used here so
 * that external billing and video systems can call these endpoints without a
 * user session.
 *
 * POST /api/v1/integrations/billing-sync — bulk upsert billing records
 * POST /api/v1/integrations/visit-clip   — attach a clip URL to a visit log
 */

const express = require('express');
const logger  = require('../logger');

const router = express.Router();

// ─── Secret auth middleware ───────────────────────────────────────────────────

function requireIntegrationSecret(req, res, next) {
  const secret = process.env.BILLING_SYNC_SECRET;
  if (!secret) {
    logger.error('[integrations] BILLING_SYNC_SECRET env var is not set');
    return res.status(500).json({ error: { code: 'CONFIG_ERROR', message: 'Integration secret not configured' } });
  }
  const provided = req.headers['x-integration-secret'];
  if (!provided || provided !== secret) {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or missing X-Integration-Secret header' } });
  }
  next();
}

router.use(requireIntegrationSecret);

// ─── POST /api/v1/integrations/billing-sync ──────────────────────────────────
router.post('/billing-sync', async (req, res, next) => {
  try {
    const db      = req.db;
    const records = req.body;

    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({
        error: { code: 'INVALID_BODY', message: 'Body must be a non-empty array of billing records' },
      });
    }

    let created = 0;
    let updated = 0;
    const errors = [];

    for (const [i, rec] of records.entries()) {
      const {
        apartment,
        period_year,
        period_month,
        amount,
        description,
        due_date,
        external_id,
        payment_link,
      } = rec;

      if (!apartment || !period_year || !period_month || amount == null) {
        errors.push({ index: i, message: 'apartment, period_year, period_month, amount are required' });
        continue;
      }

      const numAmount = Number(amount);
      if (!Number.isFinite(numAmount) || numAmount < 0) {
        errors.push({ index: i, message: 'amount must be a non-negative number' });
        continue;
      }

      try {
        // Resolve user_id from apartment (best-effort; NULL is acceptable)
        let resolvedUserId = null;
        const { rows: userRows } = await db.query(
          `SELECT uid FROM users WHERE apartment = $1 AND deleted_at IS NULL LIMIT 1`,
          [String(apartment)],
        );
        if (userRows.length > 0) resolvedUserId = userRows[0].uid;

        const parsedDueDate   = due_date ? new Date(due_date) : null;
        const initialStatus   = (parsedDueDate && parsedDueDate < new Date()) ? 'overdue' : 'pending';

        // Upsert — conflict key is (apartment, period_year, period_month, external_id).
        // external_id may be NULL; the unique index must handle nullable columns
        // via a partial index or a sentinel value — here we use COALESCE with the
        // ON CONFLICT DO UPDATE path regardless.
        const { rowCount, rows } = await db.query(
          `INSERT INTO billing_records
             (user_id, apartment, period_year, period_month, description,
              amount, status, due_date, payment_link, external_id, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
           ON CONFLICT (apartment, period_year, period_month, external_id)
           DO UPDATE SET
             amount       = EXCLUDED.amount,
             description  = COALESCE(EXCLUDED.description, billing_records.description),
             due_date     = COALESCE(EXCLUDED.due_date,    billing_records.due_date),
             payment_link = COALESCE(EXCLUDED.payment_link, billing_records.payment_link),
             updated_at   = NOW()
           RETURNING (xmax = 0) AS is_insert`,
          [
            resolvedUserId,
            String(apartment),
            Number.parseInt(String(period_year), 10),
            Number.parseInt(String(period_month), 10),
            description ?? null,
            numAmount,
            initialStatus,
            due_date ?? null,
            payment_link ?? null,
            external_id ?? null,
          ],
        );

        if (rows[0]?.is_insert) {
          created++;
        } else {
          updated++;
        }
      } catch (rowErr) {
        logger.warn({ err: rowErr.message, index: i, apartment }, '[integrations:billing-sync] row error');
        errors.push({ index: i, message: rowErr.message });
      }
    }

    logger.info({ created, updated, errors: errors.length }, '[integrations:billing-sync] completed');
    res.json({ created, updated, errors });
  } catch (err) { next(err); }
});

// ─── POST /api/v1/integrations/visit-clip ────────────────────────────────────
router.post('/visit-clip', async (req, res, next) => {
  try {
    const { visit_log_id, clip_url } = req.body;

    if (!visit_log_id || !clip_url) {
      return res.status(400).json({
        error: { code: 'MISSING_FIELDS', message: 'visit_log_id and clip_url are required' },
      });
    }

    const { rowCount } = await req.db.query(
      `UPDATE visit_logs SET clip_url = $1 WHERE id = $2`,
      [String(clip_url), String(visit_log_id)],
    );

    if (rowCount === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Visit log not found' } });
    }

    logger.debug({ visitLogId: visit_log_id }, '[integrations:visit-clip] clip_url set');
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
