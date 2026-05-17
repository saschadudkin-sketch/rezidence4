'use strict';

const { resolveResidentIdByUid } = require('./accessActorResolver');

const VEHICLE_COLS = `
  id, property_id, owner_type, owner_resident_id, owner_staff_id, owner_contractor_user_id,
  plate_number, vehicle_type, color, brand, model,
  is_whitelisted, is_blacklisted, review_required, offboarded_at, offboarding_reason,
  notes, created_at, updated_at
`;

class VehicleServiceError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.name = 'VehicleServiceError';
    this.status = status;
    this.details = details;
  }
}

function serviceError(status, message, details = null) {
  return new VehicleServiceError(status, message, details);
}

function isVehicleServiceError(err) {
  return err instanceof VehicleServiceError;
}

async function requireResidentId(queryable, user) {
  const residentId = await resolveResidentIdByUid(queryable, user?.uid);
  if (!residentId) throw serviceError(403, 'Resident identity is not mapped to v1');
  return residentId;
}

async function assertVehicleOwnerAccess({ queryable, user, isPropertyAdmin, vehicleId, propertyId = null }) {
  const params = [vehicleId];
  const propertyPredicate = propertyId ? ' AND property_id = $2' : '';
  if (propertyId) params.push(propertyId);
  const { rows } = await queryable.query(
    `SELECT property_id, owner_resident_id FROM vehicles WHERE id = $1${propertyPredicate}`,
    params,
  );
  if (!rows[0]) throw serviceError(404, 'Vehicle not found');
  if (isPropertyAdmin) return rows[0];

  const residentId = await requireResidentId(queryable, user);
  if (rows[0].owner_resident_id !== residentId) {
    throw serviceError(403, 'Forbidden');
  }
  return rows[0];
}

async function createVehicle({ queryable, user, isPropertyAdmin, input }) {
  if (!isPropertyAdmin && input.owner_type !== 'resident') {
    throw serviceError(403, 'Only property_admin may create non-resident vehicles');
  }
  if (!isPropertyAdmin && input.owner_type === 'resident') {
    const residentId = await requireResidentId(queryable, user);
    if (residentId !== input.owner_resident_id) {
      throw serviceError(403, 'Residents may register only their own vehicle');
    }
  }

  const { rows } = await queryable.query(
    `INSERT INTO vehicles
       (property_id, owner_type, owner_resident_id, owner_staff_id, owner_contractor_user_id,
        plate_number, vehicle_type, color, brand, model, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING ${VEHICLE_COLS}`,
    [
      input.property_id, input.owner_type,
      input.owner_resident_id, input.owner_staff_id, input.owner_contractor_user_id,
      input.plate_number, input.vehicle_type, input.color, input.brand, input.model, input.notes,
    ],
  );
  return { vehicle: rows[0] };
}

async function updateVehicle({ queryable, user, isPropertyAdmin, vehicleId, changes, propertyId = null }) {
  const vehicle = await assertVehicleOwnerAccess({ queryable, user, isPropertyAdmin, vehicleId, propertyId });

  const sets = [];
  const params = [];
  for (const [key, value] of Object.entries(changes)) {
    params.push(value);
    sets.push(`${key} = $${params.length}`);
  }
  if (!sets.length) throw serviceError(400, 'No updatable fields provided');

  sets.push('updated_at = NOW()');
  params.push(vehicleId);
  const idIdx = params.length;
  params.push(vehicle.property_id);
  const { rows } = await queryable.query(
    `UPDATE vehicles
        SET ${sets.join(', ')}
      WHERE id = $${idIdx} AND property_id = $${params.length}
      RETURNING ${VEHICLE_COLS}`,
    params,
  );
  if (!rows[0]) throw serviceError(404, 'Vehicle not found');
  return { vehicle: rows[0] };
}

async function setVehicleFlags({ queryable, vehicleId, whitelist, blacklist, propertyId = null }) {
  const params = [vehicleId, whitelist, blacklist];
  const propertyPredicate = propertyId ? ' AND property_id = $4' : '';
  if (propertyId) params.push(propertyId);
  const { rows } = await queryable.query(
    `UPDATE vehicles
        SET is_whitelisted = $2,
            is_blacklisted = $3,
            updated_at = NOW()
      WHERE id = $1${propertyPredicate}
      RETURNING ${VEHICLE_COLS}`,
    params,
  );
  if (!rows[0]) throw serviceError(404, 'Vehicle not found');
  const eventType = blacklist
    ? 'access.vehicle.blacklisted'
    : whitelist
      ? 'access.vehicle.whitelisted'
      : 'access.vehicle.flags_cleared';
  await queryable.query(
    `INSERT INTO notifications_outbox
       (property_id, event_type, channel, recipient_type, payload, correlation_id)
     VALUES ($1, $2, 'webhook', 'external', $3, $4)`,
    [
      rows[0].property_id,
      eventType,
      JSON.stringify({
        vehicle_id: vehicleId,
        is_whitelisted: rows[0].is_whitelisted,
        is_blacklisted: rows[0].is_blacklisted,
      }),
      vehicleId,
    ],
  );
  return { vehicle: rows[0] };
}

async function whitelistVehicle({ queryable, vehicleId, propertyId = null }) {
  return setVehicleFlags({ queryable, vehicleId, propertyId, whitelist: true, blacklist: false });
}

async function blacklistVehicle({ queryable, vehicleId, propertyId = null }) {
  return setVehicleFlags({ queryable, vehicleId, propertyId, whitelist: false, blacklist: true });
}

async function clearVehicleFlags({ queryable, vehicleId, propertyId = null }) {
  return setVehicleFlags({ queryable, vehicleId, propertyId, whitelist: false, blacklist: false });
}

async function deleteVehicle({ queryable, user, isPropertyAdmin, vehicleId, propertyId = null }) {
  const vehicle = await assertVehicleOwnerAccess({ queryable, user, isPropertyAdmin, vehicleId, propertyId });

  const { rows: histRows } = await queryable.query(
    `SELECT
       (SELECT COUNT(*)::int
          FROM passes
         WHERE subject_vehicle_id = $1 AND property_id = $2) AS passes_count,
       (SELECT COUNT(*)::int
          FROM access_requests
         WHERE vehicle_id = $1 AND property_id = $2) AS requests_count`,
    [vehicleId, vehicle.property_id],
  );
  if (histRows[0].passes_count > 0 || histRows[0].requests_count > 0) {
    throw serviceError(409, 'Cannot delete: vehicle has history', {
      passes: histRows[0].passes_count,
      access_requests: histRows[0].requests_count,
    });
  }

  await queryable.query(
    `DELETE FROM vehicles WHERE id = $1 AND property_id = $2`,
    [vehicleId, vehicle.property_id],
  );
  return { ok: true };
}

module.exports = {
  VEHICLE_COLS,
  VehicleServiceError,
  blacklistVehicle,
  clearVehicleFlags,
  createVehicle,
  deleteVehicle,
  isVehicleServiceError,
  updateVehicle,
  whitelistVehicle,
};
