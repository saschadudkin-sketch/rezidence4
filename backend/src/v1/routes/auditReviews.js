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
  ESCALATION_STATUSES,
  REVIEW_PRIORITIES,
  REVIEW_STATUSES,
  assignSensitiveActionReview,
  attestSensitiveAction,
  escalateOverdueSensitiveActionReviews,
  getSensitiveActionAntiAbuseAnalytics,
  isAuditReviewServiceError,
  listSensitiveActionReviews,
  materializeSensitiveActionReviewSamples,
  summarizeSensitiveActionReviews,
} = require('../services/auditReviewService');
const { resolveStaffIdByUid } = require('../services/accessActorResolver');

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

function parseBooleanQuery(v) {
  if (v === undefined || v === null || v === '') return false;
  const raw = String(firstQueryValue(v)).trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

function parseIntegerOption(value, fallback, min, max) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number.parseInt(firstQueryValue(value), 10);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(max, Math.max(min, parsed));
}

function parseSensitiveCategory(req, res) {
  const categoryValue = firstQueryValue(req.query.category || req.body?.category);
  const category = categoryValue ? String(categoryValue).trim() : null;
  if (category && !isKnownSensitiveCategory(category)) {
    res.status(400).json({
      error: 'Invalid category',
      categories: listSensitiveCategories(),
    });
    return false;
  }
  return category;
}

function applyPropertyFilter(req, res, filters) {
  const propertyId = firstQueryValue(req.query.property_id || req.body?.property_id);
  if (!propertyId) return true;
  if (!isValidUuid(propertyId)) {
    res.status(400).json({ error: 'Invalid property_id' });
    return false;
  }
  filters.property_id = propertyId;
  return true;
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
    priorities: [...REVIEW_PRIORITIES],
    escalation_statuses: [...ESCALATION_STATUSES],
  });
});

router.get('/sensitive-actions/_summary', async (req, res, next) => {
  try {
    if (!can(req.user, 'audit.read')) return res.status(403).json({ error: 'Forbidden' });

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

    const summary = await summarizeSensitiveActionReviews({
      queryable: getDb(req),
      filters,
    });
    res.json({ summary });
  } catch (err) {
    next(err);
  }
});

router.get('/sensitive-actions/_anti-abuse', async (req, res, next) => {
  try {
    if (!can(req.user, 'audit.read')) return res.status(403).json({ error: 'Forbidden' });

    const category = parseSensitiveCategory(req, res);
    if (category === false) return;

    const filters = { category };
    if (!applyPropertyFilter(req, res, filters)) return;

    const windowHours = parseIntegerOption(req.query.window_hours, 168, 1, 24 * 90);
    const minActions = parseIntegerOption(req.query.min_actions, 5, 1, 1000);
    const limit = parseIntegerOption(req.query.limit, 50, 1, 500);
    if (windowHours === null || minActions === null || limit === null) {
      return res.status(400).json({ error: 'Invalid numeric option' });
    }

    const analytics = await getSensitiveActionAntiAbuseAnalytics({
      queryable: getDb(req),
      filters,
      options: { windowHours, minActions, limit },
    });
    res.json({ analytics });
  } catch (err) {
    next(err);
  }
});

router.post('/sensitive-actions/_sample', async (req, res, next) => {
  try {
    if (!can(req.user, 'audit.read')) return res.status(403).json({ error: 'Forbidden' });

    const category = parseSensitiveCategory(req, res);
    if (category === false) return;

    const filters = { category };
    if (!applyPropertyFilter(req, res, filters)) return;

    const windowHours = parseIntegerOption(req.body?.window_hours, 168, 1, 24 * 90);
    const samplePercent = parseIntegerOption(req.body?.sample_percent, 10, 0, 100);
    const dueHours = parseIntegerOption(req.body?.due_hours, 72, 1, 24 * 30);
    const limit = parseIntegerOption(req.body?.limit, 100, 1, 500);
    if ([windowHours, samplePercent, dueHours, limit].some((value) => value === null)) {
      return res.status(400).json({ error: 'Invalid numeric option' });
    }

    const reviews = await materializeSensitiveActionReviewSamples({
      queryable: getDb(req),
      filters,
      options: { windowHours, samplePercent, dueHours, limit },
    });
    res.status(201).json({ sampled_count: reviews.length, reviews });
  } catch (err) {
    if (sendServiceError(res, err)) return;
    if (err && err.code === '23503') return res.status(400).json({ error: 'audit row does not exist' });
    if (err && err.code === '23514') return res.status(400).json({ error: 'review constraint violation' });
    next(err);
  }
});

router.post('/sensitive-actions/_escalate', async (req, res, next) => {
  try {
    if (!can(req.user, 'audit.read')) return res.status(403).json({ error: 'Forbidden' });

    const filters = {};
    if (!applyPropertyFilter(req, res, filters)) return;

    const limit = parseIntegerOption(req.body?.limit, 100, 1, 500);
    const escalateAfterHours = parseIntegerOption(req.body?.escalate_after_hours, 24, 1, 24 * 30);
    if (limit === null || escalateAfterHours === null) {
      return res.status(400).json({ error: 'Invalid numeric option' });
    }

    const reviews = await escalateOverdueSensitiveActionReviews({
      queryable: getDb(req),
      filters,
      options: { limit, escalateAfterHours },
    });
    res.json({
      escalated_count: reviews.length,
      overdue_count: reviews.filter((row) => row.escalation_status === 'overdue').length,
      hard_escalated_count: reviews.filter((row) => row.escalation_status === 'escalated').length,
      reviews,
    });
  } catch (err) {
    if (sendServiceError(res, err)) return;
    if (err && err.code === '23514') return res.status(400).json({ error: 'review constraint violation' });
    next(err);
  }
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
    const priority = firstQueryValue(req.query.priority);
    if (priority) {
      if (!REVIEW_PRIORITIES.has(priority)) return res.status(400).json({ error: 'Invalid priority' });
      filters.priority = priority;
    }
    const escalationStatus = firstQueryValue(req.query.escalation_status);
    if (escalationStatus) {
      if (!ESCALATION_STATUSES.has(escalationStatus)) {
        return res.status(400).json({ error: 'Invalid escalation_status' });
      }
      filters.escalation_status = escalationStatus;
    }
    const assignedReviewerStaffId = firstQueryValue(req.query.assigned_reviewer_staff_id);
    if (assignedReviewerStaffId) {
      if (!isValidUuid(assignedReviewerStaffId)) {
        return res.status(400).json({ error: 'Invalid assigned_reviewer_staff_id' });
      }
      filters.assigned_reviewer_staff_id = assignedReviewerStaffId;
    }
    if (parseBooleanQuery(req.query.assigned_to_me)) {
      const staffId = await resolveStaffIdByUid(getDb(req), req.user?.uid);
      if (!staffId) return res.status(403).json({ error: 'Staff identity is not mapped to v1' });
      filters.assigned_reviewer_staff_id = staffId;
    }
    if (parseBooleanQuery(req.query.overdue)) {
      filters.overdue = true;
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

router.post('/sensitive-actions/:id/assign', async (req, res, next) => {
  try {
    if (!can(req.user, 'audit.read')) return res.status(403).json({ error: 'Forbidden' });
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid audit action id' });

    const assignedReviewerStaffId = req.body?.assigned_reviewer_staff_id === undefined
      ? null
      : firstQueryValue(req.body.assigned_reviewer_staff_id);
    if (assignedReviewerStaffId !== null && !isValidUuid(assignedReviewerStaffId)) {
      return res.status(400).json({ error: 'Invalid assigned_reviewer_staff_id' });
    }

    const priority = firstQueryValue(req.body?.priority) || 'normal';
    const dueAt = req.body?.due_at === undefined ? null : firstQueryValue(req.body.due_at);
    const reason = req.body?.reason === undefined ? null : req.body.reason;

    const review = await assignSensitiveActionReview({
      queryable: getDb(req),
      user: req.user,
      auditLogId: req.params.id,
      assignedReviewerStaffId,
      dueAt,
      priority,
      reason,
    });
    res.json({ review });
  } catch (err) {
    if (sendServiceError(res, err)) return;
    if (err && err.code === '23503') return res.status(400).json({ error: 'reviewer or audit row does not exist' });
    if (err && err.code === '23514') return res.status(400).json({ error: 'review constraint violation' });
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
