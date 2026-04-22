'use strict';

// ФЗ-152 runtime — consent tracking and subject-access / right-to-be-forgotten
// endpoints.  Kept intentionally small: we do not build a full consent manager
// here, just enough to:
//   * record that a given resident accepted the current consent version;
//   * let the resident request deletion of their personal data;
//   * keep an audit trail for regulators.
//
// Anonymization strategy: we do NOT hard-delete the user row, because downstream
// requests/chat messages/visit logs reference it via FK.  Instead we null out
// every identifying column and mark `anonymized_at`.  Operational history
// survives in a non-identifying form.

const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const requireAuth = require('../middleware/auth');
const logger = require('../logger');
const { broadcastUserDelete } = require('../sse');

const router = express.Router();
router.use(requireAuth);

// Current consent document version.  Bump whenever the privacy policy changes
// so we can tell whether residents have re-accepted the new terms.
const CURRENT_CONSENT_VERSION = process.env.PRIVACY_CONSENT_VERSION || '2026-04-01';

function hashPhone(phone) {
  if (!phone) return null;
  return crypto
    .createHash('sha256')
    .update(String(phone))
    .digest('hex');
}

// GET /api/v1/privacy/consent — current consent state for the authenticated user.
router.get('/consent', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT consent_accepted_at, consent_version
         FROM users
         WHERE uid = $1 AND deleted_at IS NULL`,
      [req.user.uid],
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({
      currentVersion: CURRENT_CONSENT_VERSION,
      acceptedVersion: row.consent_version,
      acceptedAt: row.consent_accepted_at,
      needsAcceptance: row.consent_version !== CURRENT_CONSENT_VERSION,
    });
  } catch (err) { next(err); }
});

// POST /api/v1/privacy/consent — record that the user has accepted the
// current consent version.  Idempotent: re-accepting the same version just
// refreshes `consent_accepted_at`.
router.post('/consent', express.json(), async (req, res, next) => {
  try {
    const version = String(req.body?.version || CURRENT_CONSENT_VERSION);
    if (version !== CURRENT_CONSENT_VERSION) {
      return res.status(400).json({ error: 'Consent version mismatch', currentVersion: CURRENT_CONSENT_VERSION });
    }
    const { rowCount } = await db.query(
      `UPDATE users
         SET consent_accepted_at = NOW(), consent_version = $2, updated_at = NOW()
         WHERE uid = $1 AND deleted_at IS NULL`,
      [req.user.uid, version],
    );
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    logger.info({ uid: req.user.uid, version }, '[privacy] consent accepted');
    res.json({ ok: true, version, acceptedAt: new Date().toISOString() });
  } catch (err) { next(err); }
});

// POST /api/v1/privacy/delete-account — GDPR / ФЗ-152 Art. 14 right-to-be-forgotten.
// Anonymizes the user, invalidates their sessions, logs the request.  Returns
// 202 because the operation is effectively immediate but carries regulatory
// semantics that the client should surface as "accepted".
router.post('/delete-account', express.json(), async (req, res, next) => {
  const { uid, phone } = req.user;
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 500) : null;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Record the request first so we have an audit trail even if subsequent
    // steps fail.
    const { rows: auditRows } = await client.query(
      `INSERT INTO privacy_deletion_requests (uid, phone_hash, reason, status)
         VALUES ($1, $2, $3, 'pending')
         RETURNING id`,
      [uid, hashPhone(phone), reason],
    );
    const auditId = auditRows[0].id;

    // Anonymize the user: strip PII, keep uid so FK references stay valid.
    // We replace phone with a non-colliding sentinel (the uid itself prefixed)
    // so the UNIQUE(phone) constraint is preserved.
    await client.query(
      `UPDATE users
         SET name         = 'Удалённый пользователь',
             phone        = 'deleted:' || uid,
             apartment    = NULL,
             avatar       = NULL,
             anonymized_at = NOW(),
             deleted_at    = NOW(),
             updated_at    = NOW()
         WHERE uid = $1`,
      [uid],
    );

    // Strip PII from chat messages authored by this user.  We keep the message
    // text (operational history) but replace the display name.
    await client.query(
      `UPDATE chat_messages
         SET name = 'Удалённый пользователь'
         WHERE uid = $1`,
      [uid],
    );

    // Revoke all refresh tokens so current sessions can't re-auth.  The table
    // may not exist in all deployments, so swallow the "table not found" error.
    await client.query(
      `DELETE FROM refresh_tokens WHERE uid = $1`,
      [uid],
    ).catch((err) => {
      if (err.code !== '42P01') throw err; // 42P01 = undefined_table
    });

    await client.query(
      `UPDATE privacy_deletion_requests
         SET status = 'completed', processed_at = NOW()
         WHERE id = $1`,
      [auditId],
    );

    await client.query('COMMIT');

    logger.warn({ uid, auditId }, '[privacy] account anonymized on user request');

    try { broadcastUserDelete(uid); } catch { /* SSE errors should not fail the flow */ }

    // Clear auth cookies so the client is immediately logged out.
    res.clearCookie('rezi_at', { path: '/' });
    res.clearCookie('rezi_rt', { path: '/' });

    res.status(202).json({ ok: true, auditId });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore rollback error */ }
    logger.error({ err, uid }, '[privacy] delete-account failed');
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
module.exports.CURRENT_CONSENT_VERSION = CURRENT_CONSENT_VERSION;
