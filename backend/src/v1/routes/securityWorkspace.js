'use strict';

// platform-v1 Security Workspace API.
// Spec: docs/product/specs/platform-v1/security-workspace-spec.md
// Tickets: DH-15 Security Workspace API, DH-16 Manual Override And Incident Flow.

const express = require('express');
const db = require('../../db');
const requireAuth = require('../../middleware/auth');
const { canInPropertyScope } = require('../lib/authz');
const { parsePaginationParams, buildPageMeta } = require('../lib/pagination');
const {
  getSecurityWorkspaceBootstrap,
  isSecurityWorkspaceServiceError,
  listRecentEvents,
  searchSecurityWorkspace,
} = require('../services/securityWorkspaceService');
const {
  createManualSecurityDecision,
  isAccessIncidentServiceError,
  reconcileDegradedVisitLog,
} = require('../services/accessIncidentService');
const {
  isAccessTopologyServiceError,
  validateAccessPoint,
} = require('../services/accessTopologyService');
const {
  isSecurityOfflineReplayServiceError,
  replaySecurityOfflineEvents,
} = require('../services/securityOfflineReplayService');

const router = express.Router();
router.use(requireAuth);

const getDb = (req) => req.db || db;
const getTxPool = (req) => (typeof req.db?.connect === 'function' ? req.db : db.pool);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MANUAL_DECISIONS = new Set(['manual_admit', 'manual_deny']);
const DIRECTIONS = new Set(['entry', 'exit']);
const SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);
const DEGRADED_REASONS = new Set([
  'cached_lookup',
  'no_lookup',
  'manual_admit',
  'manual_deny',
  'later_reconciliation',
  'connectivity_loss',
  'provider_outage',
  'policy_override',
]);
const LOOKUP_STATES = new Set(['online', 'cached_hit', 'cached_miss', 'not_checked', 'unavailable']);
const RECONCILIATION_STATES = new Set(['matched', 'discrepancy', 'dismissed']);

function isValidUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

function isValidIso(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isNonEmptyString(value, maxLen = 500) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLen;
}

function resolvePropertyId(req) {
  return req.property?.id
    || req.property?.property_id
    || req.query?.property_id
    || req.body?.property_id
    || null;
}

function canReadSecurityWorkspace(req, propertyId) {
  return canInPropertyScope(req, 'access.security.workspace.read', propertyId);
}

function canCreateManualDecision(req, propertyId) {
  return canInPropertyScope(req, 'access.override.create', propertyId);
}

function sendKnownError(res, err) {
  if (isSecurityWorkspaceServiceError(err) || isAccessTopologyServiceError(err)) {
    res.status(err.status).json({ error: err.message });
    return true;
  }
  if (isAccessIncidentServiceError(err)) {
    res.status(err.status).json({ error: err.message });
    return true;
  }
  if (isSecurityOfflineReplayServiceError(err)) {
    res.status(err.status).json({ error: err.message });
    return true;
  }
  return false;
}

function parseAccessPointId(req) {
  const value = req.query.access_point_id || req.body?.access_point_id || null;
  return value === '' ? null : value;
}

async function validateCommon(req, res) {
  const propertyId = resolvePropertyId(req);
  const accessPointId = parseAccessPointId(req);
  if (!isValidUuid(propertyId)) {
    res.status(400).json({ error: 'property_id must be UUID' });
    return null;
  }
  if (accessPointId !== null && !isValidUuid(accessPointId)) {
    res.status(400).json({ error: 'access_point_id must be UUID or omitted' });
    return null;
  }
  if (!canReadSecurityWorkspace(req, propertyId)) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }
  await validateAccessPoint(getDb(req), { propertyId, accessPointId });
  return { propertyId, accessPointId };
}

function parseManualDecisionBody(req, res, propertyId, accessPointId) {
  const {
    decision,
    direction = 'entry',
    reason,
    pass_id = null,
    vehicle_id = null,
    related_vehicle_id = null,
    person_label = null,
    vehicle_plate = null,
    degraded_mode = false,
    degraded_reason = null,
    lookup_state = null,
    occurred_at = null,
    severity = null,
  } = req.body || {};

  if (!MANUAL_DECISIONS.has(decision)) {
    res.status(400).json({ error: "decision must be 'manual_admit' or 'manual_deny'" });
    return null;
  }
  if (!DIRECTIONS.has(direction)) {
    res.status(400).json({ error: "direction must be 'entry' or 'exit'" });
    return null;
  }
  if (!isNonEmptyString(reason, 500)) {
    res.status(422).json({ error: 'reason is required' });
    return null;
  }
  if (pass_id !== null && !isValidUuid(pass_id)) {
    res.status(400).json({ error: 'pass_id must be UUID or null' });
    return null;
  }
  const vehicleId = related_vehicle_id || vehicle_id || null;
  if (vehicleId !== null && !isValidUuid(vehicleId)) {
    res.status(400).json({ error: 'vehicle_id must be UUID or null' });
    return null;
  }
  if (person_label !== null && typeof person_label !== 'string') {
    res.status(400).json({ error: 'person_label must be string or null' });
    return null;
  }
  if (vehicle_plate !== null && typeof vehicle_plate !== 'string') {
    res.status(400).json({ error: 'vehicle_plate must be string or null' });
    return null;
  }
  if (typeof degraded_mode !== 'boolean') {
    res.status(400).json({ error: 'degraded_mode must be boolean' });
    return null;
  }
  const resolvedDegradedReason = degraded_reason || (degraded_mode ? decision : null);
  if (resolvedDegradedReason !== null && !DEGRADED_REASONS.has(resolvedDegradedReason)) {
    res.status(400).json({ error: 'Invalid degraded_reason' });
    return null;
  }
  const resolvedLookupState = lookup_state || (degraded_mode ? 'not_checked' : 'online');
  if (!LOOKUP_STATES.has(resolvedLookupState)) {
    res.status(400).json({ error: 'Invalid lookup_state' });
    return null;
  }
  if (occurred_at !== null && !isValidIso(occurred_at)) {
    res.status(400).json({ error: 'occurred_at must be ISO-8601 or null' });
    return null;
  }
  const resolvedSeverity = severity || (decision === 'manual_deny' ? 'medium' : 'low');
  if (!SEVERITIES.has(resolvedSeverity)) {
    res.status(400).json({ error: 'Invalid severity' });
    return null;
  }

  return {
    property_id: propertyId,
    access_point_id: accessPointId,
    decision,
    direction,
    reason,
    pass_id,
    related_vehicle_id: vehicleId,
    person_label,
    vehicle_plate,
    degraded_mode,
    degraded_reason: resolvedDegradedReason,
    lookup_state: resolvedLookupState,
    occurred_at,
    severity: resolvedSeverity,
    ip_address: req.ip || null,
  };
}

async function sendBootstrap(req, res, next, { dashboard = false } = {}) {
  try {
    const common = await validateCommon(req, res);
    if (!common) return;
    const occurredAt = req.query.occurred_at ? new Date(String(req.query.occurred_at)) : new Date();
    if (Number.isNaN(occurredAt.getTime())) {
      return res.status(400).json({ error: 'occurred_at must be ISO-8601 or omitted' });
    }

    const workspace = await getSecurityWorkspaceBootstrap({
      queryable: getDb(req),
      propertyId: common.propertyId,
      accessPointId: common.accessPointId,
      now: occurredAt,
      limits: {
        activePasses: req.query.active_passes_limit,
        expectedGuests: req.query.expected_guests_limit,
        recentEvents: req.query.recent_events_limit,
        blacklistHits: req.query.blacklist_hits_limit,
      },
    });
    if (dashboard) {
      return res.json({
        expectedArrivals: workspace.expected_guests.length,
        activePasses: workspace.active_passes.length,
        openIncidents: workspace.blacklist_hits.length,
        recentEvents: workspace.recent_events,
        workspace,
      });
    }
    res.json({ workspace });
  } catch (err) {
    if (sendKnownError(res, err)) return;
    next(err);
  }
}

router.get('/bootstrap', async (req, res, next) => {
  await sendBootstrap(req, res, next);
});

router.get('/dashboard', async (req, res, next) => {
  await sendBootstrap(req, res, next, { dashboard: true });
});

router.get('/search', async (req, res, next) => {
  try {
    const common = await validateCommon(req, res);
    if (!common) return;
    const result = await searchSecurityWorkspace({
      queryable: getDb(req),
      propertyId: common.propertyId,
      q: req.query.q,
      limit: req.query.limit,
    });
    res.json({ results: result });
  } catch (err) {
    if (sendKnownError(res, err)) return;
    next(err);
  }
});

router.get('/recent-events', async (req, res, next) => {
  try {
    const common = await validateCommon(req, res);
    if (!common) return;
    let pagination;
    try {
      pagination = parsePaginationParams(req.query);
    } catch (rangeErr) {
      return res.status(400).json({ error: rangeErr.message });
    }
    const visitLogs = await listRecentEvents(getDb(req), {
      propertyId: common.propertyId,
      accessPointId: common.accessPointId,
      limit: pagination.limit,
      offset: pagination.offset,
    });
    res.json({
      visit_logs: visitLogs,
      page: buildPageMeta({ ...pagination, returnedCount: visitLogs.length }),
    });
  } catch (err) {
    if (sendKnownError(res, err)) return;
    next(err);
  }
});

async function sendManualDecision(req, res, next, forcedDecision = null) {
  try {
    if (forcedDecision) req.body = { ...(req.body || {}), decision: forcedDecision };
    const propertyId = resolvePropertyId(req);
    const accessPointId = parseAccessPointId(req);
    if (!isValidUuid(propertyId)) return res.status(400).json({ error: 'property_id must be UUID' });
    if (accessPointId !== null && !isValidUuid(accessPointId)) {
      return res.status(400).json({ error: 'access_point_id must be UUID or omitted' });
    }
    if (!canCreateManualDecision(req, propertyId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await validateAccessPoint(getDb(req), { propertyId, accessPointId });

    const input = parseManualDecisionBody(req, res, propertyId, accessPointId);
    if (!input) return;

    const result = await createManualSecurityDecision({
      txPool: getTxPool(req),
      user: req.user,
      input,
    });
    res.status(201).json(result);
  } catch (err) {
    if (sendKnownError(res, err)) return;
    if (err && err.code === '23503') return res.status(400).json({ error: 'referenced entity does not exist' });
    if (err && err.code === '23514') return res.status(400).json({ error: 'manual decision constraint violation' });
    next(err);
  }
}

router.post('/manual-decision', async (req, res, next) => {
  await sendManualDecision(req, res, next);
});

router.post('/manual-admit', async (req, res, next) => {
  await sendManualDecision(req, res, next, 'manual_admit');
});

router.post('/manual-deny', async (req, res, next) => {
  await sendManualDecision(req, res, next, 'manual_deny');
});

router.post('/offline-replay', async (req, res, next) => {
  try {
    const propertyId = resolvePropertyId(req);
    if (!isValidUuid(propertyId)) return res.status(400).json({ error: 'property_id must be UUID' });
    if (!canCreateManualDecision(req, propertyId)) return res.status(403).json({ error: 'Forbidden' });

    const events = req.body?.events;
    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ error: 'events must be a non-empty array' });
    }

    for (const event of events) {
      if (event?.access_point_id !== undefined && event.access_point_id !== null && !isValidUuid(event.access_point_id)) {
        return res.status(400).json({ error: 'access_point_id must be UUID or null' });
      }
      if (event?.access_point_id) {
        await validateAccessPoint(getDb(req), { propertyId, accessPointId: event.access_point_id });
      }
    }

    const results = await replaySecurityOfflineEvents({
      queryable: getDb(req),
      txPool: getTxPool(req),
      user: req.user,
      propertyId,
      events,
    });
    res.status(202).json({ results });
  } catch (err) {
    if (sendKnownError(res, err)) return;
    if (err && err.code === '23505') return res.status(409).json({ error: 'offline replay event already exists' });
    next(err);
  }
});

router.post('/degraded-events/:visitLogId/reconcile', async (req, res, next) => {
  try {
    if (!isValidUuid(req.params.visitLogId)) return res.status(400).json({ error: 'Invalid visitLogId' });
    const propertyId = resolvePropertyId(req);
    if (!isValidUuid(propertyId)) return res.status(400).json({ error: 'property_id must be UUID' });
    if (!canCreateManualDecision(req, propertyId)) return res.status(403).json({ error: 'Forbidden' });
    const state = req.body?.reconciliation_state || req.body?.state;
    if (!RECONCILIATION_STATES.has(state)) return res.status(400).json({ error: 'Invalid reconciliation_state' });
    const note = req.body?.note === undefined || req.body?.note === null ? null : String(req.body.note).trim();
    const result = await reconcileDegradedVisitLog({
      queryable: getDb(req),
      user: req.user,
      propertyId,
      visitLogId: req.params.visitLogId,
      state,
      note,
      ipAddress: req.ip || null,
    });
    res.json(result);
  } catch (err) {
    if (sendKnownError(res, err)) return;
    next(err);
  }
});

module.exports = router;
