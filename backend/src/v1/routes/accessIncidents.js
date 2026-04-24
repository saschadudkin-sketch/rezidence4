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
const { isStaff, isAdmin, isSecurity: isSecurityAuthz } = require('../lib/authz');

const router = express.Router();
router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INCIDENT_TYPES = new Set([
  'expired_pass_attempt', 'invalid_qr', 'blacklist_hit',
  'outside_time_window', 'unauthorized_vehicle', 'manual_override',
  'provider_conflict', 'suspicious_repeat_attempt',
]);
const SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);
const INCIDENT_STATUSES = new Set(['open', 'investigating', 'resolved', 'dismissed']);
const TERMINAL_INCIDENT = new Set(['resolved', 'dismissed']);
const OVERRIDE_TYPES = new Set([
  'manual_admit', 'manual_deny', 'temporary_whitelist', 'temporary_block',
]);

function isValidUuid(v) { return typeof v === 'string' && UUID_RE.test(v); }
// Shim'ы под legacy callsites:
const isSecurity = isSecurityAuthz;
const isPropertyAdmin = isAdmin;
function isNonEmptyString(v, maxLen) {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= (maxLen || 500);
}

function auditLog(req, { action, resourceType, resourceId, changes }) {
  db.query(
    `INSERT INTO audit_log
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
  ).catch((err) => logger.warn({ err, action }, '[v1/access-incidents] audit write failed'));
}

const INCIDENT_COLS = `
  id, property_id,
  related_pass_id, related_visit_log_id, related_vehicle_id,
  incident_type, severity, status, title, description,
  created_by_staff_id, assigned_to_staff_id, resolved_at, created_at
`;
const OVERRIDE_COLS = `
  id, property_id, incident_id, pass_id,
  performed_by_staff_id, override_type, reason, created_at
`;

// ══════════════════════════════════════════════════════════════════════════════
// INCIDENTS
// ══════════════════════════════════════════════════════════════════════════════

// ─── GET /api/v1/access-incidents ────────────────────────────────────────────
// Guard dashboard: default status=open|investigating, sort by severity DESC.
router.get('/access-incidents', async (req, res, next) => {
  try {
    if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    const filters = [];
    const params = [];

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
    const { rows } = await db.query(
      `SELECT ${INCIDENT_COLS} FROM access_incidents ${where}
        ORDER BY ${severityOrder} DESC, created_at DESC LIMIT 500`,
      params,
    );
    res.json({ incidents: rows });
  } catch (err) { next(err); }
});

// ─── GET /api/v1/access-incidents/:id ────────────────────────────────────────
router.get('/access-incidents/:id', async (req, res, next) => {
  try {
    if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const { rows } = await db.query(
      `SELECT ${INCIDENT_COLS} FROM access_incidents WHERE id = $1`,
      [req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Incident not found' });

    const { rows: ovRows } = await db.query(
      `SELECT ${OVERRIDE_COLS} FROM access_overrides
        WHERE incident_id = $1 ORDER BY created_at ASC`,
      [req.params.id],
    );
    res.json({ incident: rows[0], overrides: ovRows });
  } catch (err) { next(err); }
});

// ─── POST /api/v1/access-incidents ───────────────────────────────────────────
// Ручное создание инцидента staff'ом (система создаёт через verify-flow,
// минуя этот endpoint).
router.post('/access-incidents', async (req, res, next) => {
  try {
    if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    const {
      property_id, incident_type,
      severity = 'medium',
      title, description = null,
      related_pass_id = null, related_visit_log_id = null, related_vehicle_id = null,
    } = req.body || {};

    if (!isValidUuid(property_id)) return res.status(400).json({ error: 'property_id must be UUID' });
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

    const { rows } = await db.query(
      `INSERT INTO access_incidents
         (property_id, related_pass_id, related_visit_log_id, related_vehicle_id,
          incident_type, severity, status, title, description, created_by_staff_id)
       VALUES ($1,$2,$3,$4,$5,$6,'open',$7,$8,$9)
       RETURNING ${INCIDENT_COLS}`,
      [property_id, related_pass_id, related_visit_log_id, related_vehicle_id,
       incident_type, severity, title, description, req.user.uid],
    );
    auditLog(req, {
      action: 'incident.created',
      resourceType: 'access_incident',
      resourceId: rows[0].id,
      changes: { incident_type, severity },
    });
    // Placeholder для Фазы 5 notification_log:
    if (severity === 'high' || severity === 'critical') {
      logger.info({ severity, incident_id: rows[0].id }, 'incident.notify.pending');
    }
    res.status(201).json({ incident: rows[0] });
  } catch (err) {
    if (err && err.code === '23503') return res.status(400).json({ error: 'referenced entity does not exist' });
    if (err && err.code === '23505') return res.status(409).json({ error: 'incident already exists for this visit_log' });
    next(err);
  }
});

// ─── POST /api/v1/access-incidents/:id/assign ────────────────────────────────
router.post('/access-incidents/:id/assign', async (req, res, next) => {
  try {
    if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const assignee = req.body?.assigned_to_staff_id;
    if (!isValidUuid(assignee)) return res.status(400).json({ error: 'assigned_to_staff_id must be UUID' });

    const { rows: curRows } = await db.query(
      `SELECT status FROM access_incidents WHERE id = $1`,
      [req.params.id],
    );
    if (!curRows[0]) return res.status(404).json({ error: 'Incident not found' });
    if (TERMINAL_INCIDENT.has(curRows[0].status)) {
      return res.status(409).json({ error: `Cannot assign in status '${curRows[0].status}'` });
    }
    const { rows } = await db.query(
      `UPDATE access_incidents
          SET assigned_to_staff_id = $1,
              status = CASE WHEN status = 'open' THEN 'investigating' ELSE status END
        WHERE id = $2 RETURNING ${INCIDENT_COLS}`,
      [assignee, req.params.id],
    );
    auditLog(req, {
      action: 'incident.assigned',
      resourceType: 'access_incident',
      resourceId: req.params.id,
      changes: { assigned_to_staff_id: assignee },
    });
    res.json({ incident: rows[0] });
  } catch (err) { next(err); }
});

// ─── POST /api/v1/access-incidents/:id/resolve ───────────────────────────────
// Транзакция: incident → 'resolved' + optional override INSERT.
router.post('/access-incidents/:id/resolve', async (req, res, next) => {
  if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (!reason) return res.status(400).json({ error: 'reason is required' });

  const overrideInput = req.body?.create_override || null;
  if (overrideInput) {
    if (!OVERRIDE_TYPES.has(overrideInput.override_type)) {
      return res.status(400).json({ error: 'Invalid override_type' });
    }
    if (!isNonEmptyString(overrideInput.reason, 500)) {
      return res.status(422).json({ error: 'override.reason is required' });
    }
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: curRows } = await client.query(
      `SELECT property_id, status, related_pass_id, assigned_to_staff_id
         FROM access_incidents WHERE id = $1 FOR UPDATE`,
      [req.params.id],
    );
    if (!curRows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Incident not found' });
    }
    if (TERMINAL_INCIDENT.has(curRows[0].status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Incident already ${curRows[0].status}` });
    }
    // ACL: assigned_to or property_admin
    if (!isPropertyAdmin(req)
        && curRows[0].assigned_to_staff_id
        && curRows[0].assigned_to_staff_id !== req.user.uid) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Incident is assigned to another staff' });
    }

    const { rows: incRows } = await client.query(
      `UPDATE access_incidents
          SET status = 'resolved', resolved_at = NOW(),
              description = COALESCE(description, '') ||
                           CASE WHEN description IS NULL OR description = '' THEN '' ELSE E'\n' END ||
                           '[resolved] ' || $1
        WHERE id = $2 RETURNING ${INCIDENT_COLS}`,
      [reason, req.params.id],
    );

    let overrideRow = null;
    if (overrideInput) {
      const { rows: ovRows } = await client.query(
        `INSERT INTO access_overrides
           (property_id, incident_id, pass_id, performed_by_staff_id, override_type, reason)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING ${OVERRIDE_COLS}`,
        [incRows[0].property_id, req.params.id,
         overrideInput.pass_id || curRows[0].related_pass_id || null,
         req.user.uid, overrideInput.override_type, overrideInput.reason.trim()],
      );
      overrideRow = ovRows[0];
    }

    await client.query('COMMIT');
    auditLog(req, {
      action: 'incident.resolved',
      resourceType: 'access_incident',
      resourceId: req.params.id,
      changes: { reason, override_id: overrideRow?.id || null },
    });
    res.json({ incident: incRows[0], override: overrideRow });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    if (err && err.code === '23514') return res.status(400).json({ error: 'override constraint violation' });
    next(err);
  } finally {
    client.release();
  }
});

// ─── POST /api/v1/access-incidents/:id/dismiss ───────────────────────────────
router.post('/access-incidents/:id/dismiss', async (req, res, next) => {
  try {
    if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!reason) return res.status(400).json({ error: 'reason is required' });

    const { rows: curRows } = await db.query(
      `SELECT status, assigned_to_staff_id FROM access_incidents WHERE id = $1`,
      [req.params.id],
    );
    if (!curRows[0]) return res.status(404).json({ error: 'Incident not found' });
    if (TERMINAL_INCIDENT.has(curRows[0].status)) {
      return res.status(409).json({ error: `Incident already ${curRows[0].status}` });
    }
    if (!isPropertyAdmin(req)
        && curRows[0].assigned_to_staff_id
        && curRows[0].assigned_to_staff_id !== req.user.uid) {
      return res.status(403).json({ error: 'Incident is assigned to another staff' });
    }
    const { rows } = await db.query(
      `UPDATE access_incidents
          SET status = 'dismissed', resolved_at = NOW(),
              description = COALESCE(description, '') ||
                           CASE WHEN description IS NULL OR description = '' THEN '' ELSE E'\n' END ||
                           '[dismissed] ' || $1
        WHERE id = $2 RETURNING ${INCIDENT_COLS}`,
      [reason, req.params.id],
    );
    auditLog(req, {
      action: 'incident.dismissed',
      resourceType: 'access_incident',
      resourceId: req.params.id,
      changes: { reason },
    });
    res.json({ incident: rows[0] });
  } catch (err) { next(err); }
});

// ─── PATCH /api/v1/access-incidents/:id ──────────────────────────────────────
// Обновить severity/title/description.  status меняется только через
// dedicated endpoints (assign/resolve/dismiss).
router.patch('/access-incidents/:id', async (req, res, next) => {
  try {
    if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });

    const sets = [];
    const params = [];
    const changes = {};
    if (req.body.severity !== undefined) {
      if (!SEVERITIES.has(req.body.severity)) return res.status(400).json({ error: 'Invalid severity' });
      params.push(req.body.severity); sets.push(`severity = $${params.length}`); changes.severity = req.body.severity;
    }
    if (req.body.title !== undefined) {
      if (!isNonEmptyString(req.body.title, 500)) return res.status(400).json({ error: 'title: 1–500 chars' });
      params.push(req.body.title); sets.push(`title = $${params.length}`); changes.title = req.body.title;
    }
    if (req.body.description !== undefined) {
      if (req.body.description !== null && typeof req.body.description !== 'string') {
        return res.status(400).json({ error: 'description must be string or null' });
      }
      params.push(req.body.description); sets.push(`description = $${params.length}`);
    }
    if (!sets.length) return res.status(400).json({ error: 'No updatable fields provided' });
    params.push(req.params.id);

    const { rows } = await db.query(
      `UPDATE access_incidents SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${INCIDENT_COLS}`,
      params,
    );
    if (!rows[0]) return res.status(404).json({ error: 'Incident not found' });
    auditLog(req, {
      action: 'incident.patched',
      resourceType: 'access_incident',
      resourceId: req.params.id,
      changes,
    });
    res.json({ incident: rows[0] });
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════════════════════════
// OVERRIDES
// ══════════════════════════════════════════════════════════════════════════════

// ─── GET /api/v1/access-overrides ────────────────────────────────────────────
router.get('/access-overrides', async (req, res, next) => {
  try {
    if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    const filters = [];
    const params = [];
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
    const { rows } = await db.query(
      `SELECT ${OVERRIDE_COLS} FROM access_overrides ${where}
        ORDER BY created_at DESC LIMIT 500`,
      params,
    );
    res.json({ overrides: rows });
  } catch (err) { next(err); }
});

// ─── GET /api/v1/access-overrides/:id ────────────────────────────────────────
router.get('/access-overrides/:id', async (req, res, next) => {
  try {
    if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const { rows } = await db.query(`SELECT ${OVERRIDE_COLS} FROM access_overrides WHERE id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Override not found' });
    res.json({ override: rows[0] });
  } catch (err) { next(err); }
});

// ─── POST /api/v1/access-overrides ───────────────────────────────────────────
// Standalone — обычно overrides создаются через incidents/:id/resolve,
// но допускается напрямую для temp-whitelist/temp-block.
router.post('/access-overrides', async (req, res, next) => {
  try {
    if (!isSecurity(req)) return res.status(403).json({ error: 'Forbidden' });
    const {
      property_id, incident_id = null, pass_id = null,
      override_type, reason,
    } = req.body || {};

    if (!isValidUuid(property_id)) return res.status(400).json({ error: 'property_id must be UUID' });
    if (incident_id !== null && !isValidUuid(incident_id)) return res.status(400).json({ error: 'Invalid incident_id' });
    if (pass_id !== null && !isValidUuid(pass_id)) return res.status(400).json({ error: 'Invalid pass_id' });
    if (!incident_id && !pass_id) {
      return res.status(400).json({ error: 'override must reference incident_id or pass_id' });
    }
    if (!OVERRIDE_TYPES.has(override_type)) return res.status(400).json({ error: 'Invalid override_type' });
    if (!isNonEmptyString(reason, 500)) return res.status(422).json({ error: 'reason is required' });

    const { rows } = await db.query(
      `INSERT INTO access_overrides
         (property_id, incident_id, pass_id, performed_by_staff_id, override_type, reason)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${OVERRIDE_COLS}`,
      [property_id, incident_id, pass_id, req.user.uid, override_type, reason.trim()],
    );
    auditLog(req, {
      action: 'override.created',
      resourceType: 'access_override',
      resourceId: rows[0].id,
      changes: { override_type, incident_id, pass_id },
    });
    res.status(201).json({ override: rows[0] });
  } catch (err) {
    if (err && err.code === '23503') return res.status(400).json({ error: 'referenced entity does not exist' });
    if (err && err.code === '23514') return res.status(400).json({ error: 'override constraint violation' });
    next(err);
  }
});

module.exports = router;
