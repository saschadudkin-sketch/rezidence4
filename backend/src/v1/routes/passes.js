'use strict';

// platform-v1 Passes route — /api/v1/passes.
// Spec: docs/product/specs/platform-v1/passes-spec.md
// Phase: 3 (Access-core).
//
// Пропуск как first-class entity: временной bounded grant на проход/проезд.
// В legacy пропуск был неявный (`requests WHERE type IN ('pass','car')` + FK из
// `qr_passes.request_id`).  Здесь `passes` — отдельная таблица, `qr_passes_v2`
// держит только QR-представление (token + render_version).
//
// State: active → used | expired | revoked | blocked (см. spec §3).
// Все mutations — с audit_log записью.
//
// Verify scan (проверка token при въезде) — вынесен в visits.js маршруту
// `POST /api/v1/visits/verify`, т.к. scan создаёт visit_log event, и
// семантика «event-первый» помогает читать код.

const express = require('express');
const db = require('../../db');
const logger = require('../../logger');
const { broadcastAccessEvent } = require('../../sse');
const requireAuth = require('../../middleware/auth');
const idempotency = require('../../middleware/idempotency');
const { can, canInPropertyScope } = require('../lib/authz');
const { parsePaginationParams, buildPageMeta } = require('../lib/pagination');
const {
  isResourceScopeServiceError,
  loadResourcePropertyId,
} = require('../services/resourceScope');
const {
  PASS_COLS,
  blockPass,
  canReadPass,
  createPass,
  getCurrentPin,
  getOrCreateQr,
  isPassServiceError,
  regeneratePin,
  regenerateQr,
  revokePass,
  unblockPass,
} = require('../services/passService');
const { listPassesForAdmin } = require('../services/passReadModelService');
const {
  isAccessTopologyServiceError,
  validateAccessTopologyTarget,
} = require('../services/accessTopologyService');

const router = express.Router();
router.use(requireAuth);

// SEC [AUDIT #1] — per-tenant pool, см. комментарий в structure.js.
const getDb = (req) => req.db || db;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PASS_TYPES = new Set([
  'guest', 'vehicle', 'resident', 'staff',
  'contractor', 'courier', 'service', 'emergency',
]);
const PASS_STATUSES = new Set(['active', 'used', 'revoked', 'blocked', 'expired']);
const SUBJECT_TYPES = new Set([
  'resident', 'staff', 'contractor_user', 'vehicle', 'guest',
]);

function isValidUuid(v) { return typeof v === 'string' && UUID_RE.test(v); }
function isValidIso(v) { return typeof v === 'string' && !Number.isNaN(Date.parse(v)); }

function resolvePropertyId(req) {
  return req.property?.id
    || req.property?.property_id
    || req.query?.property_id
    || req.body?.property_id
    || req.user?.property_id
    || req.user?.propertyId
    || null;
}

function sendScopeError(res, err) {
  if (!isResourceScopeServiceError(err)) return false;
  res.status(err.status).json({ error: err.message });
  return true;
}

async function loadPassProperty(req, passId) {
  return loadResourcePropertyId(getDb(req), 'pass', passId, { notFoundMessage: 'Pass not found' });
}

function canReadPassScope(req, propertyId) {
  return canInPropertyScope(req, 'access.pass.read', propertyId);
}

function canManagePassScope(req, propertyId) {
  return canInPropertyScope(req, 'passes:manage', propertyId);
}

function canRevokePassScope(req, propertyId) {
  return canInPropertyScope(req, 'access.pass.revoke', propertyId);
}

function canBlockPassScope(req, propertyId) {
  return canInPropertyScope(req, 'access.pass.block', propertyId);
}

function pinCredentialsEnabled(req) {
  const flags = req.property?.resolvedFlags || req.property?.feature_flags || {};
  return flags.pin_credentials === true;
}

function actorTypeForRole(role) {
  if (role === 'contractor') return 'contractor';
  if (role === 'owner' || role === 'tenant' || role === 'resident') return 'resident';
  if (role === 'system') return 'system';
  return 'staff';
}

function auditLog(req, {
  propertyId,
  action,
  resourceType,
  resourceId,
  changes,
  entityType = resourceType,
  entityId = resourceId,
}) {
  getDb(req).query(
    `INSERT INTO property_audit_log
       (property_id, actor_uid, actor_role, actor_type, entity_type, entity_id,
        action, resource_type, resource_id, changes, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      propertyId,
      req.user?.uid || null,
      req.user?.role || null,
      actorTypeForRole(req.user?.role),
      entityType,
      entityId,
      action,
      resourceType,
      resourceId,
      changes ? JSON.stringify(changes) : null,
      req.ip || null,
    ],
  ).catch((err) => logger.warn({ err, action }, '[v1/passes] audit write failed'));
}

function sendServiceError(res, err) {
  if (!isPassServiceError(err)) return false;
  res.status(err.status).json({ error: err.message });
  return true;
}

function sendKnownError(res, err) {
  if (sendServiceError(res, err)) return true;
  if (!isAccessTopologyServiceError(err)) return false;
  res.status(err.status).json({ error: err.message });
  return true;
}

function emitAccessEvent(req, payload) {
  broadcastAccessEvent(payload, { propertySlug: req.propertySlug });
}

// Validation helper: ensures subject_type/subject_*_id pair is consistent before
// hitting DB CHECK (lets us return 400 vs 500 on violation).
function validateSubject({ subject_type, subject_resident_id, subject_staff_id,
                           subject_contractor_user_id, subject_vehicle_id }) {
  const ids = {
    resident: subject_resident_id,
    staff: subject_staff_id,
    contractor_user: subject_contractor_user_id,
    vehicle: subject_vehicle_id,
  };
  const triple = [subject_resident_id, subject_staff_id, subject_contractor_user_id, subject_vehicle_id];
  if (subject_type === 'guest') {
    return triple.every((v) => v === null || v === undefined)
      ? null
      : 'subject_*_id must all be null for subject_type=guest';
  }
  const expectId = ids[subject_type];
  if (!expectId) return `subject_${subject_type}_id is required for subject_type=${subject_type}`;
  const others = Object.entries(ids).filter(([k]) => k !== subject_type);
  for (const [k, v] of others) {
    if (v) return `subject_${k}_id must be null for subject_type=${subject_type}`;
  }
  return null;
}

// ─── GET /api/v1/passes ──────────────────────────────────────────────────────
// Pagination: ?limit=1..200 (default 50), ?offset=0..100000 (default 0).
// Response: { passes: [...], page: { limit, offset, hasMore } } —
// `passes` сохраняется (back-compat), `page` — additive.
router.get('/', async (req, res, next) => {
  try {
    if (!can(req.user, 'passes:read')) return res.status(403).json({ error: 'Forbidden' });
    const propertyId = resolvePropertyId(req);
    if (!isValidUuid(propertyId)) return res.status(400).json({ error: 'property_id must be UUID' });
    if (!canReadPassScope(req, propertyId)) return res.status(403).json({ error: 'Forbidden' });

    let pagination;
    try {
      pagination = parsePaginationParams(req.query);
    } catch (rangeErr) {
      return res.status(400).json({ error: rangeErr.message });
    }

    const filters = {};
    if (req.query.status) {
      if (!PASS_STATUSES.has(req.query.status)) return res.status(400).json({ error: 'Invalid status' });
      filters.status = req.query.status;
    }
    if (req.query.pass_type) {
      if (!PASS_TYPES.has(req.query.pass_type)) return res.status(400).json({ error: 'Invalid pass_type' });
      filters.pass_type = req.query.pass_type;
    }
    if (req.query.subject_vehicle_id) {
      if (!isValidUuid(req.query.subject_vehicle_id)) return res.status(400).json({ error: 'Invalid subject_vehicle_id' });
      filters.subject_vehicle_id = req.query.subject_vehicle_id;
    }
    if (req.query.subject_resident_id) {
      if (!isValidUuid(req.query.subject_resident_id)) return res.status(400).json({ error: 'Invalid subject_resident_id' });
      filters.subject_resident_id = req.query.subject_resident_id;
    }
    if (req.query.access_request_id) {
      if (!isValidUuid(req.query.access_request_id)) return res.status(400).json({ error: 'Invalid access_request_id' });
      filters.access_request_id = req.query.access_request_id;
    }
    if (req.query.q) filters.q = req.query.q;

    const rows = await listPassesForAdmin({
      queryable: getDb(req),
      propertyId,
      filters,
      pagination,
    });
    res.json({
      passes: rows,
      page: buildPageMeta({ ...pagination, returnedCount: rows.length }),
    });
  } catch (err) { next(err); }
});

// ─── GET /api/v1/passes/:id ──────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const { rows } = await getDb(req).query(`SELECT ${PASS_COLS} FROM passes WHERE id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Pass not found' });
    const pass = rows[0];
    if (can(req.user, 'passes:read') && !canReadPassScope(req, pass.property_id)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Visibility: staff — all; resident — own subject or request-created pass.
    if (!(await canReadPass({
      queryable: getDb(req),
      user: req.user,
      isStaffUser: can(req.user, 'passes:read'),
      pass,
    }))) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { rows: qrRows } = await getDb(req).query(
      `SELECT id, token, render_version, created_at
         FROM pass_credentials
        WHERE pass_id = $1
          AND credential_type = 'qr'
          AND revoked_at IS NULL`,
      [req.params.id],
    );
    res.json({ pass, qr: qrRows[0] || null });
  } catch (err) { next(err); }
});

// ─── GET /api/v1/passes/:id/qr ───────────────────────────────────────────────
// Возвращает актуальный QR-токен.  Создаёт строку qr_passes_v2 если её ещё нет
// (lazy init: пасс мог быть создан до первого запроса QR).
router.get('/:id/qr', async (req, res, next) => {
  try {
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const propertyId = await loadPassProperty(req, req.params.id);
    if (can(req.user, 'passes:read') && !canReadPassScope(req, propertyId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const result = await getOrCreateQr({
      queryable: getDb(req),
      user: req.user,
      isStaffUser: can(req.user, 'passes:read'),
      passId: req.params.id,
      propertyId,
    });
    res.json({ qr: result.qr });
  } catch (err) {
    if (sendScopeError(res, err)) return;
    if (sendServiceError(res, err)) return;
    next(err);
  }
});

// ─── POST /api/v1/passes/:id/regenerate-qr ───────────────────────────────────
// Резидент потерял экран — генерим новый token, инкрементим render_version.
// Старый token становится невалидным сразу (UNIQUE token enforced).
// Idempotency: повторный POST с тем же Idempotency-Key вернёт кеш — клиент
// не создаст лишний QR при retries (network glitches на мобиле).
router.post('/:id/regenerate-qr', idempotency, async (req, res, next) => {
  try {
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const propertyId = await loadPassProperty(req, req.params.id);
    if (can(req.user, 'passes:read') && !canReadPassScope(req, propertyId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const result = await regenerateQr({
      queryable: getDb(req),
      user: req.user,
      isStaffUser: can(req.user, 'passes:read'),
      passId: req.params.id,
      propertyId,
    });
    auditLog(req, {
      propertyId: result.pass.property_id,
      action: 'pass.qr_regenerated',
      resourceType: 'pass',
      resourceId: result.pass.id,
      changes: { render_version: result.qr.render_version },
    });
    res.json({ qr: result.qr });
  } catch (err) {
    if (sendScopeError(res, err)) return;
    if (sendServiceError(res, err)) return;
    next(err);
  }
});

// ─── GET /api/v1/passes/:id/pin ─────────────────────────────────────────────
// Returns the current PIN only when the tenant feature flag and access policy
// allow PIN credentials. The stored verifier remains a hash; display value is
// decrypted only for this authorized response.
router.get('/:id/pin', async (req, res, next) => {
  try {
    if (!pinCredentialsEnabled(req)) {
      return res.status(404).json({ error: { code: 'FEATURE_DISABLED', message: 'PIN credentials are disabled' } });
    }
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const propertyId = await loadPassProperty(req, req.params.id);
    if (can(req.user, 'passes:read') && !canReadPassScope(req, propertyId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const result = await getCurrentPin({
      queryable: getDb(req),
      user: req.user,
      isStaffUser: can(req.user, 'passes:read'),
      passId: req.params.id,
      propertyId,
    });
    res.json({ pin: result.pin });
  } catch (err) {
    if (sendScopeError(res, err)) return;
    if (sendServiceError(res, err)) return;
    next(err);
  }
});

// ─── POST /api/v1/passes/:id/regenerate-pin ─────────────────────────────────
// Generates a fresh PIN, stores only hashed verifier material plus encrypted
// display value, and invalidates the previous PIN by changing the hash.
router.post('/:id/regenerate-pin', idempotency, async (req, res, next) => {
  try {
    if (!pinCredentialsEnabled(req)) {
      return res.status(404).json({ error: { code: 'FEATURE_DISABLED', message: 'PIN credentials are disabled' } });
    }
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const propertyId = await loadPassProperty(req, req.params.id);
    if (can(req.user, 'passes:read') && !canReadPassScope(req, propertyId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const result = await regeneratePin({
      queryable: getDb(req),
      user: req.user,
      isStaffUser: can(req.user, 'passes:read'),
      passId: req.params.id,
      propertyId,
    });
    auditLog(req, {
      propertyId: result.pass.property_id,
      action: 'pass.pin_regenerated',
      resourceType: 'pass',
      resourceId: result.pass.id,
      changes: { render_version: result.pin.render_version, public_display_allowed: result.pin.public_display_allowed },
    });
    res.json({ pin: result.pin });
  } catch (err) {
    if (sendScopeError(res, err)) return;
    if (sendServiceError(res, err)) return;
    next(err);
  }
});

// ─── POST /api/v1/passes ─────────────────────────────────────────────────────
// Создать pass напрямую (staff/contractor onboarding без промежуточной заявки).
// Для passes из одобренной access_request используется accessRequests.approve,
// не этот endpoint.
// Idempotency: optional Idempotency-Key header — defends against
// double-tap при создании пассов из admin UI.
router.post('/', idempotency, async (req, res, next) => {
  try {
    if (!can(req.user, 'passes:manage')) return res.status(403).json({ error: 'Forbidden' });
    const {
      property_id, pass_type, subject_type,
      subject_resident_id = null, subject_staff_id = null,
      subject_contractor_user_id = null, subject_vehicle_id = null,
      zone_id = null, point_id = null,
      valid_from, valid_until,
      access_request_id = null,
    } = req.body || {};

    if (!isValidUuid(property_id)) return res.status(400).json({ error: 'property_id must be UUID' });
    if (!canManagePassScope(req, property_id)) return res.status(403).json({ error: 'Forbidden' });
    if (!PASS_TYPES.has(pass_type)) return res.status(400).json({ error: 'Invalid pass_type' });
    if (!SUBJECT_TYPES.has(subject_type)) return res.status(400).json({ error: 'Invalid subject_type' });
    if (!isValidIso(valid_from) || !isValidIso(valid_until)) {
      return res.status(400).json({ error: 'valid_from and valid_until must be ISO-8601 strings' });
    }
    if (new Date(valid_until) <= new Date(valid_from)) {
      return res.status(400).json({ error: 'valid_until must be after valid_from' });
    }
    const subjErr = validateSubject({
      subject_type, subject_resident_id, subject_staff_id,
      subject_contractor_user_id, subject_vehicle_id,
    });
    if (subjErr) return res.status(400).json({ error: subjErr });
    for (const [k, v] of [
      ['subject_resident_id', subject_resident_id],
      ['subject_staff_id', subject_staff_id],
      ['subject_contractor_user_id', subject_contractor_user_id],
      ['subject_vehicle_id', subject_vehicle_id],
      ['zone_id', zone_id],
      ['point_id', point_id],
      ['access_request_id', access_request_id],
    ]) {
      if (v !== null && !isValidUuid(v)) return res.status(400).json({ error: `${k} must be UUID or null` });
    }
    await validateAccessTopologyTarget(getDb(req), {
      propertyId: property_id,
      zoneId: zone_id,
      pointId: point_id,
    });

    const result = await createPass({
      queryable: getDb(req),
      user: req.user,
      input: {
        property_id,
        access_request_id,
        pass_type,
        subject_type,
        subject_resident_id,
        subject_staff_id,
        subject_contractor_user_id,
        subject_vehicle_id,
        zone_id,
        point_id,
        valid_from,
        valid_until,
      },
    });
    auditLog(req, {
      propertyId: result.pass.property_id,
      action: 'pass.created',
      resourceType: 'pass',
      resourceId: result.pass.id,
      changes: { pass_type, subject_type, zone_id, point_id, valid_from, valid_until },
    });
    res.status(201).json({ pass: result.pass });
  } catch (err) {
    if (sendKnownError(res, err)) return;
    if (err && err.code === '23503') return res.status(400).json({ error: 'referenced entity does not exist' });
    if (err && err.code === '23514') return res.status(400).json({ error: 'pass constraint violation' });
    next(err);
  }
});

// ─── POST /api/v1/passes/:id/revoke ──────────────────────────────────────────
// One-way: revoked — terminal.  reason обязателен (CHECK в БД).
router.post('/:id/revoke', async (req, res, next) => {
  try {
    if (!can(req.user, 'access.pass.revoke')) return res.status(403).json({ error: 'Forbidden' });
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const propertyId = await loadPassProperty(req, req.params.id);
    if (!canRevokePassScope(req, propertyId)) return res.status(403).json({ error: 'Forbidden' });
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!reason) return res.status(400).json({ error: 'reason is required' });

    const result = await revokePass({
      queryable: getDb(req),
      user: req.user,
      passId: req.params.id,
      reason,
      propertyId,
    });
    auditLog(req, {
      propertyId: result.pass.property_id,
      action: 'pass.revoked',
      resourceType: 'pass',
      resourceId: req.params.id,
      changes: { reason },
    });
    emitAccessEvent(req, {
      event_type: 'access.pass.revoked',
      property_id: result.pass.property_id,
      pass_id: req.params.id,
      status: result.pass.status,
    });
    res.json({ pass: result.pass });
  } catch (err) {
    if (sendScopeError(res, err)) return;
    if (sendServiceError(res, err)) return;
    if (err && err.code === '23514') return res.status(400).json({ error: 'constraint violation on revoke' });
    next(err);
  }
});

// ─── POST /api/v1/passes/:id/block ───────────────────────────────────────────
// Security временно блокирует пасс (подозрительный visitor, дубликат, etc.).
// Можно снять через /unblock.  Не terminal.
router.post('/:id/block', async (req, res, next) => {
  try {
    if (!can(req.user, 'access.pass.block')) return res.status(403).json({ error: 'Forbidden' });
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const propertyId = await loadPassProperty(req, req.params.id);
    if (!canBlockPassScope(req, propertyId)) return res.status(403).json({ error: 'Forbidden' });
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : null;
    const result = await blockPass({ queryable: getDb(req), passId: req.params.id, reason, propertyId });
    auditLog(req, {
      propertyId: result.pass.property_id,
      action: 'pass.blocked',
      resourceType: 'pass',
      resourceId: req.params.id,
      changes: { reason },
    });
    emitAccessEvent(req, {
      event_type: 'access.pass.blocked',
      property_id: result.pass.property_id,
      pass_id: req.params.id,
      status: result.pass.status,
    });
    res.json({ pass: result.pass });
  } catch (err) {
    if (sendScopeError(res, err)) return;
    if (sendServiceError(res, err)) return;
    next(err);
  }
});

// ─── POST /api/v1/passes/:id/unblock ─────────────────────────────────────────
router.post('/:id/unblock', async (req, res, next) => {
  try {
    if (!can(req.user, 'access.pass.block')) return res.status(403).json({ error: 'Forbidden' });
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const propertyId = await loadPassProperty(req, req.params.id);
    if (!canBlockPassScope(req, propertyId)) return res.status(403).json({ error: 'Forbidden' });
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!reason) return res.status(400).json({ error: 'reason is required' });
    const policyId = typeof req.body?.policy_id === 'string' ? req.body.policy_id : null;
    const overrideId = typeof req.body?.override_id === 'string' ? req.body.override_id : null;
    if (policyId !== null && !isValidUuid(policyId)) return res.status(400).json({ error: 'policy_id must be UUID' });
    if (overrideId !== null && !isValidUuid(overrideId)) return res.status(400).json({ error: 'override_id must be UUID' });

    const result = await unblockPass({
      queryable: getDb(req),
      passId: req.params.id,
      reason,
      policyId,
      overrideId,
      propertyId,
    });
    auditLog(req, {
      propertyId: result.pass.property_id,
      action: 'pass.unblocked',
      resourceType: 'pass',
      resourceId: req.params.id,
      changes: { reason, policy_id: policyId, override_id: overrideId },
    });
    emitAccessEvent(req, {
      event_type: 'access.pass.unblocked',
      property_id: result.pass.property_id,
      pass_id: req.params.id,
      status: result.pass.status,
    });
    res.json({ pass: result.pass });
  } catch (err) {
    if (sendScopeError(res, err)) return;
    if (sendServiceError(res, err)) return;
    next(err);
  }
});

module.exports = router;
