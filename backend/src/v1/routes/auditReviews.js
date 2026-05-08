'use strict';

// platform-v1 audit review route.
// Spec: docs/product/specs/domhub-event-taxonomy-spec.md §8.
//
// This is a read-only reporting layer over property_audit_log. It intentionally
// does not mutate audit rows: review workflows belong to DH-60, while DH-08
// needs a stable sensitive-action taxonomy and query surface.

const express = require('express');
const db = require('../../db');
const requireAuth = require('../../middleware/auth');
const { can } = require('../lib/authz');
const { parsePaginationParams, buildPageMeta } = require('../lib/pagination');
const {
  classifyAuditRow,
  isKnownSensitiveCategory,
  listSensitiveAuditActions,
  listSensitiveCategories,
} = require('../services/auditEventCatalog');

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

router.get('/sensitive-actions/_meta', (req, res) => {
  if (!can(req.user, 'audit.read')) return res.status(403).json({ error: 'Forbidden' });
  res.json({
    categories: listSensitiveCategories(),
    actions: listSensitiveAuditActions(),
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

    const actions = listSensitiveAuditActions({ category });
    const filters = [];
    const params = [];

    params.push(actions);
    filters.push(`action = ANY($${params.length}::text[])`);

    const propertyId = firstQueryValue(req.query.property_id);
    if (propertyId) {
      if (!isValidUuid(propertyId)) return res.status(400).json({ error: 'Invalid property_id' });
      params.push(propertyId);
      filters.push(`property_id = $${params.length}`);
    }
    const actorUid = firstQueryValue(req.query.actor_uid);
    if (actorUid) {
      if (!isSafeFilterValue(actorUid, 128)) return res.status(400).json({ error: 'Invalid actor_uid' });
      params.push(String(actorUid).trim());
      filters.push(`actor_uid = $${params.length}`);
    }
    const resourceType = firstQueryValue(req.query.resource_type);
    if (resourceType) {
      if (!isSafeFilterValue(resourceType, 50)) return res.status(400).json({ error: 'Invalid resource_type' });
      params.push(String(resourceType).trim());
      filters.push(`resource_type = $${params.length}`);
    }
    const from = firstQueryValue(req.query.from);
    if (from) {
      if (!isValidIso(from)) return res.status(400).json({ error: 'Invalid from' });
      params.push(String(from));
      filters.push(`created_at >= $${params.length}`);
    }
    const to = firstQueryValue(req.query.to);
    if (to) {
      if (!isValidIso(to)) return res.status(400).json({ error: 'Invalid to' });
      params.push(String(to));
      filters.push(`created_at <= $${params.length}`);
    }

    params.push(pagination.limit);
    const limitIdx = params.length;
    params.push(pagination.offset);
    const offsetIdx = params.length;

    const { rows } = await getDb(req).query(
      `SELECT id, property_id, actor_uid, actor_role, actor_type,
              action, resource_type, resource_id, entity_type, entity_id,
              changes, ip_address, created_at
         FROM property_audit_log
        WHERE ${filters.join(' AND ')}
        ORDER BY created_at DESC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );

    res.json({
      actions: rows.map(classifyAuditRow),
      page: buildPageMeta({ ...pagination, returnedCount: rows.length }),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
