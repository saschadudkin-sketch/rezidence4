'use strict';

const express = require('express');
const db = require('../../db');
const requireAuth = require('../../middleware/auth');
const { canInPropertyScope } = require('../lib/authz');
const {
  getLatestPropertyAnalyticsSnapshot,
  listPropertyAnalyticsSnapshots,
  materializePropertyAnalyticsSnapshot,
  renderMetricsCsv,
} = require('../services/analyticsAggregationService');

const router = express.Router();
router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getDb(req) {
  return req.db || db;
}

function resolvePropertyId(req) {
  return req.property?.id
    || req.property?.property_id
    || req.body?.property_id
    || req.body?.propertyId
    || req.query?.property_id
    || req.query?.propertyId
    || req.user?.property_id
    || req.user?.propertyId
    || null;
}

function isValidUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

function requireAnalyticsScope(req, res, capability, propertyId) {
  if (!isValidUuid(propertyId)) {
    res.status(400).json({ error: 'property_id must be resolved' });
    return false;
  }
  if (!canInPropertyScope(req, capability, propertyId)) {
    res.status(403).json({ error: 'Forbidden' });
    return false;
  }
  return true;
}

function sendCsv(res, filename, rows) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(renderMetricsCsv(rows));
}

router.get('/snapshots', async (req, res, next) => {
  try {
    const propertyId = resolvePropertyId(req);
    if (!requireAnalyticsScope(req, res, 'analytics.read', propertyId)) return;

    const snapshots = await listPropertyAnalyticsSnapshots(getDb(req), {
      propertyId,
      period: req.query.period || null,
      limit: req.query.limit || 20,
    });
    res.json({ snapshots });
  } catch (err) {
    if (/unsupported period/.test(err.message)) return res.status(400).json({ error: err.message });
    next(err);
  }
});

router.get('/snapshots/latest', async (req, res, next) => {
  try {
    const propertyId = resolvePropertyId(req);
    if (!requireAnalyticsScope(req, res, 'analytics.read', propertyId)) return;

    const snapshot = await getLatestPropertyAnalyticsSnapshot(getDb(req), {
      propertyId,
      period: req.query.period || '7d',
    });
    if (!snapshot) return res.json({ snapshot: null });
    if (String(req.query.format || '').toLowerCase() === 'csv') {
      return sendCsv(res, `analytics-${snapshot.period}.csv`, snapshot.flat_rows || []);
    }
    return res.json({ snapshot });
  } catch (err) {
    if (/unsupported period/.test(err.message)) return res.status(400).json({ error: err.message });
    return next(err);
  }
});

router.post('/snapshots', async (req, res, next) => {
  try {
    const propertyId = resolvePropertyId(req);
    if (!requireAnalyticsScope(req, res, 'analytics.write', propertyId)) return;

    const result = await materializePropertyAnalyticsSnapshot(getDb(req), {
      propertyId,
      period: req.body?.period || '7d',
      generatedBy: 'manual',
    });
    return res.status(201).json(result);
  } catch (err) {
    if (/unsupported period/.test(err.message)) return res.status(400).json({ error: err.message });
    return next(err);
  }
});

module.exports = router;
