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

function buildSummary({ memberships, passes, unitLinks, vehicles, accessRequests }) {
  return {
    suspended_memberships: memberships.length,
    revoked_passes: passes.length,
    deactivated_unit_links: unitLinks.length,
    vehicles_marked_for_review: vehicles.length,
    cancelled_access_requests: accessRequests.length,
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
  const summary = buildSummary({ memberships, passes, unitLinks, vehicles, accessRequests });

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
    },
  };
}

module.exports = {
  ResidentOffboardingServiceError,
  isResidentOffboardingServiceError,
  offboardResident,
};
