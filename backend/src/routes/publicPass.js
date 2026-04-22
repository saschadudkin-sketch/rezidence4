'use strict';

/**
 * routes/publicPass.js — Phase 2 Public QR Pass lookup
 *
 * GET /:token — no auth required, rate-limited 30/min/IP
 *
 * Returns pass status without exposing resident UID or phone.
 */

const express = require('express');

const router = express.Router();

const TOKEN_RE = /^[0-9a-f]{64}$/i; // 32 bytes hex = 64 hex chars

function validateToken(req, res, next) {
  if (!TOKEN_RE.test(String(req.params.token || ''))) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pass not found' } });
  }
  next();
}

// ─── GET /:token ──────────────────────────────────────────────────────────────
router.get('/:token', validateToken, async (req, res, next) => {
  try {
    const db = req.db;

    const { rows } = await db.query(
      `SELECT
         qp.id            AS pass_id,
         qp.token,
         qp.expires_at,
         qp.used_at,
         qp.invalidated_at,
         r.id             AS request_id,
         r.type           AS request_type,
         r.visitor_name,
         r.created_by_apt AS apartment,
         r.valid_until
       FROM qr_passes qp
       JOIN requests r ON r.id = qp.request_id
       WHERE qp.token = $1 AND qp.invalidated_at IS NULL`,
      [req.params.token],
    );

    if (!rows.length) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pass not found' } });
    }

    const row = rows[0];
    const now = new Date();

    // Determine status
    let status;
    if (row.invalidated_at) {
      status = 'invalid';
    } else if (row.used_at) {
      status = 'used';
    } else if (new Date(row.expires_at) < now) {
      status = 'expired';
    } else {
      status = 'valid';
    }

    // Resolve property name from req.property (set by propertyDb middleware)
    const propertyName = req.property?.name || null;

    res.json({
      status,
      visitorName:  row.visitor_name || null,
      propertyName,
      apartment:    row.apartment || null,
      validUntil:   row.expires_at,
      type:         row.request_type,
      passId:       row.pass_id,
    });
  } catch (err) { next(err); }
});

module.exports = router;
