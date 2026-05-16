'use strict';

const { createAccessRequest, AR_COLS } = require('./accessRequestService');
const { validateAccessTopologyTarget } = require('./accessTopologyService');

const TRUSTED_VISITOR_COLS = `
  id, property_id, resident_id, name, phone, visitor_type,
  default_vehicle_plate, default_instructions,
  allowed_zone_id, allowed_point_id, is_active,
  last_used_at, created_at, updated_at
`;

const VISITOR_TYPES = new Set([
  'guest',
  'relative',
  'cleaner',
  'courier',
  'service',
  'caregiver',
  'other',
]);

const REQUEST_TYPES = new Set([
  'guest_access',
  'vehicle_access',
  'contractor_access',
  'courier_access',
  'service_access',
  'temporary_resident_access',
]);

const SHARE_CHANNELS = new Set(['link', 'qr', 'sms', 'telegram', 'email']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class TrustedVisitorServiceError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.name = 'TrustedVisitorServiceError';
    this.status = status;
    this.details = details;
  }
}

function serviceError(status, message, details = null) {
  return new TrustedVisitorServiceError(status, message, details);
}

function isTrustedVisitorServiceError(err) {
  return err instanceof TrustedVisitorServiceError;
}

function normalizeOptionalText(value, field, maxLength) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw serviceError(400, `${field} must be string or null`);
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) throw serviceError(400, `${field} is too long`);
  return trimmed;
}

function normalizeRequiredText(value, field, maxLength) {
  if (typeof value !== 'string') throw serviceError(400, `${field} is required`);
  const trimmed = value.trim();
  if (!trimmed) throw serviceError(400, `${field} is required`);
  if (trimmed.length > maxLength) throw serviceError(400, `${field} is too long`);
  return trimmed;
}

function normalizeOptionalUuid(value, field) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw serviceError(400, `${field} must be UUID or null`);
  }
  return value;
}

function normalizeRequiredUuid(value, field) {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw serviceError(400, `${field} must be UUID`);
  }
  return value;
}

function normalizeShareDeliveryChannels(value) {
  if (value === undefined || value === null) return ['link', 'qr'];
  if (!Array.isArray(value) || value.length > 5) {
    throw serviceError(400, 'share_delivery_channels must be an array');
  }
  const channels = [];
  for (const channel of value) {
    if (typeof channel !== 'string' || !SHARE_CHANNELS.has(channel)) {
      throw serviceError(400, 'share_delivery_channels contains unsupported channel');
    }
    if (!channels.includes(channel)) channels.push(channel);
  }
  return channels.length ? channels : ['link', 'qr'];
}

function normalizeVisitorType(value) {
  const visitorType = value === undefined || value === null || value === ''
    ? 'guest'
    : String(value);
  if (!VISITOR_TYPES.has(visitorType)) throw serviceError(400, 'Invalid visitor_type');
  return visitorType;
}

function normalizeRequestType(value, visitorType) {
  if (value !== undefined && value !== null && value !== '') {
    if (!REQUEST_TYPES.has(value)) throw serviceError(400, 'Invalid request_type');
    if (value === 'vehicle_access') {
      throw serviceError(422, 'vehicle_access from trusted visitor requires the vehicle flow');
    }
    return value;
  }
  if (visitorType === 'courier') return 'courier_access';
  if (visitorType === 'cleaner' || visitorType === 'service' || visitorType === 'caregiver') {
    return 'service_access';
  }
  return 'guest_access';
}

function normalizeTrustedVisitorInput(input, { partial = false } = {}) {
  const out = {};
  if (!partial || Object.prototype.hasOwnProperty.call(input, 'name')) {
    out.name = normalizeRequiredText(input.name, 'name', 200);
  }
  if (!partial || Object.prototype.hasOwnProperty.call(input, 'phone')) {
    out.phone = normalizeOptionalText(input.phone, 'phone', 40);
  }
  if (!partial || Object.prototype.hasOwnProperty.call(input, 'visitor_type')) {
    out.visitor_type = normalizeVisitorType(input.visitor_type);
  }
  if (!partial || Object.prototype.hasOwnProperty.call(input, 'default_vehicle_plate')) {
    out.default_vehicle_plate = normalizeOptionalText(input.default_vehicle_plate, 'default_vehicle_plate', 32);
  }
  if (!partial || Object.prototype.hasOwnProperty.call(input, 'default_instructions')) {
    out.default_instructions = normalizeOptionalText(input.default_instructions, 'default_instructions', 1000);
  }
  if (!partial || Object.prototype.hasOwnProperty.call(input, 'allowed_zone_id')) {
    out.allowed_zone_id = normalizeOptionalUuid(input.allowed_zone_id, 'allowed_zone_id');
  }
  if (!partial || Object.prototype.hasOwnProperty.call(input, 'allowed_point_id')) {
    out.allowed_point_id = normalizeOptionalUuid(input.allowed_point_id, 'allowed_point_id');
  }
  return out;
}

async function validateResidentUnit(queryable, { propertyId, residentId, unitId }) {
  if (!unitId) throw serviceError(400, 'target_unit_id is required');
  const { rows } = await queryable.query(
    `SELECT 1
       FROM residents
      WHERE id = $1
        AND property_id = $2
        AND unit_id = $3
        AND is_active = true
     UNION
     SELECT 1
       FROM resident_unit_links
      WHERE resident_id = $1
        AND property_id = $2
        AND unit_id = $3
        AND is_active = true
        AND (starts_at IS NULL OR starts_at <= NOW())
        AND (ends_at IS NULL OR ends_at > NOW())
      LIMIT 1`,
    [residentId, propertyId, unitId],
  );
  if (!rows[0]) throw serviceError(403, 'target_unit_id does not belong to resident');
}

async function listTrustedVisitors(queryable, { propertyId, residentId, includeInactive = false }) {
  const params = [propertyId, residentId];
  const activeSql = includeInactive ? '' : 'AND is_active = true';
  const { rows } = await queryable.query(
    `SELECT ${TRUSTED_VISITOR_COLS}
       FROM trusted_visitors
      WHERE property_id = $1
        AND resident_id = $2
        ${activeSql}
      ORDER BY is_active DESC, COALESCE(last_used_at, updated_at, created_at) DESC`,
    params,
  );
  return rows;
}

async function createTrustedVisitor(queryable, { propertyId, residentId, input }) {
  const normalized = normalizeTrustedVisitorInput(input);
  await validateAccessTopologyTarget(queryable, {
    propertyId,
    zoneId: normalized.allowed_zone_id,
    pointId: normalized.allowed_point_id,
    zoneField: 'allowed_zone_id',
    pointField: 'allowed_point_id',
  });
  const { rows } = await queryable.query(
    `INSERT INTO trusted_visitors
       (property_id, resident_id, name, phone, visitor_type,
        default_vehicle_plate, default_instructions,
        allowed_zone_id, allowed_point_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING ${TRUSTED_VISITOR_COLS}`,
    [
      propertyId,
      residentId,
      normalized.name,
      normalized.phone,
      normalized.visitor_type,
      normalized.default_vehicle_plate,
      normalized.default_instructions,
      normalized.allowed_zone_id,
      normalized.allowed_point_id,
    ],
  );
  return rows[0];
}

async function loadTrustedVisitorForResident(queryable, { id, propertyId, residentId, requireActive = false }) {
  const { rows } = await queryable.query(
    `SELECT ${TRUSTED_VISITOR_COLS}
       FROM trusted_visitors
      WHERE id = $1
        AND property_id = $2
        AND resident_id = $3
      LIMIT 1`,
    [id, propertyId, residentId],
  );
  const visitor = rows[0];
  if (!visitor) throw serviceError(404, 'Trusted visitor not found');
  if (requireActive && !visitor.is_active) {
    throw serviceError(409, 'Trusted visitor is deactivated');
  }
  return visitor;
}

async function updateTrustedVisitor(queryable, { id, propertyId, residentId, input }) {
  await loadTrustedVisitorForResident(queryable, { id, propertyId, residentId });
  const normalized = normalizeTrustedVisitorInput(input, { partial: true });
  if (normalized.allowed_zone_id || normalized.allowed_point_id) {
    await validateAccessTopologyTarget(queryable, {
      propertyId,
      zoneId: normalized.allowed_zone_id || null,
      pointId: normalized.allowed_point_id || null,
      zoneField: 'allowed_zone_id',
      pointField: 'allowed_point_id',
    });
  }
  const allowed = [
    'name',
    'phone',
    'visitor_type',
    'default_vehicle_plate',
    'default_instructions',
    'allowed_zone_id',
    'allowed_point_id',
  ];
  const sets = [];
  const params = [];
  for (const field of allowed) {
    if (!Object.prototype.hasOwnProperty.call(normalized, field)) continue;
    params.push(normalized[field]);
    sets.push(`${field} = $${params.length}`);
  }
  if (!sets.length) {
    return loadTrustedVisitorForResident(queryable, { id, propertyId, residentId });
  }
  params.push(id, propertyId, residentId);
  const { rows } = await queryable.query(
    `UPDATE trusted_visitors
        SET ${sets.join(', ')}, updated_at = NOW()
      WHERE id = $${params.length - 2}
        AND property_id = $${params.length - 1}
        AND resident_id = $${params.length}
      RETURNING ${TRUSTED_VISITOR_COLS}`,
    params,
  );
  return rows[0];
}

async function deactivateTrustedVisitor(queryable, { id, propertyId, residentId }) {
  const { rows } = await queryable.query(
    `UPDATE trusted_visitors
        SET is_active = false, updated_at = NOW()
      WHERE id = $1
        AND property_id = $2
        AND resident_id = $3
      RETURNING ${TRUSTED_VISITOR_COLS}`,
    [id, propertyId, residentId],
  );
  if (!rows[0]) throw serviceError(404, 'Trusted visitor not found');
  return rows[0];
}

async function createPassFromTrustedVisitor({
  queryable,
  txPool,
  property,
  user,
  id,
  propertyId,
  residentId,
  input,
}) {
  const visitor = await loadTrustedVisitorForResident(queryable, {
    id,
    propertyId,
    residentId,
    requireActive: true,
  });
  const targetUnitId = normalizeRequiredUuid(input.target_unit_id, 'target_unit_id');
  await validateResidentUnit(queryable, { propertyId, residentId, unitId: targetUnitId });

  const targetZoneId = Object.prototype.hasOwnProperty.call(input, 'target_zone_id')
    ? normalizeOptionalUuid(input.target_zone_id, 'target_zone_id')
    : visitor.allowed_zone_id || null;
  const targetPointId = Object.prototype.hasOwnProperty.call(input, 'target_point_id')
    ? normalizeOptionalUuid(input.target_point_id, 'target_point_id')
    : visitor.allowed_point_id || null;
  await validateAccessTopologyTarget(queryable, {
    propertyId,
    zoneId: targetZoneId,
    pointId: targetPointId,
    zoneField: 'target_zone_id',
    pointField: 'target_point_id',
  });

  const requestType = normalizeRequestType(input.request_type, visitor.visitor_type);
  const guestInstructions = Object.prototype.hasOwnProperty.call(input, 'guest_instructions')
    ? normalizeOptionalText(input.guest_instructions, 'guest_instructions', 1000)
    : visitor.default_instructions;
  const guardNotes = normalizeOptionalText(input.guard_notes, 'guard_notes', 1000);
  const reason = normalizeOptionalText(input.reason, 'reason', 1000);
  const shareDeliveryChannels = normalizeShareDeliveryChannels(input.share_delivery_channels);

  const startsAt = input.starts_at;
  const endsAt = input.ends_at;
  if (typeof startsAt !== 'string' || Number.isNaN(Date.parse(startsAt))) {
    throw serviceError(400, 'starts_at must be an ISO-8601 string');
  }
  if (typeof endsAt !== 'string' || Number.isNaN(Date.parse(endsAt))) {
    throw serviceError(400, 'ends_at must be an ISO-8601 string');
  }
  if (new Date(endsAt) <= new Date(startsAt)) {
    throw serviceError(400, 'ends_at must be after starts_at');
  }

  const result = await createAccessRequest({
    queryable,
    txPool,
    property,
    user,
    input: {
      property_id: propertyId,
      request_type: requestType,
      visitor_name: visitor.name,
      visitor_phone: visitor.phone,
      vehicle_id: null,
      target_unit_id: targetUnitId,
      target_zone_id: targetZoneId,
      target_point_id: targetPointId,
      request_id: input.request_id || null,
      reason,
      guest_instructions: guestInstructions,
      guard_notes: guardNotes,
      share_delivery_channels: shareDeliveryChannels,
      starts_at: startsAt,
      ends_at: endsAt,
    },
  });

  const updated = await queryable.query(
    `UPDATE access_requests
        SET trusted_visitor_id = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING ${AR_COLS}`,
    [visitor.id, result.access_request.id],
  );
  result.access_request = updated.rows[0] || {
    ...result.access_request,
    trusted_visitor_id: visitor.id,
  };

  const visitorUpdate = await queryable.query(
    `UPDATE trusted_visitors
        SET last_used_at = NOW(), updated_at = NOW()
      WHERE id = $1
      RETURNING ${TRUSTED_VISITOR_COLS}`,
    [visitor.id],
  );

  return {
    trusted_visitor: visitorUpdate.rows[0] || visitor,
    access_request: result.access_request,
    pass: result.pass,
  };
}

module.exports = {
  TRUSTED_VISITOR_COLS,
  TrustedVisitorServiceError,
  createPassFromTrustedVisitor,
  createTrustedVisitor,
  deactivateTrustedVisitor,
  isTrustedVisitorServiceError,
  listTrustedVisitors,
  normalizeTrustedVisitorInput,
  updateTrustedVisitor,
};
