'use strict';

const { resolveStaffIdByUid } = require('./accessActorResolver');
const { recordResidentLifecycleEvent } = require('./residentLifecycleService');
const { suspendMembershipsForSubject } = require('./roleScopeMembershipService');

class ResidentOffboardingServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ResidentOffboardingServiceError';
    this.status = status;
  }
}

function serviceError(status, message) {
  return new ResidentOffboardingServiceError(status, message);
}

function isResidentOffboardingServiceError(err) {
  return err instanceof ResidentOffboardingServiceError;
}

function normalizeReason(reason) {
  const text = typeof reason === 'string' ? reason.trim() : '';
  if (!text) return 'resident offboarded';
  if (text.length > 500) throw serviceError(400, 'reason is too long');
  return text;
}

function ids(rows) {
  return rows.map((row) => row.id);
}

function toInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeLimit(value, fallback = 25) {
  const parsed = Number.parseInt(value, 10);
  const safe = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(100, Math.max(1, safe));
}

function parseJsonObject(value) {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parseJsonObject(parsed);
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== 'object') return {};
  if (Array.isArray(value)) return {};
  return value;
}

async function resolveActorStaffId(queryable, actor) {
  try {
    if (!actor?.uid) return null;
    return await resolveStaffIdByUid(queryable, actor.uid);
  } catch {
    return null;
  }
}

async function loadResident(queryable, residentId) {
  const { rows } = await queryable.query(
    `SELECT id, property_id, unit_id, external_uid, is_active
       FROM residents
      WHERE id = $1`,
    [residentId],
  );
  if (!rows[0]) throw serviceError(404, 'Resident not found');
  return rows[0];
}

async function loadTransferTarget(queryable, residentId) {
  const { rows } = await queryable.query(
    `SELECT id, property_id, unit_id, external_uid, is_active
       FROM residents
      WHERE id = $1`,
    [residentId],
  );
  if (!rows[0]) throw serviceError(404, 'Target resident not found');
  return rows[0];
}

async function deactivateResidentRow(queryable, residentId) {
  const { rows } = await queryable.query(
    `UPDATE residents
        SET is_active = false,
            updated_at = NOW()
      WHERE id = $1
      RETURNING id, property_id, unit_id, external_uid, is_active`,
    [residentId],
  );
  if (!rows[0]) throw serviceError(404, 'Resident not found');
  return rows[0];
}

async function deactivateUnitLinks(queryable, residentId, reason) {
  const { rows } = await queryable.query(
    `UPDATE resident_unit_links
        SET is_active = false,
            ends_at = COALESCE(ends_at, NOW()),
            ended_reason = COALESCE(ended_reason, $2),
            updated_at = NOW()
      WHERE resident_id = $1
        AND is_active = true
      RETURNING id, unit_id`,
    [residentId, reason],
  );
  return rows;
}

async function revokeResidentPasses(queryable, resident, actorStaffId, reason) {
  const revokedReason = `resident offboarded: ${reason}`;
  const { rows } = await queryable.query(
    `WITH resident_vehicles AS (
       SELECT id
         FROM vehicles
        WHERE owner_resident_id = $1
     )
     UPDATE passes p
        SET status = 'revoked',
            revoked_at = NOW(),
            revoked_by_staff_id = $2,
            revoked_reason = $3
      WHERE p.property_id = $4
        AND p.status IN ('active','blocked')
        AND (
          p.subject_resident_id = $1
          OR p.subject_vehicle_id IN (SELECT id FROM resident_vehicles)
        )
      RETURNING p.id, p.subject_type, p.subject_resident_id, p.subject_vehicle_id`,
    [resident.id, actorStaffId, revokedReason, resident.property_id],
  );
  return rows;
}

async function cancelResidentAccessRequests(queryable, resident) {
  const { rows } = await queryable.query(
    `WITH resident_vehicles AS (
       SELECT id
         FROM vehicles
        WHERE owner_resident_id = $1
     )
     UPDATE access_requests ar
        SET status = 'cancelled',
            cancelled_at = NOW(),
            updated_at = NOW()
      WHERE ar.property_id = $2
        AND ar.status IN ('new','pending_approval','escalated','approved')
        AND (
          ar.created_by_resident_id = $1
          OR ar.vehicle_id IN (SELECT id FROM resident_vehicles)
        )
      RETURNING ar.id, ar.request_type, ar.vehicle_id`,
    [resident.id, resident.property_id],
  );
  return rows;
}

async function markVehiclesForReview(queryable, resident, reason) {
  const { rows } = await queryable.query(
    `UPDATE vehicles
        SET is_whitelisted = false,
            review_required = true,
            offboarded_at = COALESCE(offboarded_at, NOW()),
            offboarding_reason = $2,
            updated_at = NOW()
      WHERE owner_resident_id = $1
      RETURNING id, plate_number, is_whitelisted, is_blacklisted, review_required`,
    [resident.id, reason],
  );
  return rows;
}

async function disableNotificationPreferences(queryable, resident, source = 'offboarding') {
  const { rows } = await queryable.query(
    `UPDATE resident_notification_preferences
        SET enabled = false,
            source = $2,
            updated_at = NOW()
      WHERE property_id = $3
        AND resident_id = $1
        AND enabled = true
      RETURNING id, channel, event_scope, enabled`,
    [resident.id, source, resident.property_id],
  );
  return rows;
}

async function writeOffboardingAudit(queryable, resident, actor, summary, reason) {
  await queryable.query(
    `INSERT INTO property_audit_log(
       property_id, actor_uid, actor_role, actor_type,
       action, resource_type, resource_id, entity_type, entity_id,
       changes, ip_address
     )
     VALUES ($1,$2,$3,'staff','resident.deactivated','resident',$4,'resident',$4,$5::jsonb,$6)`,
    [
      resident.property_id,
      actor?.uid || null,
      actor?.role || null,
      resident.id,
      JSON.stringify({ reason, offboarding: summary }),
      actor?.ipAddress || null,
    ],
  );
}

function buildSummary({
  memberships,
  passes,
  unitLinks,
  vehicles,
  accessRequests,
  notificationPreferences,
}) {
  return {
    suspended_memberships: memberships.length,
    revoked_passes: passes.length,
    deactivated_unit_links: unitLinks.length,
    vehicles_marked_for_review: vehicles.length,
    cancelled_access_requests: accessRequests.length,
    notification_preferences_disabled: notificationPreferences.length,
  };
}

async function offboardResident({ queryable, residentId, actor = {}, reason = null }) {
  const normalizedReason = normalizeReason(reason);
  const resident = await loadResident(queryable, residentId);
  const actorStaffId = await resolveActorStaffId(queryable, actor);

  const updatedResident = await deactivateResidentRow(queryable, resident.id);
  const memberships = await suspendMembershipsForSubject({
    queryable,
    subjectType: 'resident',
    subjectId: resident.id,
    reason: normalizedReason,
  });
  const unitLinks = await deactivateUnitLinks(queryable, resident.id, normalizedReason);
  const passes = await revokeResidentPasses(queryable, resident, actorStaffId, normalizedReason);
  const accessRequests = await cancelResidentAccessRequests(queryable, resident);
  const vehicles = await markVehiclesForReview(queryable, resident, normalizedReason);
  const notificationPreferences = await disableNotificationPreferences(queryable, resident, 'offboarding');
  const summary = buildSummary({
    memberships,
    passes,
    unitLinks,
    vehicles,
    accessRequests,
    notificationPreferences,
  });

  await recordResidentLifecycleEvent({
    queryable,
    propertyId: resident.property_id,
    residentId: resident.id,
    eventType: 'deactivated',
    actorUid: actor?.uid || null,
    actorRole: actor?.role || null,
    metadata: {
      reason: normalizedReason,
      was_active: resident.is_active,
      offboarding: {
        ...summary,
        membership_ids: ids(memberships),
        pass_ids: ids(passes),
        unit_link_ids: ids(unitLinks),
        vehicle_ids: ids(vehicles),
        access_request_ids: ids(accessRequests),
        notification_preference_ids: ids(notificationPreferences),
      },
    },
  });

  await writeOffboardingAudit(queryable, resident, actor, summary, normalizedReason);

  return {
    resident: updatedResident,
    summary,
    affected: {
      memberships,
      passes,
      unit_links: unitLinks,
      vehicles,
      access_requests: accessRequests,
      notification_preferences: notificationPreferences,
    },
  };
}

async function copyNotificationPreferencesForTransfer(queryable, {
  propertyId,
  fromResidentId,
  toResidentId,
}) {
  const { rows } = await queryable.query(
    `INSERT INTO resident_notification_preferences
       (property_id, resident_id, channel, event_scope, enabled, quiet_hours,
        source, inherited_from_resident_id, cascaded_at)
     SELECT property_id,
            $3,
            channel,
            event_scope,
            enabled,
            quiet_hours,
            'ownership_transfer',
            $2,
            NOW()
       FROM resident_notification_preferences
      WHERE property_id = $1
        AND resident_id = $2
     ON CONFLICT (property_id, resident_id, channel, event_scope)
     DO UPDATE SET
       enabled = EXCLUDED.enabled,
       quiet_hours = EXCLUDED.quiet_hours,
       source = 'ownership_transfer',
       inherited_from_resident_id = $2,
       cascaded_at = NOW(),
       updated_at = NOW()
     RETURNING id, channel, event_scope, enabled`,
    [propertyId, fromResidentId, toResidentId],
  );
  return rows;
}

async function activateTargetOwner(queryable, {
  targetResidentId,
  unitId,
}) {
  const { rows } = await queryable.query(
    `UPDATE residents
        SET unit_id = $2,
            resident_type = 'owner',
            is_active = true,
            updated_at = NOW()
      WHERE id = $1
      RETURNING id, property_id, unit_id, external_uid, is_active, resident_type`,
    [targetResidentId, unitId],
  );
  if (!rows[0]) throw serviceError(404, 'Target resident not found');
  return rows[0];
}

async function closeExistingOwnerLinks(queryable, {
  propertyId,
  unitId,
  targetResidentId,
  reason,
}) {
  const { rows } = await queryable.query(
    `UPDATE resident_unit_links
        SET is_active = false,
            ends_at = COALESCE(ends_at, NOW()),
            ended_reason = COALESCE(ended_reason, $4),
            updated_at = NOW()
      WHERE property_id = $1
        AND unit_id = $2
        AND resident_id <> $3
        AND relationship_type = 'owner'
        AND is_active = true
      RETURNING id, resident_id, unit_id`,
    [propertyId, unitId, targetResidentId, reason],
  );
  return rows;
}

async function upsertTargetOwnerLink(queryable, {
  propertyId,
  unitId,
  targetResidentId,
  effectiveAt,
}) {
  const { rows } = await queryable.query(
    `INSERT INTO resident_unit_links
       (property_id, resident_id, unit_id, relationship_type, is_primary,
        is_active, starts_at, ends_at, ended_reason)
     VALUES ($1,$2,$3,'owner',true,true,COALESCE($4::timestamptz, NOW()),NULL,NULL)
     ON CONFLICT (resident_id, unit_id) WHERE is_active = true
     DO UPDATE SET
       relationship_type = 'owner',
       is_primary = true,
       updated_at = NOW()
     RETURNING id, resident_id, unit_id, relationship_type, is_active`,
    [propertyId, targetResidentId, unitId, effectiveAt || null],
  );
  return rows;
}

async function insertOwnershipTransfer(queryable, {
  propertyId,
  unitId,
  fromResidentId,
  toResidentId,
  reason,
  effectiveAt,
  cascadePolicy,
  summary,
  actor,
}) {
  const { rows } = await queryable.query(
    `INSERT INTO resident_ownership_transfers
       (property_id, unit_id, from_resident_id, to_resident_id,
        transfer_reason, effective_at, cascade_policy, summary, actor_uid, actor_role)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6::timestamptz, NOW()),$7::jsonb,$8::jsonb,$9,$10)
     RETURNING *`,
    [
      propertyId,
      unitId,
      fromResidentId,
      toResidentId,
      reason,
      effectiveAt || null,
      JSON.stringify(cascadePolicy || {}),
      JSON.stringify(summary || {}),
      actor?.uid || null,
      actor?.role || null,
    ],
  );
  return rows[0];
}

async function writeOwnershipTransferAudit(queryable, transfer, actor, summary) {
  await queryable.query(
    `INSERT INTO property_audit_log(
       property_id, actor_uid, actor_role, actor_type,
       action, resource_type, resource_id, entity_type, entity_id,
       changes, ip_address
     )
     VALUES ($1,$2,$3,'staff','resident.ownership_transferred',
             'resident_ownership_transfer',$4,'unit',$5,$6::jsonb,$7)`,
    [
      transfer.property_id,
      actor?.uid || null,
      actor?.role || null,
      transfer.id,
      transfer.unit_id,
      JSON.stringify({
        transfer_id: transfer.id,
        from_resident_id: transfer.from_resident_id,
        to_resident_id: transfer.to_resident_id,
        reason: transfer.transfer_reason,
        summary,
      }),
      actor?.ipAddress || null,
    ],
  );
}

async function transferResidentOwnership({
  queryable,
  fromResidentId,
  toResidentId,
  actor = {},
  reason = 'ownership transfer',
  effectiveAt = null,
  cascadeNotificationPreferences = true,
}) {
  if (!toResidentId || fromResidentId === toResidentId) {
    throw serviceError(400, 'to_resident_id must be a different resident');
  }

  const normalizedReason = normalizeReason(reason);
  const fromResident = await loadResident(queryable, fromResidentId);
  const toResident = await loadTransferTarget(queryable, toResidentId);
  if (fromResident.property_id !== toResident.property_id) {
    throw serviceError(400, 'target resident must belong to the same property');
  }

  const copiedPreferences = cascadeNotificationPreferences
    ? await copyNotificationPreferencesForTransfer(queryable, {
      propertyId: fromResident.property_id,
      fromResidentId: fromResident.id,
      toResidentId: toResident.id,
    })
    : [];

  const offboarding = await offboardResident({
    queryable,
    residentId: fromResident.id,
    actor,
    reason: normalizedReason,
  });

  const targetResident = await activateTargetOwner(queryable, {
    targetResidentId: toResident.id,
    unitId: fromResident.unit_id,
  });
  const closedOwnerLinks = await closeExistingOwnerLinks(queryable, {
    propertyId: fromResident.property_id,
    unitId: fromResident.unit_id,
    targetResidentId: toResident.id,
    reason: normalizedReason,
  });
  const activatedOwnerLinks = await upsertTargetOwnerLink(queryable, {
    propertyId: fromResident.property_id,
    unitId: fromResident.unit_id,
    targetResidentId: toResident.id,
    effectiveAt,
  });

  const summary = {
    previous_owner_offboarding: offboarding.summary,
    previous_owner_links_closed: closedOwnerLinks.length,
    new_owner_links_activated: activatedOwnerLinks.length,
    notification_preferences_copied: copiedPreferences.length,
  };
  const transfer = await insertOwnershipTransfer(queryable, {
    propertyId: fromResident.property_id,
    unitId: fromResident.unit_id,
    fromResidentId: fromResident.id,
    toResidentId: toResident.id,
    reason: normalizedReason,
    effectiveAt,
    cascadePolicy: {
      offboard_previous_owner: true,
      cascade_notification_preferences: cascadeNotificationPreferences,
    },
    summary,
    actor,
  });

  await recordResidentLifecycleEvent({
    queryable,
    propertyId: fromResident.property_id,
    residentId: fromResident.id,
    eventType: 'ownership_transferred',
    actorUid: actor?.uid || null,
    actorRole: actor?.role || null,
    metadata: {
      transfer_id: transfer.id,
      direction: 'from',
      to_resident_id: toResident.id,
      unit_id: fromResident.unit_id,
      reason: normalizedReason,
      summary,
    },
  });
  await recordResidentLifecycleEvent({
    queryable,
    propertyId: fromResident.property_id,
    residentId: toResident.id,
    eventType: 'ownership_transferred',
    actorUid: actor?.uid || null,
    actorRole: actor?.role || null,
    metadata: {
      transfer_id: transfer.id,
      direction: 'to',
      from_resident_id: fromResident.id,
      unit_id: fromResident.unit_id,
      reason: normalizedReason,
      summary,
    },
  });
  if (copiedPreferences.length > 0) {
    await recordResidentLifecycleEvent({
      queryable,
      propertyId: fromResident.property_id,
      residentId: toResident.id,
      eventType: 'notification_preferences_cascaded',
      actorUid: actor?.uid || null,
      actorRole: actor?.role || null,
      metadata: {
        transfer_id: transfer.id,
        from_resident_id: fromResident.id,
        copied_preference_ids: ids(copiedPreferences),
      },
    });
  }
  await writeOwnershipTransferAudit(queryable, transfer, actor, summary);

  return {
    transfer,
    summary,
    from_resident: offboarding.resident,
    to_resident: targetResident,
    affected: {
      previous_owner_offboarding: offboarding.affected,
      copied_notification_preferences: copiedPreferences,
      closed_owner_links: closedOwnerLinks,
      activated_owner_links: activatedOwnerLinks,
    },
  };
}

async function getResidentOffboardingReport({ queryable, propertyId, limit = 25 }) {
  if (!propertyId) throw serviceError(400, 'property_id is required');
  const safeLimit = normalizeLimit(limit);
  const generatedAt = new Date().toISOString();

  const [summaryResult, lifecycleResult, vehicleResult] = await Promise.all([
    queryable.query(
      `SELECT
          COUNT(*) FILTER (WHERE event_type = 'deactivated')::int AS offboarded_residents,
          COUNT(*) FILTER (
            WHERE event_type = 'deactivated'
              AND created_at >= NOW() - INTERVAL '30 days'
          )::int AS offboarded_last_30d
         FROM resident_lifecycle_events
        WHERE property_id = $1`,
      [propertyId],
    ),
    queryable.query(
      `SELECT e.id,
              e.property_id,
              e.resident_id,
              e.actor_uid,
              e.actor_role,
              e.metadata,
              e.created_at,
              r.full_name,
              r.unit_id,
              r.is_active
         FROM resident_lifecycle_events e
         LEFT JOIN residents r ON r.id = e.resident_id
        WHERE e.property_id = $1
          AND e.event_type = 'deactivated'
        ORDER BY e.created_at DESC
        LIMIT $2`,
      [propertyId, safeLimit],
    ),
    queryable.query(
      `SELECT id,
              owner_resident_id,
              plate_number,
              is_whitelisted,
              is_blacklisted,
              review_required,
              offboarded_at,
              offboarding_reason,
              updated_at
         FROM vehicles
        WHERE property_id = $1
          AND review_required = true
        ORDER BY COALESCE(offboarded_at, updated_at) DESC
        LIMIT $2`,
      [propertyId, safeLimit],
    ),
  ]);

  const summaryRow = summaryResult.rows[0] || {};
  const recentOffboardings = lifecycleResult.rows.map((row) => {
    const metadata = parseJsonObject(row.metadata);
    return {
      id: row.id,
      property_id: row.property_id,
      resident_id: row.resident_id,
      resident_name: row.full_name || null,
      unit_id: row.unit_id || null,
      resident_active: row.is_active === true,
      actor_uid: row.actor_uid || null,
      actor_role: row.actor_role || null,
      reason: metadata.reason || null,
      summary: parseJsonObject(metadata.offboarding),
      created_at: row.created_at,
    };
  });

  return {
    property_id: propertyId,
    generated_at: generatedAt,
    summary: {
      offboarded_residents: toInt(summaryRow.offboarded_residents),
      offboarded_last_30d: toInt(summaryRow.offboarded_last_30d),
      vehicles_pending_review: vehicleResult.rows.length,
      recent_offboarding_rows: recentOffboardings.length,
    },
    recent_offboardings: recentOffboardings,
    vehicle_review_queue: vehicleResult.rows,
    evidence: {
      source_tables: [
        'resident_lifecycle_events',
        'resident_unit_links',
        'passes',
        'access_requests',
        'vehicles',
        'property_audit_log',
      ],
      report_scope: 'resident_offboarding',
      generated_at: generatedAt,
    },
  };
}

module.exports = {
  ResidentOffboardingServiceError,
  getResidentOffboardingReport,
  isResidentOffboardingServiceError,
  offboardResident,
  transferResidentOwnership,
};
