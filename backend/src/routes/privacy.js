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
const {
  clearAuthCookies,
  deleteRefreshTokensForUser,
  invalidateUserSessionCache,
} = require('../services/authSessionService');
const { isAdmin } = require('../v1/lib/authz');
const {
  buildDataSubjectExport,
  completeDataSubjectRequest,
  createDataSubjectRequest,
  getPrivacyReadinessSummary,
  isPrivacyComplianceServiceError,
  listComplianceEvidence,
  listDataSubjectRequests,
  recordComplianceEvidence,
  resolvePropertyId,
} = require('../services/privacyComplianceService');

const router = express.Router();
router.use(requireAuth);

// Current consent document version.  Bump whenever the privacy policy changes
// so we can tell whether residents have re-accepted the new terms.
const CURRENT_CONSENT_VERSION = process.env.PRIVACY_CONSENT_VERSION || '2026-04-01';

const getDb = (req) => req.db || db;
const getTxPool = (req) => (typeof req.db?.connect === 'function' ? req.db : db.pool);
const getTenantOptions = (req) => (req.propertySlug ? { propertySlug: req.propertySlug } : undefined);
const broadcastWithTenant = (fn, payload, req) => {
  const options = getTenantOptions(req);
  if (options) fn(payload, options);
  else fn(payload);
};

function propertyIdFromReq(req, input = {}) {
  return resolvePropertyId({
    propertyId: req.property?.id || req.property?.property_id || null,
    user: req.user,
    input,
  });
}

function sendPrivacyComplianceError(res, err) {
  if (!isPrivacyComplianceServiceError(err)) return false;
  res.status(err.status).json({ error: err.message });
  return true;
}

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
    const { rows } = await getDb(req).query(
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
    const { rowCount } = await getDb(req).query(
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

// GET /api/v1/privacy/data-subject-export — self-service export snapshot.
// Admin users may pass subject_resident_id; residents only export their own
// legacy/v1-linked subject_uid data.
router.get('/data-subject-export', async (req, res, next) => {
  try {
    const propertyId = propertyIdFromReq(req, req.query);
    const subjectResidentId = isAdmin(req)
      ? (req.query.subject_resident_id || req.query.subjectResidentId || null)
      : null;
    const exportPayload = await buildDataSubjectExport({
      queryable: getDb(req),
      user: req.user,
      propertyId,
      subjectResidentId,
    });
    res.json({ export: exportPayload });
  } catch (err) {
    if (sendPrivacyComplianceError(res, err)) return;
    next(err);
  }
});

// GET /api/v1/privacy/data-subject-requests — resident sees own DSARs;
// property admins see the property queue.
router.get('/data-subject-requests', async (req, res, next) => {
  try {
    const propertyId = propertyIdFromReq(req, req.query);
    const requests = await listDataSubjectRequests({
      queryable: getDb(req),
      propertyId,
      user: req.user,
      filters: req.query,
      isAdmin: isAdmin(req),
      limit: req.query.limit,
    });
    res.json({ requests });
  } catch (err) {
    if (sendPrivacyComplianceError(res, err)) return;
    next(err);
  }
});

// POST /api/v1/privacy/data-subject-requests — DSAR intake for export/delete/
// correct/restrict. Non-admin callers are always bound to their own uid.
router.post('/data-subject-requests', express.json(), async (req, res, next) => {
  try {
    const admin = isAdmin(req);
    if (!admin && req.body?.subject_uid && req.body.subject_uid !== req.user.uid) {
      return res.status(403).json({ error: 'Cannot submit DSAR for another subject' });
    }
    const input = admin
      ? req.body
      : {
        ...req.body,
        subject_uid: req.user.uid,
        subjectUid: req.user.uid,
        subject_resident_id: null,
        subjectResidentId: null,
      };
    const requestRecord = await createDataSubjectRequest({
      queryable: getDb(req),
      user: req.user,
      propertyId: propertyIdFromReq(req, input),
      input,
    });
    res.status(201).json({ request: requestRecord });
  } catch (err) {
    if (sendPrivacyComplianceError(res, err)) return;
    next(err);
  }
});

// POST /api/v1/privacy/data-subject-requests/:id/complete — admin-only DSAR
// resolution with export/retention decision evidence.
router.post('/data-subject-requests/:id/complete', express.json(), async (req, res, next) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    const requestRecord = await completeDataSubjectRequest({
      queryable: getDb(req),
      requestId: req.params.id,
      user: req.user,
      input: req.body,
    });
    res.json({ request: requestRecord });
  } catch (err) {
    if (sendPrivacyComplianceError(res, err)) return;
    next(err);
  }
});

// GET /api/v1/privacy/compliance-evidence — admin evidence history for DH-56
// controls: retention, localization/ISPDn and no-biometrics release guard.
router.get('/compliance-evidence', async (req, res, next) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    const propertyId = propertyIdFromReq(req, req.query);
    const evidence = await listComplianceEvidence({
      queryable: getDb(req),
      propertyId,
      filters: req.query,
      limit: req.query.limit,
    });
    res.json({ evidence });
  } catch (err) {
    if (sendPrivacyComplianceError(res, err)) return;
    next(err);
  }
});

router.post('/compliance-evidence', express.json(), async (req, res, next) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    const propertyId = propertyIdFromReq(req, req.body);
    const evidence = await recordComplianceEvidence({
      queryable: getDb(req),
      user: req.user,
      propertyId,
      input: req.body,
    });
    res.status(201).json({ evidence });
  } catch (err) {
    if (sendPrivacyComplianceError(res, err)) return;
    next(err);
  }
});

// GET /api/v1/privacy/readiness — compact DH-56 readiness snapshot for release
// gates and pilot evidence.
router.get('/readiness', async (req, res, next) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    const propertyId = propertyIdFromReq(req, req.query);
    const readiness = await getPrivacyReadinessSummary({
      queryable: getDb(req),
      propertyId,
    });
    res.json({ readiness });
  } catch (err) {
    if (sendPrivacyComplianceError(res, err)) return;
    next(err);
  }
});

// POST /api/v1/privacy/delete-account — GDPR / ФЗ-152 Art. 14 right-to-be-forgotten.
// Anonymizes the user, invalidates their sessions, logs the request.  Returns
// 202 because the operation is effectively immediate but carries regulatory
// semantics that the client should surface as "accepted".
router.post('/delete-account', express.json(), async (req, res, next) => {
  const { uid, phone } = req.user;
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 500) : null;

  const client = await getTxPool(req).connect();
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

    // Revoke all refresh tokens so current sessions can't re-auth.
    await deleteRefreshTokensForUser(client, uid);

    await client.query(
      `UPDATE privacy_deletion_requests
         SET status = 'completed', processed_at = NOW()
         WHERE id = $1`,
      [auditId],
    );

    await client.query('COMMIT');

    logger.warn({ uid, auditId }, '[privacy] account anonymized on user request');

    await invalidateUserSessionCache(uid, getTenantOptions(req));
    try { broadcastWithTenant(broadcastUserDelete, uid, req); } catch { /* SSE errors should not fail the flow */ }

    // Clear auth cookies so the client is immediately logged out.
    clearAuthCookies(res);

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
