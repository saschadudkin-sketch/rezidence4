'use strict';

const { normalizePlate } = require('../lib/normalizePlate');
const { resolveStaffIdByUid } = require('./accessActorResolver');
const { verifyPass } = require('./verifyPass');

const VL_COLS = `
  id, property_id, pass_id, access_point_id, event_type, event_source,
  person_label, vehicle_plate, performed_by_staff_id,
  provider_event_id, provider_payload, occurred_at, created_at
`;

class VisitServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'VisitServiceError';
    this.status = status;
  }
}

function serviceError(status, message) {
  return new VisitServiceError(status, message);
}

function isVisitServiceError(err) {
  return err instanceof VisitServiceError;
}

async function requireStaffId(queryable, user) {
  const staffId = await resolveStaffIdByUid(queryable, user?.uid);
  if (!staffId) throw serviceError(403, 'Staff identity is not mapped to v1');
  return staffId;
}

async function validateVisitReferences(queryable, input) {
  if (!input.property_id) throw serviceError(400, 'property_id is required');
  if (input.pass_id) {
    const { rows } = await queryable.query(
      `SELECT id FROM passes WHERE id = $1 AND property_id = $2 LIMIT 1`,
      [input.pass_id, input.property_id],
    );
    if (!rows[0]) throw serviceError(400, 'pass_id does not exist for this property');
  }
  if (input.access_point_id) {
    const { rows } = await queryable.query(
      `SELECT id
         FROM access_points
        WHERE id = $1
          AND property_id = $2
          AND is_active = true
        LIMIT 1`,
      [input.access_point_id, input.property_id],
    );
    if (!rows[0]) throw serviceError(400, 'access_point_id does not exist for this property');
  }
}

async function verifyVisit({ queryable, verifyDb, user, input }) {
  const staffId = await requireStaffId(queryable, user);
  const result = await verifyPass({
    db: verifyDb || null,
    property_id: input.property_id,
    mode: input.mode,
    token: input.token,
    pin: input.pin,
    plate: input.plate,
    access_point_id: input.access_point_id,
    direction: input.direction,
    performed_by_staff_id: staffId,
    occurred_at: input.occurred_at,
  });

  let passInfo = null;
  if (result.pass_id) {
    const { rows } = await queryable.query(
      `SELECT id, pass_type, status, valid_from, valid_until
         FROM passes
        WHERE id = $1
          AND property_id = $2`,
      [result.pass_id, input.property_id],
    );
    if (rows[0]) passInfo = rows[0];
  }

  return { result, pass: passInfo };
}

async function createVisitLog({ queryable, user, input }) {
  const normalizedPlate = input.vehicle_plate ? normalizePlate(input.vehicle_plate) : null;
  const occurredAtIso = input.occurred_at || new Date().toISOString();
  const staffId = await requireStaffId(queryable, user);
  await validateVisitReferences(queryable, input);

  const { rows } = await queryable.query(
    `INSERT INTO visit_logs_v2
       (property_id, pass_id, access_point_id, event_type, event_source,
        person_label, vehicle_plate, performed_by_staff_id,
        provider_event_id, provider_payload, occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING ${VL_COLS}`,
    [
      input.property_id,
      input.pass_id,
      input.access_point_id || null,
      input.event_type,
      input.event_source,
      input.person_label,
      normalizedPlate,
      staffId,
      input.provider_event_id,
      input.provider_payload ? JSON.stringify(input.provider_payload) : null,
      occurredAtIso,
    ],
  );
  return { visit_log: rows[0] };
}

module.exports = {
  VL_COLS,
  VisitServiceError,
  createVisitLog,
  isVisitServiceError,
  requireStaffId,
  verifyVisit,
};
