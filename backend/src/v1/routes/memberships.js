'use strict';

const express = require('express');
const db = require('../../db');
const requireAuth = require('../../middleware/auth');
const { canInPropertyScope } = require('../lib/authz');
const { parsePaginationParams, buildPageMeta } = require('../lib/pagination');
const {
  isRoleScopeMembershipServiceError,
  listActiveMembershipsForUser,
  listMemberships,
  provisionMembership,
  revokeMembership,
} = require('../services/roleScopeMembershipService');

const router = express.Router();
router.use(requireAuth);

const getDb = (req) => req.db || db;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUBJECT_TYPES = new Set(['resident', 'staff', 'contractor', 'external']);

function isValidUuid(v) { return typeof v === 'string' && UUID_RE.test(v); }

function resolvePropertyId(req) {
  return req.property?.id
    || req.property?.property_id
    || req.query?.property_id
    || req.body?.property_id
    || req.user?.property_id
    || req.user?.propertyId
    || null;
}

function sendServiceError(res, err) {
  if (!isRoleScopeMembershipServiceError(err)) return false;
  res.status(err.status).json({ error: err.message });
  return true;
}

router.get('/me', async (req, res, next) => {
  try {
    const propertyId = resolvePropertyId(req);
    if (propertyId && !isValidUuid(propertyId)) return res.status(400).json({ error: 'Invalid property_id' });
    const memberships = await listActiveMembershipsForUser({
      queryable: getDb(req),
      user: req.user,
      propertyId,
    });
    res.json({ memberships });
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const propertyId = resolvePropertyId(req);
    if (!isValidUuid(propertyId)) return res.status(400).json({ error: 'property_id must be UUID' });
    if (!canInPropertyScope(req, 'staff:read', propertyId)) return res.status(403).json({ error: 'Forbidden' });

    let pagination;
    try {
      pagination = parsePaginationParams(req.query);
    } catch (rangeErr) {
      return res.status(400).json({ error: rangeErr.message });
    }

    const memberships = await listMemberships({
      queryable: getDb(req),
      propertyId,
      pagination,
    });
    res.json({
      memberships,
      page: buildPageMeta({ ...pagination, returnedCount: memberships.length }),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const propertyId = resolvePropertyId(req);
    if (!isValidUuid(propertyId)) return res.status(400).json({ error: 'property_id must be UUID' });
    if (!canInPropertyScope(req, 'staff:write', propertyId)) return res.status(403).json({ error: 'Forbidden' });

    const subjectType = req.body?.subject_type;
    if (!SUBJECT_TYPES.has(subjectType)) return res.status(400).json({ error: 'Invalid subject_type' });

    const membership = await provisionMembership({
      queryable: getDb(req),
      input: {
        ...req.body,
        property_id: propertyId,
        provisioned_from: req.body?.provisioned_from || 'api',
      },
    });
    res.status(201).json({ membership });
  } catch (err) {
    if (sendServiceError(res, err)) return;
    if (err && err.code === '23503') return res.status(400).json({ error: 'referenced subject does not exist' });
    if (err && err.code === '23514') return res.status(400).json({ error: 'membership constraint violation' });
    next(err);
  }
});

router.post('/:id/revoke', async (req, res, next) => {
  try {
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid membership id' });
    const { rows } = await getDb(req).query(
      `SELECT property_id FROM role_scope_memberships WHERE id = $1`,
      [req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Membership not found' });
    if (!canInPropertyScope(req, 'staff:write', rows[0].property_id)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const membership = await revokeMembership({
      queryable: getDb(req),
      membershipId: req.params.id,
      reason: typeof req.body?.reason === 'string' ? req.body.reason.trim() : null,
    });
    res.json({ membership });
  } catch (err) {
    if (sendServiceError(res, err)) return;
    next(err);
  }
});

module.exports = router;
