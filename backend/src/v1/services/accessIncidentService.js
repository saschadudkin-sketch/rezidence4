'use strict';

const { normalizePlate } = require('../lib/normalizePlate');
const { resolveStaffIdByUid } = require('./accessActorResolver');
const {
  StateTransitionError,
  assertIncidentAction,
} = require('./accessStateMachine');

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
const VISIT_LOG_COLS = `
  id, property_id, pass_id, access_point_id, event_type, event_source,
  person_label, vehicle_plate, performed_by_staff_id,
  provider_event_id, provider_payload, occurred_at, created_at
`;

class AccessIncidentServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'AccessIncidentServiceError';
    this.status = status;
  }
}

function serviceError(status, message) {
  return new AccessIncidentServiceError(status, message);
}

function isAccessIncidentServiceError(err) {
  return err instanceof AccessIncidentServiceError || err instanceof StateTransitionError;
}

async function requireStaffId(queryable, user) {
  const staffId = await resolveStaffIdByUid(queryable, user?.uid);
  if (!staffId) throw serviceError(403, 'Staff identity is not mapped to v1');
  return staffId;
}

async function createIncident({ queryable, user, input }) {
  const staffId = await requireStaffId(queryable, user);
  const { rows } = await queryable.query(
    `INSERT INTO access_incidents
       (property_id, related_pass_id, related_visit_log_id, related_vehicle_id,
        incident_type, severity, status, title, description, created_by_staff_id)
     VALUES ($1,$2,$3,$4,$5,$6,'open',$7,$8,$9)
    RETURNING ${INCIDENT_COLS}`,
    [
      input.property_id,
      input.related_pass_id,
      input.related_visit_log_id,
      input.related_vehicle_id,
      input.incident_type,
      input.severity,
      input.title,
      input.description,
      staffId,
    ],
  );
  return { incident: rows[0] };
}

async function assignIncident({ queryable, incidentId, assignee }) {
  const { rows: curRows } = await queryable.query(
    `SELECT status FROM access_incidents WHERE id = $1`,
    [incidentId],
  );
  if (!curRows[0]) throw serviceError(404, 'Incident not found');
  assertIncidentAction(curRows[0].status, 'assign');
  const { rows } = await queryable.query(
    `UPDATE access_incidents
        SET assigned_to_staff_id = $1,
            status = CASE WHEN status = 'open' THEN 'investigating' ELSE status END
      WHERE id = $2 RETURNING ${INCIDENT_COLS}`,
    [assignee, incidentId],
  );
  return { incident: rows[0] };
}

async function resolveIncident({ txPool, user, incidentId, reason, overrideInput, isPropertyAdmin }) {
  const client = await txPool.connect();
  try {
    await client.query('BEGIN');
    const staffId = await requireStaffId(client, user);
    const { rows: curRows } = await client.query(
      `SELECT property_id, status, related_pass_id, assigned_to_staff_id
         FROM access_incidents WHERE id = $1 FOR UPDATE`,
      [incidentId],
    );
    if (!curRows[0]) throw serviceError(404, 'Incident not found');
    assertIncidentAction(curRows[0].status, 'resolve');
    if (!isPropertyAdmin && curRows[0].assigned_to_staff_id && curRows[0].assigned_to_staff_id !== staffId) {
      throw serviceError(403, 'Incident is assigned to another staff');
    }

    const { rows: incRows } = await client.query(
      `UPDATE access_incidents
          SET status = 'resolved', resolved_at = NOW(),
              description = COALESCE(description, '') ||
                           CASE WHEN description IS NULL OR description = '' THEN '' ELSE E'\n' END ||
                           '[resolved] ' || $1
        WHERE id = $2 RETURNING ${INCIDENT_COLS}`,
      [reason, incidentId],
    );

    let overrideRow = null;
    if (overrideInput) {
      const { rows: ovRows } = await client.query(
        `INSERT INTO access_overrides
           (property_id, incident_id, pass_id, performed_by_staff_id, override_type, reason)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING ${OVERRIDE_COLS}`,
        [
          incRows[0].property_id,
          incidentId,
          overrideInput.pass_id || curRows[0].related_pass_id || null,
          staffId,
          overrideInput.override_type,
          overrideInput.reason.trim(),
        ],
      );
      overrideRow = ovRows[0];
    }

    await client.query('COMMIT');
    return { incident: incRows[0], override: overrideRow };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

async function dismissIncident({ queryable, user, incidentId, reason, isPropertyAdmin }) {
  const { rows: curRows } = await queryable.query(
    `SELECT status, assigned_to_staff_id FROM access_incidents WHERE id = $1`,
    [incidentId],
  );
  if (!curRows[0]) throw serviceError(404, 'Incident not found');
  assertIncidentAction(curRows[0].status, 'dismiss');
  const staffId = await requireStaffId(queryable, user);
  if (!isPropertyAdmin && curRows[0].assigned_to_staff_id && curRows[0].assigned_to_staff_id !== staffId) {
    throw serviceError(403, 'Incident is assigned to another staff');
  }
  const { rows } = await queryable.query(
    `UPDATE access_incidents
        SET status = 'dismissed', resolved_at = NOW(),
            description = COALESCE(description, '') ||
                         CASE WHEN description IS NULL OR description = '' THEN '' ELSE E'\n' END ||
                         '[dismissed] ' || $1
      WHERE id = $2 RETURNING ${INCIDENT_COLS}`,
    [reason, incidentId],
  );
  return { incident: rows[0] };
}

async function patchIncident({ queryable, incidentId, changes }) {
  const sets = [];
  const params = [];
  for (const [key, value] of Object.entries(changes)) {
    params.push(value);
    sets.push(`${key} = $${params.length}`);
  }
  if (!sets.length) throw serviceError(400, 'No updatable fields provided');
  params.push(incidentId);

  const { rows } = await queryable.query(
    `UPDATE access_incidents SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${INCIDENT_COLS}`,
    params,
  );
  if (!rows[0]) throw serviceError(404, 'Incident not found');
  return { incident: rows[0] };
}

async function createOverride({ queryable, user, input }) {
  const staffId = await requireStaffId(queryable, user);
  const { rows } = await queryable.query(
    `INSERT INTO access_overrides
       (property_id, incident_id, pass_id, performed_by_staff_id, override_type, reason)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${OVERRIDE_COLS}`,
    [
      input.property_id,
      input.incident_id,
      input.pass_id,
      staffId,
      input.override_type,
      input.reason.trim(),
    ],
  );
  return { override: rows[0] };
}

function manualDecisionTitle(input) {
  const label = input.decision === 'manual_admit' ? 'Manual admit' : 'Manual deny';
  return input.access_point_id ? `${label} at access point` : label;
}

function manualDecisionDescription(input) {
  const parts = [
    '[manual-decision]',
    input.reason.trim(),
  ];
  if (input.direction) parts.push(`direction=${input.direction}`);
  if (input.degraded_mode) parts.push(`degraded_reason=${input.degraded_reason || 'unspecified'}`);
  return parts.join(' ');
}

async function createManualSecurityDecision({ txPool, user, input }) {
  const client = await txPool.connect();
  const normalizedPlate = input.vehicle_plate ? normalizePlate(input.vehicle_plate) : null;
  const occurredAtIso = input.occurred_at || new Date().toISOString();
  const severity = input.severity || (input.decision === 'manual_deny' ? 'medium' : 'low');
  const providerPayload = {
    source: 'security_workspace',
    manual_decision: true,
    decision: input.decision,
    direction: input.direction || 'entry',
    reason: input.reason.trim(),
    degraded_mode: input.degraded_mode === true,
    degraded_reason: input.degraded_reason || null,
    lookup_state: input.lookup_state || null,
    reconciliation_state: input.degraded_mode ? 'pending' : 'not_required',
  };

  try {
    await client.query('BEGIN');
    const staffId = await requireStaffId(client, user);

    const { rows: visitRows } = await client.query(
      `INSERT INTO visit_logs_v2
         (property_id, pass_id, access_point_id, event_type, event_source,
          person_label, vehicle_plate, performed_by_staff_id,
          provider_event_id, provider_payload, occurred_at)
       VALUES ($1,$2,$3,$4,'guard_console',$5,$6,$7,NULL,$8,$9)
       RETURNING ${VISIT_LOG_COLS}`,
      [
        input.property_id,
        input.pass_id || null,
        input.access_point_id || null,
        input.decision,
        input.person_label || null,
        normalizedPlate,
        staffId,
        JSON.stringify(providerPayload),
        occurredAtIso,
      ],
    );
    const visitLog = visitRows[0];

    const { rows: incidentRows } = await client.query(
      `INSERT INTO access_incidents
         (property_id, related_pass_id, related_visit_log_id, related_vehicle_id,
          incident_type, severity, status, title, description,
          created_by_staff_id, resolved_at)
       VALUES ($1,$2,$3,$4,'manual_override',$5,'resolved',$6,$7,$8,NOW())
       RETURNING ${INCIDENT_COLS}`,
      [
        input.property_id,
        input.pass_id || null,
        visitLog.id,
        input.related_vehicle_id || null,
        severity,
        manualDecisionTitle(input),
        manualDecisionDescription(input),
        staffId,
      ],
    );
    const incident = incidentRows[0];

    const { rows: overrideRows } = await client.query(
      `INSERT INTO access_overrides
         (property_id, incident_id, pass_id, performed_by_staff_id, override_type, reason)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING ${OVERRIDE_COLS}`,
      [
        input.property_id,
        incident.id,
        input.pass_id || null,
        staffId,
        input.decision,
        input.reason.trim(),
      ],
    );
    const override = overrideRows[0];

    await client.query(
      `INSERT INTO property_audit_log
         (property_id, actor_uid, actor_role, actor_type, entity_type, entity_id,
          action, resource_type, resource_id, changes, ip_address)
       VALUES ($1,$2,$3,'staff','staff',$4,'override.created','access_override',$5,$6,$7)`,
      [
        input.property_id,
        user?.uid || null,
        user?.role || null,
        staffId,
        override.id,
        JSON.stringify({
          override_type: input.decision,
          incident_id: incident.id,
          pass_id: input.pass_id || null,
          visit_log_id: visitLog.id,
          access_point_id: input.access_point_id || null,
          direction: input.direction || 'entry',
          degraded_mode: input.degraded_mode === true,
          degraded_reason: input.degraded_reason || null,
          lookup_state: input.lookup_state || null,
        }),
        input.ip_address || null,
      ],
    );

    await client.query('COMMIT');
    return { visit_log: visitLog, incident, override };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  INCIDENT_COLS,
  OVERRIDE_COLS,
  AccessIncidentServiceError,
  assignIncident,
  createIncident,
  createManualSecurityDecision,
  createOverride,
  dismissIncident,
  isAccessIncidentServiceError,
  patchIncident,
  resolveIncident,
};
