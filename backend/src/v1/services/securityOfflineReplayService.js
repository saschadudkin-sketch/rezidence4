'use strict';

const { normalizePlate } = require('../lib/normalizePlate');
const { resolveStaffIdByUid } = require('./accessActorResolver');
const { createManualSecurityDecision } = require('./accessIncidentService');

class SecurityOfflineReplayServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'SecurityOfflineReplayServiceError';
    this.status = status;
  }
}

function serviceError(status, message) {
  return new SecurityOfflineReplayServiceError(status, message);
}

function isSecurityOfflineReplayServiceError(err) {
  return err instanceof SecurityOfflineReplayServiceError;
}

async function recordReplayEvent({ queryable, propertyId, staffId, event }) {
  const occurredAt = event.occurred_at || new Date().toISOString();
  const payload = {
    ...event,
    vehicle_plate: event.vehicle_plate ? normalizePlate(event.vehicle_plate) : event.vehicle_plate || null,
  };

  const existing = await queryable.query(
    `SELECT id, property_id, client_event_id, event_type, 'duplicate'::text AS replay_status,
            occurred_at, payload, processed_at, created_at
       FROM security_offline_replay_events
      WHERE property_id = $1 AND client_event_id = $2
      LIMIT 1`,
    [propertyId, event.client_event_id],
  );
  if (existing.rows[0]) return existing.rows[0];

  const { rows } = await queryable.query(
    `INSERT INTO security_offline_replay_events
       (property_id, client_event_id, access_point_id, performed_by_staff_id,
        event_type, replay_status, occurred_at, payload, processed_at)
     VALUES ($1,$2,$3,$4,$5,'accepted',$6,$7::jsonb,NOW())
     RETURNING id, property_id, client_event_id, event_type, replay_status,
               occurred_at, payload, processed_at, created_at`,
    [
      propertyId,
      event.client_event_id,
      event.access_point_id || null,
      staffId || null,
      event.event_type || event.decision,
      occurredAt,
      JSON.stringify(payload),
    ],
  );
  return rows[0];
}

async function replaySecurityOfflineEvents({ queryable, txPool, user, propertyId, events }) {
  if (!Array.isArray(events) || events.length === 0) {
    throw serviceError(400, 'events must be a non-empty array');
  }
  if (events.length > 100) throw serviceError(400, 'events limit is 100');

  const staffId = await resolveStaffIdByUid(queryable, user?.uid);
  if (!staffId) throw serviceError(403, 'Staff identity is not mapped to v1');

  const results = [];
  for (const event of events) {
    if (!event || typeof event !== 'object') throw serviceError(400, 'event must be object');
    if (typeof event.client_event_id !== 'string' || !event.client_event_id.trim()) {
      throw serviceError(400, 'client_event_id required');
    }
    const eventType = event.event_type || event.decision;
    if (!['manual_admit', 'manual_deny', 'lookup_snapshot', 'sync_error'].includes(eventType)) {
      throw serviceError(400, 'invalid event_type');
    }
    if ((eventType === 'manual_admit' || eventType === 'manual_deny')
        && (typeof event.reason !== 'string' || !event.reason.trim())) {
      throw serviceError(422, 'manual replay event reason is required');
    }

    const replayEvent = await recordReplayEvent({
      queryable,
      propertyId,
      staffId,
      event: { ...event, event_type: eventType },
    });
    if (replayEvent.replay_status === 'duplicate') {
      results.push({ replay_event: replayEvent, result: null });
      continue;
    }

    let result = null;
    if (eventType === 'manual_admit' || eventType === 'manual_deny') {
      result = await createManualSecurityDecision({
        txPool,
        user,
        input: {
          property_id: propertyId,
          access_point_id: event.access_point_id || null,
          decision: eventType,
          direction: event.direction || 'entry',
          reason: event.reason,
          pass_id: event.pass_id || null,
          related_vehicle_id: event.related_vehicle_id || event.vehicle_id || null,
          person_label: event.person_label || null,
          vehicle_plate: event.vehicle_plate || null,
          degraded_mode: true,
          degraded_reason: event.degraded_reason || 'later_reconciliation',
          lookup_state: event.lookup_state || 'not_checked',
          occurred_at: event.occurred_at || null,
          severity: event.severity || (eventType === 'manual_deny' ? 'medium' : 'low'),
          ip_address: event.ip_address || null,
          offline_replay_event_id: replayEvent.id,
        },
      });
    }

    results.push({ replay_event: replayEvent, result });
  }

  return results;
}

module.exports = {
  SecurityOfflineReplayServiceError,
  isSecurityOfflineReplayServiceError,
  replaySecurityOfflineEvents,
};
