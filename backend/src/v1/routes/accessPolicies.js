'use strict';

// platform-v1 Access Policy routes.
// Spec: docs/product/specs/platform-v1/access-policies-spec.md
// Tickets: DH-13 Policy CRUD, DH-14 deterministic evaluation.

const express = require('express');
const db = require('../../db');
const logger = require('../../logger');
const requireAuth = require('../../middleware/auth');
const { canInPropertyScope } = require('../lib/authz');
const { parsePaginationParams, buildPageMeta } = require('../lib/pagination');
const {
  ACCESS_METHODS,
  POLICY_EFFECTS,
  SUBJECT_TYPES,
  assertEnabledAccessMethod,
  createPolicy,
  deactivatePolicy,
  evaluateAccessPolicy,
  getDefaultPolicyTemplates,
  getPolicyById,
  isAccessPolicyServiceError,
  listPolicies,
  updatePolicy,
} = require('../services/accessPolicyService');
const {
  isAccessTopologyServiceError,
  validateAccessTopologyTarget,
} = require('../services/accessTopologyService');

const router = express.Router();
router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const getDb = (req) => req.db || db;

function isValidUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

function canReadPolicy(req, propertyId) {
  return canInPropertyScope(req, 'access.policy.read', propertyId);
}

function canWritePolicy(req, propertyId) {
  return canInPropertyScope(req, 'access.policy.write', propertyId);
}

function resolveRequestPropertyId(req, explicitPropertyId = null) {
  return explicitPropertyId
    || req.property?.id
    || req.property?.property_id
    || req.query?.property_id
    || req.body?.property_id
    || null;
}

function sendKnownError(res, err) {
  if (isAccessPolicyServiceError(err) || isAccessTopologyServiceError(err)) {
    res.status(err.status).json({ error: err.message });
    return true;
  }
  return false;
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
  ).catch((err) => logger.warn({ err, action }, '[v1/accessPolicies] audit write failed'));
}

async function requirePolicyProperty(req, policyId) {
  const policy = await getPolicyById({ queryable: getDb(req), policyId });
  if (!policy) {
    const err = new Error('Access policy not found');
    err.status = 404;
    throw err;
  }
  return policy.property_id;
}

async function validatePolicyTopology(req, propertyId, body) {
  if (body.zone_id !== undefined && body.zone_id !== null && !isValidUuid(body.zone_id)) {
    const err = new Error('zone_id must be UUID or null');
    err.status = 400;
    throw err;
  }
  if (body.point_id !== undefined && body.point_id !== null && !isValidUuid(body.point_id)) {
    const err = new Error('point_id must be UUID or null');
    err.status = 400;
    throw err;
  }
  if (body.zone_id || body.point_id) {
    await validateAccessTopologyTarget(getDb(req), {
      propertyId,
      zoneId: body.zone_id || null,
      pointId: body.point_id || null,
    });
  }
}

router.get('/access-policy-templates', async (req, res, next) => {
  try {
    const propertyId = resolveRequestPropertyId(req);
    if (propertyId && !isValidUuid(propertyId)) return res.status(400).json({ error: 'property_id must be UUID' });
    if (propertyId && !canReadPolicy(req, propertyId)) return res.status(403).json({ error: 'Forbidden' });
    if (!propertyId && !canInPropertyScope(req, 'access.policy.read')) return res.status(403).json({ error: 'Forbidden' });
    res.json({ templates: getDefaultPolicyTemplates() });
  } catch (err) { next(err); }
});

router.get('/access-policies', async (req, res, next) => {
  try {
    const propertyId = resolveRequestPropertyId(req);
    if (!isValidUuid(propertyId)) return res.status(400).json({ error: 'property_id must be UUID' });
    if (!canReadPolicy(req, propertyId)) return res.status(403).json({ error: 'Forbidden' });

    let pagination;
    try {
      pagination = parsePaginationParams(req.query);
    } catch (rangeErr) {
      return res.status(400).json({ error: rangeErr.message });
    }

    const filters = { property_id: propertyId };
    if (req.query.subject_type) {
      if (!SUBJECT_TYPES.has(req.query.subject_type)) return res.status(400).json({ error: 'Invalid subject_type' });
      filters.subject_type = req.query.subject_type;
    }
    if (req.query.access_method) {
      if (!ACCESS_METHODS.has(req.query.access_method)) return res.status(400).json({ error: 'Invalid access_method' });
      filters.access_method = req.query.access_method;
    }
    if (req.query.effect) {
      if (!POLICY_EFFECTS.has(req.query.effect)) return res.status(400).json({ error: 'Invalid effect' });
      filters.effect = req.query.effect;
    }
    for (const key of ['zone_id', 'point_id']) {
      if (req.query[key]) {
        if (!isValidUuid(req.query[key])) return res.status(400).json({ error: `Invalid ${key}` });
        filters[key] = req.query[key];
      }
    }
    if (req.query.is_active !== undefined) {
      filters.is_active = req.query.is_active === 'true' || req.query.is_active === '1';
    }

    const policies = await listPolicies({ queryable: getDb(req), filters, pagination });
    res.json({
      policies,
      page: buildPageMeta({ ...pagination, returnedCount: policies.length }),
    });
  } catch (err) { next(err); }
});

router.post('/access-policies/evaluate', async (req, res, next) => {
  try {
    const {
      property_id,
      subject_type = null,
      pass_type = null,
      access_method,
      zone_id = null,
      point_id = null,
      occurred_at = null,
    } = req.body || {};
    if (!isValidUuid(property_id)) return res.status(400).json({ error: 'property_id must be UUID' });
    if (!canReadPolicy(req, property_id)) return res.status(403).json({ error: 'Forbidden' });
    if (subject_type !== null && !SUBJECT_TYPES.has(subject_type)) return res.status(400).json({ error: 'Invalid subject_type' });
    try {
      assertEnabledAccessMethod(access_method);
    } catch (err) {
      if (sendKnownError(res, err)) return;
      throw err;
    }
    if (zone_id !== null && !isValidUuid(zone_id)) return res.status(400).json({ error: 'zone_id must be UUID or null' });
    if (point_id !== null && !isValidUuid(point_id)) return res.status(400).json({ error: 'point_id must be UUID or null' });
    if (occurred_at !== null && Number.isNaN(Date.parse(occurred_at))) {
      return res.status(400).json({ error: 'occurred_at must be ISO-8601 or null' });
    }
    await validateAccessTopologyTarget(getDb(req), { propertyId: property_id, zoneId: zone_id, pointId: point_id });

    const decision = await evaluateAccessPolicy({
      queryable: getDb(req),
      propertyId: property_id,
      subjectType: subject_type,
      passType: pass_type,
      accessMethod: access_method,
      zoneId: zone_id,
      pointId: point_id,
      now: occurred_at ? new Date(occurred_at) : new Date(),
    });
    res.json({ decision });
  } catch (err) {
    if (sendKnownError(res, err)) return;
    next(err);
  }
});

router.post('/access-policies', async (req, res, next) => {
  try {
    const propertyId = req.body?.property_id;
    if (!isValidUuid(propertyId)) return res.status(400).json({ error: 'property_id must be UUID' });
    if (!canWritePolicy(req, propertyId)) return res.status(403).json({ error: 'Forbidden' });
    await validatePolicyTopology(req, propertyId, req.body || {});

    const policy = await createPolicy({ queryable: getDb(req), input: req.body || {} });
    auditLog(req, {
      action: 'access_policy.created',
      resourceType: 'access_policy',
      resourceId: policy.id,
      changes: {
        name: policy.name,
        subject_type: policy.subject_type,
        access_method: policy.access_method,
        effect: policy.effect,
      },
    });
    res.status(201).json({ policy });
  } catch (err) {
    if (sendKnownError(res, err)) return;
    if (err && err.code === '23503') return res.status(400).json({ error: 'zone_id or point_id does not exist for this property' });
    if (err && err.code === '23505') return res.status(409).json({ error: 'active access policy name already exists for this property' });
    next(err);
  }
});

router.get('/access-policies/:id', async (req, res, next) => {
  try {
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid policy id' });
    const policy = await getPolicyById({ queryable: getDb(req), policyId: req.params.id });
    if (!policy) return res.status(404).json({ error: 'Access policy not found' });
    if (!canReadPolicy(req, policy.property_id)) return res.status(403).json({ error: 'Forbidden' });
    res.json({ policy });
  } catch (err) { next(err); }
});

router.patch('/access-policies/:id', async (req, res, next) => {
  try {
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid policy id' });
    const propertyId = await requirePolicyProperty(req, req.params.id);
    if (!canWritePolicy(req, propertyId)) return res.status(403).json({ error: 'Forbidden' });
    await validatePolicyTopology(req, propertyId, req.body || {});

    const policy = await updatePolicy({ queryable: getDb(req), policyId: req.params.id, input: req.body || {} });
    auditLog(req, {
      action: 'access_policy.updated',
      resourceType: 'access_policy',
      resourceId: policy.id,
      changes: req.body || {},
    });
    res.json({ policy });
  } catch (err) {
    if (sendKnownError(res, err)) return;
    if (err && err.status) return res.status(err.status).json({ error: err.message });
    if (err && err.code === '23503') return res.status(400).json({ error: 'zone_id or point_id does not exist for this property' });
    if (err && err.code === '23505') return res.status(409).json({ error: 'active access policy name already exists for this property' });
    next(err);
  }
});

router.post('/access-policies/:id/deactivate', async (req, res, next) => {
  try {
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid policy id' });
    const propertyId = await requirePolicyProperty(req, req.params.id);
    if (!canWritePolicy(req, propertyId)) return res.status(403).json({ error: 'Forbidden' });

    const policy = await deactivatePolicy({ queryable: getDb(req), policyId: req.params.id });
    auditLog(req, {
      action: 'access_policy.deactivated',
      resourceType: 'access_policy',
      resourceId: policy.id,
      changes: null,
    });
    res.status(204).end();
  } catch (err) {
    if (sendKnownError(res, err)) return;
    if (err && err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

module.exports = router;
