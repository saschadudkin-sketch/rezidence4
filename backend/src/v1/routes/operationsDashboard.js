'use strict';

// platform-v1 /api/v1/admin/operations-dashboard.
// Thin route over services/operationsDashboard.js. All business formulas live
// in the service so tests can validate aggregation without HTTP noise.

const express = require('express');
const db = require('../../db');
const logger = require('../../logger');
const requireAuth = require('../../middleware/auth');
const { requireCapability } = require('../lib/authz');
const {
  getOperationsDashboard,
  parsePeriod,
} = require('../services/operationsDashboard');

const router = express.Router();
router.use(requireAuth);

const requireDashboardRead = requireCapability(
  'operations.dashboard.read',
  { message: 'Admin only' },
);

function resolvePropertyId(req) {
  return req.property?.id
    || req.user?.property_id
    || req.query.property_id
    || null;
}

router.get('/', requireDashboardRead, async (req, res) => {
  let period;
  try {
    period = parsePeriod(req.query.period);
  } catch {
    return res.status(400).json({ error: 'period must be one of 24h, 7d, 30d' });
  }

  const propertyId = resolvePropertyId(req);
  if (!propertyId) {
    return res.status(400).json({ error: 'property_id required' });
  }

  const pool = req.db || db.pool;
  try {
    const snapshot = await getOperationsDashboard(pool, {
      propertyId,
      period: period.key,
    });
    return res.json({ ok: true, dashboard: snapshot });
  } catch (err) {
    logger.error({ err }, '[v1/admin/operations-dashboard] snapshot failed');
    return res.status(503).json({ ok: false, error: err.message });
  }
});

module.exports = router;
