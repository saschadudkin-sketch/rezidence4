'use strict';

// platform-v1 Access-Incidents + Access-Overrides route.
// Spec: docs/product/specs/platform-v1/access-incidents-spec.md
// Phase: 3 (Access-core).
//
// Incidents — управляемая очередь задач security.  Большинство создаётся
// системой из verify-flow (см. services/verifyPass.js), часть — руками
// guard'ом.  Overrides — аудит решений staff в обход автополитики;
// append-only (как visit_logs).
//
// Роуты группируются в одном модуле, т.к. lifecycle переплетён:
//   resolve(incident) часто создаёт override в той же транзакции.
//
// В registerApiRoutes оба mount'а (/access-incidents и /access-overrides)
// указывают на один и тот же router.

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
  INCIDENT_COLS,
  OVERRIDE_COLS,
  assignIncident,
  createIncident,
  createOverride,
  dismissIncident,
  isAccessIncidentServiceError,
  patchIncident,
  resolveIncident,
} = require('../services/accessIncidentService');

const router = express.Router();
router.use(requireAuth);

// SEC [AUDIT #1] — per-tenant pool, см. комментарий в structure.js.
const getDb = (req) => req.db || db;
const getTxPool = (req) => (typeof req.db?.connect === 'function' ? req.db : db.pool);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INCIDENT_TYPES = new Set([
  'expired_pass_attempt', 'invalid_qr', 'blacklist_hit',
  'outside_time_window', 'unauthorized_vehicle', 'manual_override',
  'provider_conflict', 'suspicious_repeat_attempt',
]);
const SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);
const INCIDENT_STATUSES = new Set(['open', 'investigating', 'resolved', 'dismissed']);
const OVERRIDE_TYPES = new Set([
  'manual_admit', 'manual_deny', 'temporary_whitelist', 'temporary_block',
]);

function isValidUuid(v) { return typeof v === 'string' && UUID_RE.test(v); }
function isPropertyAdmin(req, propertyId = null) {
  if (!propertyId) return isAdmin(req);
  return canInPropertyScope(req, 'incidents:override', propertyId);
}
function isNonEmptyString(v, maxLen) {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= (maxLen || 500);
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

async function loadOwnedProperty(req, resourceType, resourceId, notFoundMessage) {
  return loadResourcePropertyId(getDb(req), resourceType, resourceId, { notFoundMessage });
}

function sendScopeError(res, err) {
  if (!isResourceScopeServiceError(err)) return false;
  res.status(err.status).json({ error: err.message });
  return true;
}

function canReadIncidents(req, propertyId) {
  return canInPropertyScope(req, 'incidents:read', propertyId);
}

function canWriteIncidents(req, propertyId) {
  return canInPropertyScope(req, 'incidents:write', propertyId);
}

function canCreateIncident(req, propertyId) {
  return canInPropertyScope(req, 'access.incident.create', propertyId);
}

function canResolveIncident(req, propertyId) {
  return canInPropertyScope(req, 'access.incident.resolve', propertyId);
}

function canCreateOverride(req, propertyId) {
  return canInPropertyScope(req, 'access.override.create', propertyId);
}

function auditLog(req, { propertyId = null, action, resourceType, resourceId, changes }) {
  getDb(req).query(
    `INSERT INTO property_audit_log
       (property_id, actor_uid, actor_role, actor_type, action, resource_type, resource_id, changes, ip_address)
     VALUES ($1, $2, $3, 'staff', $4, $5, $6, $7, $8)`,
    [
      propertyId,
      req.user?.uid || null,
      req.user?.role || null,
      action,
      resourceType,
      resourceId,
      changes ? JSON.stringify(changes) : null,
      req.ip || null,
    ],
  ).catch((err) => logger.warn({ err, action }, '[v1/access-incidents] audit write failed'));
}

function sendServiceError(res, err) {
  if (!isAccessIncidentServiceError(err)) return false;
  res.status(err.status).json({ error: err.message });
  return true;
}

// ══════════════════════════════════════════════════════════════════════════════
// INCIDENTS
// ══════════════════════════════════════════════════════════════════════════════

// ─── GET /api/v1/access-incidents ────────────────────────────────────────────
// Guard dashboard: default status=open|investigating, sort by severity DESC.
router.get('/access-incidents', async (req, res, next) => {
  try {
    if (!can(req.user, 'incidents:read')) return res.status(403).json({ error: 'Forbidden' });
    const propertyId = resolvePropertyId(req);
    if (!isValidUuid(propertyId)) return res.status(400).json({ error: 'property_id must be UUID' });
    if (!canReadIncidents(req, propertyId)) return res.status(403).json({ error: 'Forbidden' });

    let pagination;
    try {
      pagination = parsePaginationParams(req.query);
    } catch (rangeErr) {
      return res.status(400).json({ error: rangeErr.message });
    }

    const filters = ['property_id = $1'];
    const params = [propertyId];

    if (req.query.status) {
      if (!INCIDENT_STATUSES.has(req.query.status)) return res.status(400).json({ error: 'Invalid status' });
      params.push(req.query.status); filters.push(`status = $${params.length}`);
    } else {
      filters.push(`status IN ('open','investigating')`);
    }
    if (req.query.severity) {
      if (!SEVERITIES.has(req.query.severity)) return res.status(400).json({ error: 'Invalid severity' });
      params.push(req.query.severity); filters.push(`severity = $${params.length}`);
    }
    if (req.query.incident_type) {
      if (!INCIDENT_TYPES.has(req.query.incident_type)) return res.status(400).json({ error: 'Invalid incident_type' });
      params.push(req.query.incident_type); filters.push(`incident_type = $${params.length}`);
    }
    if (req.query.assigned_to_staff_id) {
      if (!isValidUuid(req.query.assigned_to_staff_id)) return res.status(400).json({ error: 'Invalid assigned_to_staff_id' });
      params.push(req.query.assigned_to_staff_id); filters.push(`assigned_to_staff_id = $${params.length}`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const severityOrder = `CASE severity
      WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 END`;
    params.push(pagination.limit);
    const limitIdx = params.length;
    params.push(pagination.offset);
    const offsetIdx = params.length;

    const { rows } = await getDb(req).query(
      `SELECT ${INCIDENT_COLS} FROM access_incidents ${where}
        ORDER BY ${severityOrder} DESC, created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );
    res.json({
      incidents: rows,
      page: buildPageMeta({ ...pagination, returnedCount: rows.length }),
    });
  } catch (err) { next(err); }
});

// ─── GET /api/v1/access-incidents/:id ────────────────────────────────────────
router.get('/access-incidents/:id', async (req, res, next) => {
  try {
    if (!can(req.user, 'incidents:read')) return res.status(403).json({ error: 'Forbidden' });
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const propertyId = await loadOwnedProperty(req, 'access_incident', req.params.id, 'Incident not found');
    if (!canReadIncidents(req, propertyId)) return res.status(403).json({ error: 'Forbidden' });
    const { rows } = await getDb(req).query(
      `SELECT ${INCIDENT_COLS} FROM access_incidents WHERE id = $1`,
      [req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Incident not found' });

    const { rows: ovRows } = await getDb(req).query(
      `SELECT ${OVERRIDE_COLS} FROM access_overrides
        WHERE incident_id = $1 ORDER BY created_at ASC`,
      [req.params.id],
    );
    res.json({ incident: rows[0], overrides: ovRows });
  } catch (err) {
    if (sendScopeError(res, err)) return;
    next(err);
  }
});

// ─── POST /api/v1/access-incidents ───────────────────────────────────────────
// Ручное создание инцидента staff'ом (система создаёт через verify-flow,
// минуя этот endpoint).
// Idempotency: optional Idempotency-Key — защита от double-tap при создании
// инцидента из guard-console.
router.post('/access-incidents', idempotency, async (req, res, next) => {
  try {
    const {
      property_id, incident_type,
      severity = 'medium',
      title, description = null,
      related_pass_id = null, related_visit_log_id = null, related_vehicle_id = null,
    } = req.body || {};

    if (!isValidUuid(property_id)) return res.status(400).json({ error: 'property_id must be UUID' });
    if (!canCreateIncident(req, property_id)) return res.status(403).json({ error: 'Forbidden' });
    if (!INCIDENT_TYPES.has(incident_type)) return res.status(400).json({ error: 'Invalid incident_type' });
    if (!SEVERITIES.has(severity)) return res.status(400).json({ error: 'Invalid severity' });
    if (!isNonEmptyString(title, 500)) return res.status(400).json({ error: 'title is required' });
    if (description !== null && typeof description !== 'string') {
      return res.status(400).json({ error: 'description must be string or null' });
    }
    for (const [k, v] of [
      ['related_pass_id', related_pass_id],
      ['related_visit_log_id', related_visit_log_id],
      ['related_vehicle_id', related_vehicle_id],
    ]) {
      if (v !== null && !isValidUuid(v)) return res.status(400).json({ error: `${k} must be UUID or null` });
    }
    const result = await createIncident({
      queryable: getDb(req),
      user: req.user,
      input: {
        property_id,
        related_pass_id,
        related_visit_log_id,
        related_vehicle_id,
        incident_type,
        severity,
        title,
        description,
      },
    });
    auditLog(req, {
      propertyId: result.incident.property_id,
      action: 'incident.created',
      resourceType: 'access_incident',
      resourceId: result.incident.id,
      changes: { incident_type, severity },
    });
    // Placeholder для Фазы 5 notification_log:
    if (severity === 'high' || severity === 'critical') {
      logger.info({ severity, incident_id: result.incident.id }, 'incident.notify.pending');
    }
    res.status(201).json({ incident: result.incident });
  } catch (err) {
    if (sendServiceError(res, err)) return;
    if (err && err.code === '23503') return res.status(400).json({ error: 'referenced entity does not exist' });
    if (err && err.code === '23505') return res.status(409).json({ error: 'incident already exists for this visit_log' });
    next(err);
  }
});

// ─── POST /api/v1/access-incidents/:id/assign ────────────────────────────────
router.post('/access-incidents/:id/assign', async (req, res, next) => {
  try {
    if (!can(req.user, 'incidents:write')) return res.status(403).json({ error: 'Forbidden' });
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const propertyId = await loadOwnedProperty(req, 'access_incident', req.params.id, 'Incident not found');
    if (!canWriteIncidents(req, propertyId)) return res.status(403).json({ error: 'Forbidden' });
    const assignee = req.body?.assigned_to_staff_id;
    if (!isValidUuid(assignee)) return res.status(400).json({ error: 'assigned_to_staff_id must be UUID' });

    const result = await assignIncident({
      queryable: getDb(req),
      incidentId: req.params.id,
      assignee,
    });
    auditLog(req, {
      propertyId: result.incident.property_id,
      action: 'incident.assigned',
      resourceType: 'access_incident',
      resourceId: req.params.id,
      changes: { assigned_to_staff_id: assignee },
    });
    res.json({ incident: result.incident });
  } catch (err) {
    if (sendScopeError(res, err)) return;
    if (sendServiceError(res, err)) return;
    next(err);
  }
});

// ─── POST /api/v1/access-incidents/:id/resolve ───────────────────────────────
// Транзакция: incident → 'resolved' + optional override INSERT.
router.post('/access-incidents/:id/resolve', async (req, res, next) => {
  if (!can(req.user, 'access.incident.resolve')) return res.status(403).json({ error: 'Forbidden' });
  if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  let propertyId;
  try {
    propertyId = await loadOwnedProperty(req, 'access_incident', req.params.id, 'Incident not found');
  } catch (err) {
    if (sendScopeError(res, err)) return;
    return next(err);
  }
  if (!canResolveIncident(req, propertyId)) return res.status(403).json({ error: 'Forbidden' });
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (!reason) return res.status(400).json({ error: 'reason is required' });

  const overrideInput = req.body?.create_override || null;
  if (overrideInput) {
    if (!canCreateOverride(req, propertyId)) return res.status(403).json({ error: 'Forbidden' });
    if (!OVERRIDE_TYPES.has(overrideInput.override_type)) {
      return res.status(400).json({ error: 'Invalid override_type' });
    }
    if (!isNonEmptyString(overrideInput.reason, 500)) {
      return res.status(422).json({ error: 'override.reason is required' });
    }
  }

  try {
    const result = await resolveIncident({
      txPool: getTxPool(req),
      user: req.user,
      incidentId: req.params.id,
      reason,
      overrideInput,
      isPropertyAdmin: isPropertyAdmin(req, propertyId),
    });
    auditLog(req, {
      propertyId: result.incident.property_id,
      action: 'incident.resolved',
      resourceType: 'access_incident',
      resourceId: req.params.id,
      changes: { reason, override_id: result.override?.id || null },
    });
    res.json({ incident: result.incident, override: result.override });
  } catch (err) {
    if (sendServiceError(res, err)) return;
    if (err && err.code === '23514') return res.status(400).json({ error: 'override constraint violation' });
    next(err);
  }
});

// ─── POST /api/v1/access-incidents/:id/dismiss ───────────────────────────────
router.post('/access-incidents/:id/dismiss', async (req, res, next) => {
  try {
    if (!can(req.user, 'access.incident.resolve')) return res.status(403).json({ error: 'Forbidden' });
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const propertyId = await loadOwnedProperty(req, 'access_incident', req.params.id, 'Incident not found');
    if (!canResolveIncident(req, propertyId)) return res.status(403).json({ error: 'Forbidden' });
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!reason) return res.status(400).json({ error: 'reason is required' });

    const result = await dismissIncident({
      queryable: getDb(req),
      user: req.user,
      incidentId: req.params.id,
      reason,
      isPropertyAdmin: isPropertyAdmin(req, propertyId),
    });
    auditLog(req, {
      propertyId: result.incident.property_id,
      action: 'incident.dismissed',
      resourceType: 'access_incident',
      resourceId: req.params.id,
      changes: { reason },
    });
    res.json({ incident: result.incident });
  } catch (err) {
    if (sendScopeError(res, err)) return;
    if (sendServiceError(res, err)) return;
    next(err);
  }
});

// ─── PATCH /api/v1/access-incidents/:id ──────────────────────────────────────
// Обновить severity/title/description.  status меняется только через
// dedicated endpoints (assign/resolve/dismiss).
router.patch('/access-incidents/:id', async (req, res, next) => {
  try {
    if (!can(req.user, 'incidents:write')) return res.status(403).json({ error: 'Forbidden' });
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const propertyId = await loadOwnedProperty(req, 'access_incident', req.params.id, 'Incident not found');
    if (!canWriteIncidents(req, propertyId)) return res.status(403).json({ error: 'Forbidden' });

    const changes = {};
    if (req.body.severity !== undefined) {
      if (!SEVERITIES.has(req.body.severity)) return res.status(400).json({ error: 'Invalid severity' });
      changes.severity = req.body.severity;
    }
    if (req.body.title !== undefined) {
      if (!isNonEmptyString(req.body.title, 500)) return res.status(400).json({ error: 'title: 1–500 chars' });
      changes.title = req.body.title;
    }
    if (req.body.description !== undefined) {
      if (req.body.description !== null && typeof req.body.description !== 'string') {
        return res.status(400).json({ error: 'description must be string or null' });
      }
      changes.description = req.body.description;
    }
    const result = await patchIncident({ queryable: getDb(req), incidentId: req.params.id, changes });
    auditLog(req, {
      propertyId: result.incident.property_id,
      action: 'incident.patched',
      resourceType: 'access_incident',
      resourceId: req.params.id,
      changes,
    });
    res.json({ incident: result.incident });
  } catch (err) {
    if (sendScopeError(res, err)) return;
    if (sendServiceError(res, err)) return;
    next(err);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// OVERRIDES
// ══════════════════════════════════════════════════════════════════════════════

// ─── GET /api/v1/access-overrides ────────────────────────────────────────────
// Pagination: ?limit=1..200 (default 50), ?offset=0..100000 (default 0)
router.get('/access-overrides', async (req, res, next) => {
  try {
    if (!can(req.user, 'incidents:read')) return res.status(403).json({ error: 'Forbidden' });
    const propertyId = resolvePropertyId(req);
    if (!isValidUuid(propertyId)) return res.status(400).json({ error: 'property_id must be UUID' });
    if (!canReadIncidents(req, propertyId)) return res.status(403).json({ error: 'Forbidden' });

    let pagination;
    try {
      pagination = parsePaginationParams(req.query);
    } catch (rangeErr) {
      return res.status(400).json({ error: rangeErr.message });
    }

    const filters = ['property_id = $1'];
    const params = [propertyId];
    if (req.query.pass_id) {
      if (!isValidUuid(req.query.pass_id)) return res.status(400).json({ error: 'Invalid pass_id' });
      params.push(req.query.pass_id); filters.push(`pass_id = $${params.length}`);
    }
    if (req.query.incident_id) {
      if (!isValidUuid(req.query.incident_id)) return res.status(400).json({ error: 'Invalid incident_id' });
      params.push(req.query.incident_id); filters.push(`incident_id = $${params.length}`);
    }
    if (req.query.performed_by_staff_id) {
      if (!isValidUuid(req.query.performed_by_staff_id)) return res.status(400).json({ error: 'Invalid performed_by_staff_id' });
      params.push(req.query.performed_by_staff_id); filters.push(`performed_by_staff_id = $${params.length}`);
    }
    if (req.query.from) {
      params.push(String(req.query.from)); filters.push(`created_at >= $${params.length}`);
    }
    if (req.query.to) {
      params.push(String(req.query.to)); filters.push(`created_at <= $${params.length}`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    params.push(pagination.limit);
    const limitIdx = params.length;
    params.push(pagination.offset);
    const offsetIdx = params.length;

    const { rows } = await getDb(req).query(
      `SELECT ${OVERRIDE_COLS} FROM access_overrides ${where}
        ORDER BY created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );
    res.json({
      overrides: rows,
      page: buildPageMeta({ ...pagination, returnedCount: rows.length }),
    });
  } catch (err) {
    if (sendScopeError(res, err)) return;
    next(err);
  }
});

// ─── GET /api/v1/access-overrides/:id ────────────────────────────────────────
router.get('/access-overrides/:id', async (req, res, next) => {
  try {
    if (!can(req.user, 'incidents:read')) return res.status(403).json({ error: 'Forbidden' });
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const propertyId = await loadOwnedProperty(req, 'access_override', req.params.id, 'Override not found');
    if (!canReadIncidents(req, propertyId)) return res.status(403).json({ error: 'Forbidden' });
    const { rows } = await getDb(req).query(`SELECT ${OVERRIDE_COLS} FROM access_overrides WHERE id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Override not found' });
    res.json({ override: rows[0] });
  } catch (err) {
    if (sendScopeError(res, err)) return;
    next(err);
  }
});

// ─── POST /api/v1/access-overrides ───────────────────────────────────────────
// Standalone — обычно overrides создаются через incidents/:id/resolve,
// но допускается напрямую для temp-whitelist/temp-block.
router.post('/access-overrides', async (req, res, next) => {
  try {
    const {
      property_id, incident_id = null, pass_id = null,
      override_type, reason,
    } = req.body || {};

    if (!isValidUuid(property_id)) return res.status(400).json({ error: 'property_id must be UUID' });
    if (!canCreateOverride(req, property_id)) return res.status(403).json({ error: 'Forbidden' });
    if (incident_id !== null && !isValidUuid(incident_id)) return res.status(400).json({ error: 'Invalid incident_id' });
    if (pass_id !== null && !isValidUuid(pass_id)) return res.status(400).json({ error: 'Invalid pass_id' });
    if (!incident_id && !pass_id) {
      return res.status(400).json({ error: 'override must reference incident_id or pass_id' });
    }
    if (!OVERRIDE_TYPES.has(override_type)) return res.status(400).json({ error: 'Invalid override_type' });
    if (!isNonEmptyString(reason, 500)) return res.status(422).json({ error: 'reason is required' });
    const result = await createOverride({
      queryable: getDb(req),
      user: req.user,
      input: { property_id, incident_id, pass_id, override_type, reason },
    });
    auditLog(req, {
      propertyId: result.override.property_id,
      action: 'override.created',
      resourceType: 'access_override',
      resourceId: result.override.id,
      changes: { override_type, incident_id, pass_id },
    });
    res.status(201).json({ override: result.override });
  } catch (err) {
    if (sendServiceError(res, err)) return;
    if (err && err.code === '23503') return res.status(400).json({ error: 'referenced entity does not exist' });
    if (err && err.code === '23514') return res.status(400).json({ error: 'override constraint violation' });
    next(err);
  }
});

module.exports = router;
