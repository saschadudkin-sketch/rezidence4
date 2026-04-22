'use strict';

/**
 * routes/guardScan.js — Phase 2 Guard QR-scan API (staff auth required)
 *
 * POST /           — scan a pass token, creates visit_log, returns pass + request + resident info
 * POST /:scanId/admit — mark visit allowed, mark pass used, dispatch guest.arrived
 * POST /:scanId/deny  — mark visit denied
 */

const express = require('express');
const { randomUUID: uuid } = require('crypto');
const requireAuth = require('../middleware/auth');
const logger = require('../logger');
const { isStaff } = require('../constants');
const { dispatch: notifyDispatch } = require('../services/notificationService');

const router = express.Router();
router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^[0-9a-f]{64}$/i; // 32 bytes hex

function validateScanId(req, res, next) {
  if (!UUID_RE.test(String(req.params.scanId || ''))) {
    return res.status(400).json({ error: { code: 'INVALID_ID', message: 'Invalid scanId format' } });
  }
  next();
}

// ─── POST / ───────────────────────────────────────────────────────────────────
// Scan a pass token. Returns pass details + request + resident (name, apartment only).
router.post('/', async (req, res, next) => {
  try {
    if (!isStaff(req.user.role)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Staff only' } });
    }

    const { token } = req.body;

    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: { code: 'VALIDATION', message: 'token is required' } });
    }
    if (!TOKEN_RE.test(token)) {
      return res.status(400).json({ error: { code: 'VALIDATION', message: 'Invalid token format' } });
    }

    const db = req.db;

    // Lookup pass with associated request and resident (no UID/phone exposed)
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
         r.visitor_phone,
         r.created_by_apt AS apartment,
         r.created_by_uid AS resident_uid,
         r.created_by_name AS resident_name,
         r.valid_until
       FROM qr_passes qp
       JOIN requests r ON r.id = qp.request_id
       WHERE qp.token = $1`,
      [token],
    );

    if (!rows.length) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pass not found' } });
    }

    const pass = rows[0];

    // Validate pass state
    if (pass.invalidated_at) {
      return res.status(422).json({ error: { code: 'PASS_INVALID', message: 'Pass has been invalidated' } });
    }
    if (new Date(pass.expires_at) < new Date()) {
      return res.status(422).json({ error: { code: 'PASS_EXPIRED', message: 'Pass has expired' } });
    }

    // Create visit_log entry with result='pending_guard_decision'
    const scanId = uuid();
    await db.query(
      `INSERT INTO visit_logs
         (id, request_id, visitor_name, category, created_by_apt, created_by_name, created_by_uid,
          actor_name, actor_role, result, timestamp)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())`,
      [
        scanId,
        pass.request_id,
        pass.visitor_name || null,
        pass.request_type || null,
        pass.apartment || null,
        pass.resident_name || null,
        pass.resident_uid || null,
        req.user.name || req.user.uid,
        req.user.role,
        'pending_guard_decision',
      ],
    );

    res.status(201).json({
      scanId,
      pass: {
        id:        pass.pass_id,
        expiresAt: pass.expires_at,
        usedAt:    pass.used_at,
      },
      request: {
        id:           pass.request_id,
        type:         pass.request_type,
        visitorName:  pass.visitor_name || null,
        visitorPhone: pass.visitor_phone || null,
        createdByApt: pass.apartment || null,
      },
      resident: {
        name:      pass.resident_name || null,
        apartment: pass.apartment || null,
      },
    });
  } catch (err) { next(err); }
});

// ─── POST /:scanId/admit ──────────────────────────────────────────────────────
router.post('/:scanId/admit', validateScanId, async (req, res, next) => {
  try {
    if (!isStaff(req.user.role)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Staff only' } });
    }

    const db = req.db;
    const { scanId } = req.params;

    // Fetch the visit_log to get request_id and resident info
    const { rows: logRows } = await db.query(
      `SELECT id, request_id, created_by_uid FROM visit_logs WHERE id = $1`,
      [scanId],
    );

    if (!logRows.length) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Scan not found' } });
    }

    const log = logRows[0];

    // Update visit_log result to 'allowed'
    await db.query(
      `UPDATE visit_logs SET result = 'allowed' WHERE id = $1`,
      [scanId],
    );

    // Mark QR pass as used (find pass by request_id, not-yet-used)
    await db.query(
      `UPDATE qr_passes
       SET used_at = NOW(), used_by_uid = $1
       WHERE request_id = $2 AND used_at IS NULL AND invalidated_at IS NULL`,
      [req.user.uid, log.request_id],
    );

    // Dispatch guest.arrived notification to the request creator (non-blocking)
    if (log.created_by_uid) {
      notifyDispatch(
        'guest.arrived',
        { userId: log.created_by_uid, requestId: log.request_id },
        db,
        req.property || null,
      ).catch(() => {});
    }

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── POST /:scanId/deny ───────────────────────────────────────────────────────
router.post('/:scanId/deny', validateScanId, async (req, res, next) => {
  try {
    if (!isStaff(req.user.role)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Staff only' } });
    }

    const db = req.db;
    const { reason } = req.body;

    const { rowCount } = await db.query(
      `UPDATE visit_logs SET result = 'denied', notes = $1 WHERE id = $2`,
      [reason || null, req.params.scanId],
    );

    if (rowCount === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Scan not found' } });
    }

    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
