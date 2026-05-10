'use strict';

// platform-v1 audit review route.
// Spec: docs/product/specs/domhub-event-taxonomy-spec.md §8.
//
// Review workflow over immutable property_audit_log rows. Audit rows remain
// append-only; attestations are written to sensitive_action_reviews.

const express = require('express');
const db = require('../../db');
const requireAuth = require('../../middleware/auth');
const { can } = require('../lib/authz');
const { parsePaginationParams, buildPageMeta } = require('../lib/pagination');
const {
  isKnownSensitiveCategory,
  listSensitiveAuditActions,
  listSensitiveCategories,
} = require('../services/auditEventCatalog');
const {
  REVIEW_STATUSES,
  attestSensitiveAction,
  isAuditReviewServiceError,
  listSensitiveActionReviews,
} = require('../services/auditReviewService');

const router = express.Router();
router.use(requireAuth);

const getDb = (req) => req.db || db;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(v) {
  return typeof v === 'string' && UUID_RE.test(v);
}

function isValidIso(v) {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v));
}

function isSafeFilterValue(v, maxLen = 100) {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= maxLen;
}

function firstQueryValue(v) {
  return Array.isArray(v) ? v[0] : v;
}

function sendServiceError(res, err) {
  if (!isAuditReviewServiceError(err)) return false;
  res.status(err.status).json({ error: err.message });
  return true;
}

router.get('/sensitive-actions/_meta', (req, res) => {
  if (!can(req.user, 'audit.read')) return res.status(403).json({ error: 'Forbidden' });
  res.json({
    categories: listSensitiveCategories(),
    actions: listSensitiveAuditActions(),
    review_statuses: [...REVIEW_STATUSES],
  });
});

router.get('/sensitive-actions', async (req, res, next) => {
  try {
    if (!can(req.user, 'audit.read')) return res.status(403).json({ error: 'Forbidden' });

    let pagination;
    try {
      pagination = parsePaginationParams(req.query);
    } catch (rangeErr) {
      return res.status(400).json({ error: rangeErr.message });
    }

    const categoryValue = firstQueryValue(req.query.category);
    const category = categoryValue ? String(categoryValue).trim() : null;
    if (category && !isKnownSensitiveCategory(category)) {
      return res.status(400).json({
        error: 'Invalid category',
        categories: listSensitiveCategories(),
      });
    }

    const filters = { category };

    const propertyId = firstQueryValue(req.query.property_id);
    if (propertyId) {
      if (!isValidUuid(propertyId)) return res.status(400).json({ error: 'Invalid property_id' });
      filters.property_id = propertyId;
    }
    const reviewStatus = firstQueryValue(req.query.review_status);
    if (reviewStatus) {
      if (!REVIEW_STATUSES.has(reviewStatus)) return res.status(400).json({ error: 'Invalid review_status' });
      filters.review_status = reviewStatus;
    }
    const actorUid = firstQueryValue(req.query.actor_uid);
    if (actorUid) {
      if (!isSafeFilterValue(actorUid, 128)) return res.status(400).json({ error: 'Invalid actor_uid' });
      filters.actor_uid = String(actorUid).trim();
    }
    const resourceType = firstQueryValue(req.query.resource_type);
    if (resourceType) {
      if (!isSafeFilterValue(resourceType, 50)) return res.status(400).json({ error: 'Invalid resource_type' });
      filters.resource_type = String(resourceType).trim();
    }
    const from = firstQueryValue(req.query.from);
    if (from) {
      if (!isValidIso(from)) return res.status(400).json({ error: 'Invalid from' });
      filters.from = String(from);
    }
    const to = firstQueryValue(req.query.to);
    if (to) {
      if (!isValidIso(to)) return res.status(400).json({ error: 'Invalid to' });
      filters.to = String(to);
    }

    const actions = await listSensitiveActionReviews({
      queryable: getDb(req),
      filters,
      pagination,
    });

    res.json({
      actions,
      page: buildPageMeta({ ...pagination, returnedCount: actions.length }),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/sensitive-actions/:id/review', async (req, res, next) => {
  try {
    if (!can(req.user, 'audit.read')) return res.status(403).json({ error: 'Forbidden' });
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid audit action id' });
    const decision = firstQueryValue(req.body?.decision);
    const comment = req.body?.comment === undefined ? null : req.body.comment;
    const review = await attestSensitiveAction({
      queryable: getDb(req),
      user: req.user,
      auditLogId: req.params.id,
      decision,
      comment,
    });
    res.json({ review });
  } catch (err) {
    if (sendServiceError(res, err)) return;
    if (err && err.code === '23503') return res.status(400).json({ error: 'reviewer or audit row does not exist' });
    if (err && err.code === '23514') return res.status(400).json({ error: 'review constraint violation' });
    next(err);
  }
});

module.exports = router;
