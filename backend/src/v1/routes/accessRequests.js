'use strict';

// platform-v1 Access-Requests route — /api/v1/access-requests (+ approvals).
// Spec: docs/product/specs/platform-v1/access-requests-spec.md
// Phase: 3 (Access-core).
//
// Заявка на доступ: резидент/staff/contractor просит пропустить
// гостя/авто/курьера в конкретное окно.  Жизненный цикл:
//   new → pending_approval → escalated → approved | rejected
//                         ↘ approved | rejected | cancelled | expired
//
// Отличие от legacy `requests`: access и service разделены; заявки не
// используются как монолит-таблица задач УК.  Service-request модель будет
// добавлена в Фазе 6.
//
// Ключевой инвариант: переход `approve` ДОЛЖЕН быть транзакционным — либо
// одновременно пишется access_approvals row, статус заявки = 'approved' и
// создаётся пасс, либо откатываем всё (acceptance §6).

const express = require('express');
const db = require('../../db');
const logger = require('../../logger');
const { broadcastAccessEvent } = require('../../sse');
const requireAuth = require('../../middleware/auth');
const idempotency = require('../../middleware/idempotency');
const { can, canInPropertyScope, isAdmin } = require('../lib/authz');
const { parsePaginationParams, buildPageMeta } = require('../lib/pagination');
const {
  isResourceScopeServiceError,
  loadResourcePropertyId,
} = require('../services/resourceScope');
const {
  resolveResidentIdByUid,
  resolveContractorUserIdByUid,
} = require('../services/accessActorResolver');
const {
  AR_COLS,
  approveAccessRequest,
  cancelAccessRequest,
  createAccessRequest,
  escalateAccessRequest,
  isAccessRequestServiceError,
  rejectAccessRequest,
  submitAccessRequest,
} = require('../services/accessRequestService');
const {
  isAccessTopologyServiceError,
  validateAccessTopologyTarget,
} = require('../services/accessTopologyService');

const router = express.Router();
router.use(requireAuth);

// SEC [AUDIT #1] — per-tenant pool, см. комментарий в structure.js.
// У `req.db` (pg.Pool, приходит из propertyDbMiddleware) метод .connect()
// есть сразу, у legacy-модуля db — только через db.pool.  getTxPool
// нормализует это для BEGIN/ROLLBACK транзакций.
const getDb = (req) => req.db || db;
const getTxPool = (req) => (typeof req.db?.connect === 'function' ? req.db : db.pool);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUEST_TYPES = new Set([
  'guest_access', 'vehicle_access', 'contractor_access',
  'courier_access', 'service_access', 'temporary_resident_access',
]);

function isValidUuid(v) { return typeof v === 'string' && UUID_RE.test(v); }
// Shim под legacy callsite: isPropertyAdmin → isAdmin из authz.
function isPropertyAdmin(req, propertyId = null) {
  if (!propertyId) return isAdmin(req);
  return canInPropertyScope(req, 'requests:write', propertyId);
}
function isValidIso(v) { return typeof v === 'string' && !Number.isNaN(Date.parse(v)); }

function normalizeOptionalText(value, field, maxLength = 1000) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    const err = new Error(`${field} must be string or null`);
    err.status = 400;
    throw err;
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) {
    const err = new Error(`${field} is too long`);
    err.status = 400;
    throw err;
  }
  return trimmed;
}

function normalizeShareDeliveryChannels(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 5) {
    const err = new Error('share_delivery_channels must be an array');
    err.status = 400;
    throw err;
  }
  const allowed = new Set(['link', 'qr', 'sms', 'telegram', 'email']);
  const channels = [];
  for (const channel of value) {
    if (typeof channel !== 'string' || !allowed.has(channel)) {
      const err = new Error('share_delivery_channels contains unsupported channel');
      err.status = 400;
      throw err;
    }
    if (!channels.includes(channel)) channels.push(channel);
  }
  return channels;
}

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

async function loadAccessRequestProperty(req, accessRequestId) {
  return loadResourcePropertyId(getDb(req), 'access_request', accessRequestId, {
    notFoundMessage: 'Access request not found',
  });
}

async function validateVehicleForRequest(req, res, { vehicleId, propertyId }) {
  if (!vehicleId) return true;
  const { rows } = await getDb(req).query(
    `SELECT id, property_id, owner_resident_id, owner_contractor_user_id
       FROM vehicles
      WHERE id = $1`,
    [vehicleId],
  );
  if (!rows[0]) {
    res.status(404).json({ error: 'Vehicle not found' });
    return false;
  }
  if (rows[0].property_id !== propertyId) {
    res.status(403).json({ error: 'Vehicle belongs to another property' });
    return false;
  }
  if (can(req.user, 'requests:read')) return true;

  if (isContractorRole(req.user.role)) {
    const contractorUserId = await requireContractorUserId(req, res);
    if (!contractorUserId) return false;
    if (rows[0].owner_contractor_user_id !== contractorUserId) {
      res.status(403).json({ error: 'Vehicle does not belong to contractor' });
      return false;
    }
    return true;
  }

  const residentId = await requireResidentId(req, res);
  if (!residentId) return false;
  if (rows[0].owner_resident_id !== residentId) {
    res.status(403).json({ error: 'Vehicle does not belong to resident' });
    return false;
  }
  return true;
}

async function validateUnitForRequest(req, res, { unitId, propertyId }) {
  if (!unitId) return true;
  const { rows } = await getDb(req).query(
    `SELECT id, property_id
       FROM units
      WHERE id = $1`,
    [unitId],
  );
  if (!rows[0]) {
    res.status(400).json({ error: 'target_unit_id does not exist' });
    return false;
  }
  if (rows[0].property_id !== propertyId) {
    res.status(403).json({ error: 'target_unit_id belongs to another property' });
    return false;
  }
  if (can(req.user, 'requests:read') || isContractorRole(req.user.role)) return true;

  const residentId = await requireResidentId(req, res);
  if (!residentId) return false;
  const membership = await getDb(req).query(
    `SELECT 1
       FROM residents
      WHERE id = $1
        AND property_id = $2
        AND unit_id = $3
        AND is_active = true
     UNION
     SELECT 1
       FROM resident_unit_links
      WHERE resident_id = $1
        AND property_id = $2
        AND unit_id = $3
        AND is_active = true
        AND (starts_at IS NULL OR starts_at <= NOW())
        AND (ends_at IS NULL OR ends_at > NOW())
      LIMIT 1`,
    [residentId, propertyId, unitId],
  );
  if (!membership.rows[0]) {
    res.status(403).json({ error: 'target_unit_id does not belong to resident' });
    return false;
  }
  return true;
}

function canReadRequests(req, propertyId) {
  return canInPropertyScope(req, 'requests:read', propertyId);
}

function canApproveRequest(req, propertyId) {
  return canInPropertyScope(req, 'access.request.approve', propertyId);
}

function canRejectRequest(req, propertyId) {
  return canInPropertyScope(req, 'access.request.reject', propertyId);
}

function canEscalateRequest(req, propertyId) {
  return canInPropertyScope(req, 'requests:escalate', propertyId);
}

async function requireResidentId(req, res) {
  const residentId = await resolveResidentIdByUid(getDb(req), req.user?.uid);
  if (!residentId) {
    res.status(403).json({ error: 'Resident identity is not mapped to v1' });
    return null;
  }
  return residentId;
}

function isContractorRole(role) {
  return role === 'contractor';
}

async function requireContractorUserId(req, res) {
  const contractorUserId = await resolveContractorUserIdByUid(getDb(req), req.user?.uid);
  if (!contractorUserId) {
    res.status(403).json({ error: 'Contractor identity is not mapped to v1' });
    return null;
  }
  return contractorUserId;
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
  ).catch((err) => logger.warn({ err, action }, '[v1/access-requests] audit write failed'));
}

function sendServiceError(res, err) {
  if (!isAccessRequestServiceError(err)) return false;
  res.status(err.status).json({ error: err.message, ...(err.details || {}) });
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

// ─── GET /api/v1/access-requests ─────────────────────────────────────────────
// Pagination: ?limit=1..200 (default 50), ?offset=0..100000 (default 0)
router.get('/', async (req, res, next) => {
  try {
    let pagination;
    try {
      pagination = parsePaginationParams(req.query);
    } catch (rangeErr) {
      return res.status(400).json({ error: rangeErr.message });
    }

    const filters = [];
    const params = [];

    // Резиденты/contractors видят только свои; access staff — только property scope.
    if (can(req.user, 'requests:read')) {
      const propertyId = resolvePropertyId(req);
      if (!isValidUuid(propertyId)) return res.status(400).json({ error: 'property_id must be UUID' });
      if (!canReadRequests(req, propertyId)) return res.status(403).json({ error: 'Forbidden' });
      params.push(propertyId);
      filters.push(`property_id = $${params.length}`);
    } else {
      if (isContractorRole(req.user.role)) {
        const contractorUserId = await requireContractorUserId(req, res);
        if (!contractorUserId) return;
        params.push(contractorUserId);
        filters.push(`created_by_contractor_user_id = $${params.length}`);
      } else {
        const residentId = await requireResidentId(req, res);
        if (!residentId) return;
        params.push(residentId);
        filters.push(`created_by_resident_id = $${params.length}`);
      }
    }
    if (req.query.status) {
      params.push(String(req.query.status));
      filters.push(`status = $${params.length}`);
    }
    if (req.query.created_by_resident_id) {
      if (!isValidUuid(req.query.created_by_resident_id)) {
        return res.status(400).json({ error: 'Invalid created_by_resident_id' });
      }
      params.push(req.query.created_by_resident_id);
      filters.push(`created_by_resident_id = $${params.length}`);
    }
    if (req.query.created_by_contractor_user_id) {
      if (!isValidUuid(req.query.created_by_contractor_user_id)) {
        return res.status(400).json({ error: 'Invalid created_by_contractor_user_id' });
      }
      params.push(req.query.created_by_contractor_user_id);
      filters.push(`created_by_contractor_user_id = $${params.length}`);
    }
    if (req.query.request_type) {
      if (!REQUEST_TYPES.has(req.query.request_type)) {
        return res.status(400).json({ error: 'Invalid request_type' });
      }
      params.push(req.query.request_type);
      filters.push(`request_type = $${params.length}`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    params.push(pagination.limit);
    const limitIdx = params.length;
    params.push(pagination.offset);
    const offsetIdx = params.length;

    const { rows } = await getDb(req).query(
      `SELECT ${AR_COLS} FROM access_requests ${where}
        ORDER BY created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );
    res.json({
      access_requests: rows,
      page: buildPageMeta({ ...pagination, returnedCount: rows.length }),
    });
  } catch (err) {
    if (sendScopeError(res, err)) return;
    next(err);
  }
});

// ─── GET /api/v1/access-requests/:id ─────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const propertyId = await loadAccessRequestProperty(req, req.params.id);
    const { rows } = await getDb(req).query(
      `SELECT ${AR_COLS} FROM access_requests WHERE id = $1 AND property_id = $2`,
      [req.params.id, propertyId],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Access request not found' });
    const ar = rows[0];

    // Visibility: access staff — всё; resident/contractor — только своё.
    if (can(req.user, 'requests:read')) {
      if (!canReadRequests(req, propertyId)) return res.status(403).json({ error: 'Forbidden' });
    } else {
      if (isContractorRole(req.user.role)) {
        const contractorUserId = await requireContractorUserId(req, res);
        if (!contractorUserId) return;
        if (ar.created_by_contractor_user_id !== contractorUserId) {
          return res.status(403).json({ error: 'Forbidden' });
        }
      } else {
        const residentId = await requireResidentId(req, res);
        if (!residentId) return;
        if (ar.created_by_resident_id !== residentId) {
          return res.status(403).json({ error: 'Forbidden' });
        }
      }
    }

    const approvalsP = getDb(req).query(
      `SELECT aa.id, aa.approver_type, aa.approver_staff_id, aa.approver_resident_id,
              decision, comment, aa.created_at
         FROM access_approvals aa
         JOIN access_requests ar
           ON ar.id = aa.access_request_id
          AND ar.property_id = $2
        WHERE aa.access_request_id = $1
        ORDER BY aa.created_at ASC`,
      [req.params.id, ar.property_id],
    );
    const passP = getDb(req).query(
      `SELECT id, pass_type, status, valid_from, valid_until
         FROM passes
        WHERE access_request_id = $1
          AND property_id = $2
        ORDER BY created_at DESC LIMIT 1`,
      [req.params.id, ar.property_id],
    );
    const [approvalsR, passR] = await Promise.all([approvalsP, passP]);
    res.json({
      access_request: ar,
      approvals: approvalsR.rows,
      pass: passR.rows[0] || null,
    });
  } catch (err) { next(err); }
});

// ─── POST /api/v1/access-requests ────────────────────────────────────────────
// Создание.  Resident/staff/contractor пишутся в отдельные v1 actor FK.
// Idempotency: optional Idempotency-Key — защита от double-tap при создании
// заявки из резидентского UI.
router.post('/', idempotency, async (req, res, next) => {
  try {
    if (!can(req.user, 'access.request.create')) return res.status(403).json({ error: 'Forbidden' });
    const {
      property_id, request_type,
      visitor_name = null, visitor_phone = null, vehicle_id = null,
      target_unit_id = null, target_zone_id = null, target_point_id = null,
      trusted_visitor_id = null,
      request_id = null,
      reason = null,
      guest_instructions = null,
      guard_notes = null,
      share_delivery_channels = [],
      starts_at, ends_at,
    } = req.body || {};

    if (!isValidUuid(property_id)) return res.status(400).json({ error: 'property_id must be UUID' });
    if (!canInPropertyScope(req, 'access.request.create', property_id)) return res.status(403).json({ error: 'Forbidden' });
    if (!REQUEST_TYPES.has(request_type)) return res.status(400).json({ error: 'Invalid request_type' });
    if (!isValidIso(starts_at) || !isValidIso(ends_at)) {
      return res.status(400).json({ error: 'starts_at and ends_at must be ISO-8601 strings' });
    }
    if (new Date(ends_at) <= new Date(starts_at)) {
      return res.status(400).json({ error: 'ends_at must be after starts_at' });
    }
    for (const [k, v] of [['vehicle_id', vehicle_id], ['target_unit_id', target_unit_id],
                          ['target_zone_id', target_zone_id], ['target_point_id', target_point_id],
                          ['trusted_visitor_id', trusted_visitor_id]]) {
      if (v !== null && !isValidUuid(v)) return res.status(400).json({ error: `${k} must be UUID or null` });
    }
    await validateAccessTopologyTarget(getDb(req), {
      propertyId: property_id,
      zoneId: target_zone_id,
      pointId: target_point_id,
      zoneField: 'target_zone_id',
      pointField: 'target_point_id',
    });

    // vehicle_access: vehicle_id обязателен.
    if (request_type === 'vehicle_access' && !vehicle_id) {
      return res.status(400).json({ error: 'vehicle_access requires vehicle_id' });
    }
    if (!(await validateVehicleForRequest(req, res, { vehicleId: vehicle_id, propertyId: property_id }))) {
      return;
    }
    if (!(await validateUnitForRequest(req, res, { unitId: target_unit_id, propertyId: property_id }))) {
      return;
    }
    // guest_access/courier_access: visitor_name рекомендуется (не enforce сейчас).
    if (visitor_name !== null && typeof visitor_name !== 'string') return res.status(400).json({ error: 'visitor_name must be string or null' });
    if (visitor_phone !== null && typeof visitor_phone !== 'string') return res.status(400).json({ error: 'visitor_phone must be string or null' });
    let normalizedReason;
    let normalizedGuestInstructions;
    let normalizedGuardNotes;
    let normalizedShareDeliveryChannels;
    try {
      normalizedReason = normalizeOptionalText(reason, 'reason');
      normalizedGuestInstructions = normalizeOptionalText(guest_instructions, 'guest_instructions');
      normalizedGuardNotes = normalizeOptionalText(guard_notes, 'guard_notes');
      normalizedShareDeliveryChannels = normalizeShareDeliveryChannels(share_delivery_channels);
    } catch (validationErr) {
      return res.status(validationErr.status || 400).json({ error: validationErr.message });
    }
    if (request_id !== null && (typeof request_id !== 'string' || !request_id.trim() || request_id.length > 128)) {
      return res.status(400).json({ error: 'request_id must be a non-empty string or null' });
    }

    const result = await createAccessRequest({
      queryable: getDb(req),
      txPool: getTxPool(req),
      property: req.property,
      user: req.user,
      input: {
        property_id,
        request_type,
        visitor_name,
        visitor_phone,
        vehicle_id,
        target_unit_id,
        target_zone_id,
        target_point_id,
        trusted_visitor_id,
        request_id,
        reason: normalizedReason,
        guest_instructions: normalizedGuestInstructions,
        guard_notes: normalizedGuardNotes,
        share_delivery_channels: normalizedShareDeliveryChannels,
        starts_at,
        ends_at,
      },
    });

    auditLog(req, {
      propertyId: result.access_request.property_id,
      action: 'access_request.created',
      resourceType: 'access_request',
      resourceId: result.access_request.id,
      changes: {
        request_type,
        starts_at,
        ends_at,
        guest_instructions: Boolean(normalizedGuestInstructions),
        guard_notes: Boolean(normalizedGuardNotes),
        trusted_visitor_id: trusted_visitor_id || null,
        approval_required: result.approval_required,
        pass_id: result.pass?.id || null,
      },
    });
    res.status(201).json({ access_request: result.access_request, pass: result.pass });
  } catch (err) {
    if (sendKnownError(res, err)) return;
    if (err && err.code === '23503') return res.status(400).json({ error: 'referenced entity does not exist' });
    if (err && err.code === '23514') return res.status(400).json({ error: 'access_request constraint violation' });
    next(err);
  }
});

// ─── POST /api/v1/access-requests/:id/submit ─────────────────────────────────
// new → pending_approval.  Делает creator; staff тоже допустим.
router.post('/:id/submit', async (req, res, next) => {
  try {
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const { rows: curRows } = await getDb(req).query(
      `SELECT property_id, created_by_resident_id FROM access_requests WHERE id = $1`,
      [req.params.id],
    );
    if (!curRows[0]) return res.status(404).json({ error: 'Access request not found' });
    if (can(req.user, 'requests:write')) {
      if (!canInPropertyScope(req, 'requests:write', curRows[0].property_id)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    } else {
      const residentId = await requireResidentId(req, res);
      if (!residentId) return;
      if (curRows[0].created_by_resident_id !== residentId) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }
    const result = await submitAccessRequest({
      txPool: getTxPool(req),
      accessRequestId: req.params.id,
      propertyId: curRows[0].property_id,
    });
    auditLog(req, {
      propertyId: result.access_request.property_id,
      action: 'access_request.submitted',
      resourceType: 'access_request',
      resourceId: req.params.id,
      changes: null,
    });
    res.json(result);
  } catch (err) {
    if (sendKnownError(res, err)) return;
    next(err);
  }
});

// ─── POST /api/v1/access-requests/:id/approve ────────────────────────────────
// Транзакция: access_approvals INSERT + access_requests UPDATE + passes INSERT.
router.post('/:id/approve', async (req, res, next) => {
  if (!can(req.user, 'access.request.approve')) return res.status(403).json({ error: 'Forbidden' });
  if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });

  const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim() : null;
  const expectedCurrentStatus = typeof req.body?.expectedCurrentStatus === 'string'
    ? req.body.expectedCurrentStatus
    : null;
  try {
    const propertyId = await loadAccessRequestProperty(req, req.params.id);
    if (!canApproveRequest(req, propertyId)) return res.status(403).json({ error: 'Forbidden' });
    const result = await approveAccessRequest({
      txPool: getTxPool(req),
      user: req.user,
      accessRequestId: req.params.id,
      comment,
      expectedCurrentStatus,
      propertyId,
    });
    auditLog(req, {
      propertyId: result.access_request.property_id,
      action: 'access_request.approved',
      resourceType: 'access_request',
      resourceId: req.params.id,
      changes: { pass_id: result.pass.id },
    });
    emitAccessEvent(req, {
      event_type: 'access.request.approved',
      property_id: result.access_request.property_id,
      access_request_id: req.params.id,
      pass_id: result.pass.id,
      status: result.access_request.status,
    });
    res.json({ access_request: result.access_request, pass: result.pass });
  } catch (err) {
    if (sendScopeError(res, err)) return;
    if (sendKnownError(res, err)) return;
    if (err && err.code === '23503') return res.status(400).json({ error: 'referenced entity does not exist' });
    if (err && err.code === '23514') return res.status(400).json({ error: 'constraint violation during approve' });
    next(err);
  }
});

// ─── POST /api/v1/access-requests/:id/reject ─────────────────────────────────
router.post('/:id/reject', async (req, res, next) => {
  if (!can(req.user, 'access.request.reject')) return res.status(403).json({ error: 'Forbidden' });
  if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const comment = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  const expectedCurrentStatus = typeof req.body?.expectedCurrentStatus === 'string'
    ? req.body.expectedCurrentStatus
    : null;
  if (!comment) return res.status(400).json({ error: 'reason is required' });

  try {
    const propertyId = await loadAccessRequestProperty(req, req.params.id);
    if (!canRejectRequest(req, propertyId)) return res.status(403).json({ error: 'Forbidden' });
    const result = await rejectAccessRequest({
      txPool: getTxPool(req),
      user: req.user,
      accessRequestId: req.params.id,
      comment,
      expectedCurrentStatus,
      propertyId,
    });
    auditLog(req, {
      propertyId: result.access_request.property_id,
      action: 'access_request.rejected',
      resourceType: 'access_request',
      resourceId: req.params.id,
      changes: { reason: comment },
    });
    emitAccessEvent(req, {
      event_type: 'access.request.rejected',
      property_id: result.access_request.property_id,
      access_request_id: req.params.id,
      status: result.access_request.status,
    });
    res.json({ access_request: result.access_request });
  } catch (err) {
    if (sendScopeError(res, err)) return;
    if (sendKnownError(res, err)) return;
    next(err);
  }
});

// ─── POST /api/v1/access-requests/:id/cancel ─────────────────────────────────
// Отмена создателем (или property_admin).  Terminal после вызова.
//
// AUDIT #3: BEGIN + SELECT FOR UPDATE, как в approve/reject — иначе два
// одновременных cancel (или approve+cancel) могут оба прочитать 'pending',
// оба сделать UPDATE, и мы получим поломанный audit-trail ("cancelled после
// approved" — читается как пост-фактум отмена, хотя на самом деле race).
router.post('/:id/cancel', async (req, res, next) => {
  if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const propertyId = await loadAccessRequestProperty(req, req.params.id);
    const result = await cancelAccessRequest({
      txPool: getTxPool(req),
      user: req.user,
      accessRequestId: req.params.id,
      isPropertyAdmin: isPropertyAdmin(req, propertyId),
      expectedCurrentStatus: typeof req.body?.expectedCurrentStatus === 'string'
        ? req.body.expectedCurrentStatus
        : null,
      propertyId,
    });
    auditLog(req, {
      propertyId: result.access_request.property_id,
      action: 'access_request.cancelled',
      resourceType: 'access_request',
      resourceId: req.params.id,
      changes: null,
    });
    emitAccessEvent(req, {
      event_type: 'access.request.cancelled',
      property_id: result.access_request.property_id,
      access_request_id: req.params.id,
      status: result.access_request.status,
    });
    res.json({ access_request: result.access_request });
  } catch (err) {
    if (sendScopeError(res, err)) return;
    if (sendKnownError(res, err)) return;
    next(err);
  }
});

// ─── POST /api/v1/access-requests/:id/escalate ───────────────────────────────
// Staff просит property_admin'а посмотреть заявку.  Пишет approval и переводит
// заявку в status='escalated', чтобы state machine совпадала с production plan.
router.post('/:id/escalate', async (req, res, next) => {
  if (!can(req.user, 'requests:escalate')) return res.status(403).json({ error: 'Forbidden' });
  if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim() : null;
  const expectedCurrentStatus = typeof req.body?.expectedCurrentStatus === 'string'
    ? req.body.expectedCurrentStatus
    : null;
  try {
    const propertyId = await loadAccessRequestProperty(req, req.params.id);
    if (!canEscalateRequest(req, propertyId)) return res.status(403).json({ error: 'Forbidden' });
    const result = await escalateAccessRequest({
      txPool: getTxPool(req),
      user: req.user,
      accessRequestId: req.params.id,
      comment,
      expectedCurrentStatus,
      propertyId,
    });
    auditLog(req, {
      propertyId: result.access_request.property_id,
      action: 'access_request.escalated',
      resourceType: 'access_request',
      resourceId: req.params.id,
      changes: { comment },
    });
    emitAccessEvent(req, {
      event_type: 'access.request.escalated',
      property_id: result.access_request.property_id,
      access_request_id: req.params.id,
      status: result.access_request.status,
    });
    res.json({ ok: true, access_request_id: req.params.id, access_request: result.access_request });
  } catch (err) {
    if (sendScopeError(res, err)) return;
    if (sendKnownError(res, err)) return;
    next(err);
  }
});

module.exports = router;
