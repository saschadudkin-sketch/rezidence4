'use strict';

// Access rollout Phase 4 — trusted visitors / frequent guests.
// Route stays thin: validation, auth, audit; business rules live in service.

const express = require('express');
const db = require('../../db');
const logger = require('../../logger');
const requireAuth = require('../../middleware/auth');
const { can, canInPropertyScope } = require('../lib/authz');
const { resolveResidentIdByUid } = require('../services/accessActorResolver');
const {
  createPassFromTrustedVisitor,
  createTrustedVisitor,
  deactivateTrustedVisitor,
  isTrustedVisitorServiceError,
  listTrustedVisitors,
  updateTrustedVisitor,
} = require('../services/trustedVisitorService');
const { isAccessRequestServiceError } = require('../services/accessRequestService');
const { isAccessTopologyServiceError } = require('../services/accessTopologyService');

const router = express.Router();
router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const getDb = (req) => req.db || db;
const getTxPool = (req) => (typeof req.db?.connect === 'function' ? req.db : db.pool);

function isValidUuid(v) {
  return typeof v === 'string' && UUID_RE.test(v);
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

async function requireResidentId(req, res) {
  const residentId = await resolveResidentIdByUid(getDb(req), req.user?.uid);
  if (!residentId) {
    res.status(403).json({ error: 'Resident identity is not mapped to v1' });
    return null;
  }
  return residentId;
}

function actorTypeForRole(role) {
  if (role === 'owner' || role === 'tenant' || role === 'resident') return 'resident';
  if (role === 'system') return 'system';
  return 'staff';
}

function auditLog(req, {
  propertyId,
  action,
  resourceId,
  changes,
}) {
  getDb(req).query(
    `INSERT INTO property_audit_log
       (property_id, actor_uid, actor_role, actor_type, entity_type, entity_id,
        action, resource_type, resource_id, changes, ip_address)
     VALUES ($1, $2, $3, $4, 'trusted_visitor', $5, $6, 'trusted_visitor', $7, $8, $9)`,
    [
      propertyId,
      req.user?.uid || null,
      req.user?.role || null,
      actorTypeForRole(req.user?.role),
      resourceId,
      action,
      resourceId,
      changes ? JSON.stringify(changes) : null,
      req.ip || null,
    ],
  ).catch((err) => logger.warn({ err, action }, '[v1/trusted-visitors] audit write failed'));
}

function sendKnownError(res, err) {
  if (
    isTrustedVisitorServiceError(err)
    || isAccessRequestServiceError(err)
    || isAccessTopologyServiceError(err)
  ) {
    res.status(err.status || 400).json({ error: err.message, ...(err.details || {}) });
    return true;
  }
  return false;
}

async function resolveResidentScope(req, res) {
  if (!can(req.user, 'access.request.create')) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }
  const propertyId = resolvePropertyId(req);
  if (!isValidUuid(propertyId)) {
    res.status(400).json({ error: 'property_id must be UUID' });
    return null;
  }
  if (!canInPropertyScope(req, 'access.request.create', propertyId)) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }
  const residentId = await requireResidentId(req, res);
  if (!residentId) return null;
  return { propertyId, residentId };
}

router.get('/', async (req, res, next) => {
  try {
    const scope = await resolveResidentScope(req, res);
    if (!scope) return;
    const includeInactive = req.query.include_inactive === 'true';
    const rows = await listTrustedVisitors(getDb(req), {
      propertyId: scope.propertyId,
      residentId: scope.residentId,
      includeInactive,
    });
    res.json({ trusted_visitors: rows });
  } catch (err) {
    if (sendKnownError(res, err)) return;
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const scope = await resolveResidentScope(req, res);
    if (!scope) return;
    const visitor = await createTrustedVisitor(getDb(req), {
      propertyId: scope.propertyId,
      residentId: scope.residentId,
      input: req.body || {},
    });
    auditLog(req, {
      propertyId: scope.propertyId,
      action: 'trusted_visitor.created',
      resourceId: visitor.id,
      changes: {
        visitor_type: visitor.visitor_type,
        allowed_zone_id: visitor.allowed_zone_id,
        allowed_point_id: visitor.allowed_point_id,
      },
    });
    res.status(201).json({ trusted_visitor: visitor });
  } catch (err) {
    if (sendKnownError(res, err)) return;
    if (err && err.code === '23503') return res.status(400).json({ error: 'referenced entity does not exist' });
    if (err && err.code === '23514') return res.status(400).json({ error: 'trusted_visitor constraint violation' });
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const scope = await resolveResidentScope(req, res);
    if (!scope) return;
    const visitor = await updateTrustedVisitor(getDb(req), {
      id: req.params.id,
      propertyId: scope.propertyId,
      residentId: scope.residentId,
      input: req.body || {},
    });
    auditLog(req, {
      propertyId: scope.propertyId,
      action: 'trusted_visitor.updated',
      resourceId: visitor.id,
      changes: { fields: Object.keys(req.body || {}) },
    });
    res.json({ trusted_visitor: visitor });
  } catch (err) {
    if (sendKnownError(res, err)) return;
    next(err);
  }
});

router.post('/:id/deactivate', async (req, res, next) => {
  try {
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const scope = await resolveResidentScope(req, res);
    if (!scope) return;
    const visitor = await deactivateTrustedVisitor(getDb(req), {
      id: req.params.id,
      propertyId: scope.propertyId,
      residentId: scope.residentId,
    });
    auditLog(req, {
      propertyId: scope.propertyId,
      action: 'trusted_visitor.deactivated',
      resourceId: visitor.id,
      changes: null,
    });
    res.json({ trusted_visitor: visitor });
  } catch (err) {
    if (sendKnownError(res, err)) return;
    next(err);
  }
});

router.post('/:id/create-pass', async (req, res, next) => {
  try {
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const scope = await resolveResidentScope(req, res);
    if (!scope) return;
    const result = await createPassFromTrustedVisitor({
      queryable: getDb(req),
      txPool: getTxPool(req),
      property: req.property,
      user: req.user,
      id: req.params.id,
      propertyId: scope.propertyId,
      residentId: scope.residentId,
      input: req.body || {},
    });
    auditLog(req, {
      propertyId: scope.propertyId,
      action: 'trusted_visitor.pass_created',
      resourceId: result.trusted_visitor.id,
      changes: {
        access_request_id: result.access_request.id,
        pass_id: result.pass?.id || null,
        status: result.access_request.status,
      },
    });
    res.status(201).json(result);
  } catch (err) {
    if (sendKnownError(res, err)) return;
    if (err && err.code === '23503') return res.status(400).json({ error: 'referenced entity does not exist' });
    if (err && err.code === '23514') return res.status(400).json({ error: 'access_request constraint violation' });
    next(err);
  }
});

module.exports = router;
