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

function auditLog(req, { action, resourceType, resourceId, changes }) {
  getDb(req).query(
    `INSERT INTO property_audit_log
       (actor_uid, actor_role, action, resource_type, resource_id, changes, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      req.user?.uid || null,
      req.user?.role || null,
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
  res.status(err.status).json({ error: err.message });
  return true;
}

function sendKnownError(res, err) {
  if (sendServiceError(res, err)) return true;
  if (!isAccessTopologyServiceError(err)) return false;
  res.status(err.status).json({ error: err.message });
  return true;
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
  } catch (err) { next(err); }
});

// ─── GET /api/v1/access-requests/:id ─────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const { rows } = await getDb(req).query(`SELECT ${AR_COLS} FROM access_requests WHERE id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Access request not found' });
    const ar = rows[0];

    // Visibility: access staff — всё; resident/contractor — только своё.
    if (can(req.user, 'requests:read')) {
      if (!canReadRequests(req, ar.property_id)) return res.status(403).json({ error: 'Forbidden' });
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
      `SELECT id, approver_type, approver_staff_id, approver_resident_id,
              decision, comment, created_at
         FROM access_approvals
        WHERE access_request_id = $1
        ORDER BY created_at ASC`,
      [req.params.id],
    );
    const passP = getDb(req).query(
      `SELECT id, pass_type, status, valid_from, valid_until
         FROM passes WHERE access_request_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [req.params.id],
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
      reason = null,
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
                          ['target_zone_id', target_zone_id], ['target_point_id', target_point_id]]) {
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
    // guest_access/courier_access: visitor_name рекомендуется (не enforce сейчас).
    if (visitor_name !== null && typeof visitor_name !== 'string') return res.status(400).json({ error: 'visitor_name must be string or null' });
    if (visitor_phone !== null && typeof visitor_phone !== 'string') return res.status(400).json({ error: 'visitor_phone must be string or null' });
    if (reason !== null && typeof reason !== 'string') return res.status(400).json({ error: 'reason must be string or null' });

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
        reason,
        starts_at,
        ends_at,
      },
    });

    auditLog(req, {
      action: 'access_request.created',
      resourceType: 'access_request',
      resourceId: result.access_request.id,
      changes: {
        request_type,
        starts_at,
        ends_at,
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
      `SELECT status, property_id, created_by_resident_id FROM access_requests WHERE id = $1`,
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
    if (curRows[0].status !== 'new') {
      return res.status(409).json({ error: `Cannot submit from status '${curRows[0].status}'` });
    }
    const { rows } = await getDb(req).query(
      `UPDATE access_requests SET status = 'pending_approval', updated_at = NOW()
         WHERE id = $1 RETURNING ${AR_COLS}`,
      [req.params.id],
    );
    auditLog(req, {
      action: 'access_request.submitted',
      resourceType: 'access_request',
      resourceId: req.params.id,
      changes: null,
    });
    res.json({ access_request: rows[0] });
  } catch (err) { next(err); }
});

// ─── POST /api/v1/access-requests/:id/approve ────────────────────────────────
// Транзакция: access_approvals INSERT + access_requests UPDATE + passes INSERT.
router.post('/:id/approve', async (req, res, next) => {
  if (!can(req.user, 'access.request.approve')) return res.status(403).json({ error: 'Forbidden' });
  if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });

  const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim() : null;
  try {
    const propertyId = await loadAccessRequestProperty(req, req.params.id);
    if (!canApproveRequest(req, propertyId)) return res.status(403).json({ error: 'Forbidden' });
    const result = await approveAccessRequest({
      txPool: getTxPool(req),
      user: req.user,
      accessRequestId: req.params.id,
      comment,
    });
    auditLog(req, {
      action: 'access_request.approved',
      resourceType: 'access_request',
      resourceId: req.params.id,
      changes: { pass_id: result.pass.id },
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
  if (!comment) return res.status(400).json({ error: 'reason is required' });

  try {
    const propertyId = await loadAccessRequestProperty(req, req.params.id);
    if (!canRejectRequest(req, propertyId)) return res.status(403).json({ error: 'Forbidden' });
    const result = await rejectAccessRequest({
      txPool: getTxPool(req),
      user: req.user,
      accessRequestId: req.params.id,
      comment,
    });
    auditLog(req, {
      action: 'access_request.rejected',
      resourceType: 'access_request',
      resourceId: req.params.id,
      changes: { reason: comment },
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
    });
    auditLog(req, {
      action: 'access_request.cancelled',
      resourceType: 'access_request',
      resourceId: req.params.id,
      changes: null,
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
  try {
    const propertyId = await loadAccessRequestProperty(req, req.params.id);
    if (!canEscalateRequest(req, propertyId)) return res.status(403).json({ error: 'Forbidden' });
    const result = await escalateAccessRequest({
      txPool: getTxPool(req),
      user: req.user,
      accessRequestId: req.params.id,
      comment,
    });
    auditLog(req, {
      action: 'access_request.escalated',
      resourceType: 'access_request',
      resourceId: req.params.id,
      changes: { comment },
    });
    res.json({ ok: true, access_request_id: req.params.id, access_request: result.access_request });
  } catch (err) {
    if (sendScopeError(res, err)) return;
    if (sendKnownError(res, err)) return;
    next(err);
  }
});

module.exports = router;
