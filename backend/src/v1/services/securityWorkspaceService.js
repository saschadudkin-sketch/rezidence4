'use strict';

const { normalizePlate } = require('../lib/normalizePlate');

const DEFAULT_LIMITS = Object.freeze({
  activePasses: 25,
  expectedGuests: 25,
  recentEvents: 30,
  blacklistHits: 20,
  search: 10,
});

class SecurityWorkspaceServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'SecurityWorkspaceServiceError';
    this.status = status;
  }
}

function serviceError(status, message) {
  return new SecurityWorkspaceServiceError(status, message);
}

function isSecurityWorkspaceServiceError(err) {
  return err instanceof SecurityWorkspaceServiceError;
}

function limitOrDefault(value, fallback) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return fallback;
  return Math.min(n, 100);
}

async function loadStationContext(queryable, { propertyId, accessPointId = null }) {
  if (!accessPointId) {
    return { access_point: null, access_zone: null };
  }
  const { rows } = await queryable.query(
    `SELECT ap.id, ap.property_id, ap.zone_id, ap.name, ap.point_type,
            ap.provider, ap.provider_external_id,
            az.name AS zone_name, az.zone_type
       FROM access_points ap
       JOIN access_zones az
         ON az.id = ap.zone_id
        AND az.property_id = ap.property_id
      WHERE ap.id = $1
        AND ap.property_id = $2
        AND ap.is_active = true
      LIMIT 1`,
    [accessPointId, propertyId],
  );
  if (!rows[0]) throw serviceError(400, 'access_point_id does not exist for this property');
  return {
    access_point: {
      id: rows[0].id,
      property_id: rows[0].property_id,
      zone_id: rows[0].zone_id,
      name: rows[0].name,
      point_type: rows[0].point_type,
      provider: rows[0].provider,
      provider_external_id: rows[0].provider_external_id,
    },
    access_zone: {
      id: rows[0].zone_id,
      name: rows[0].zone_name,
      zone_type: rows[0].zone_type,
    },
  };
}

function scopedPassFilter(station, params) {
  if (!station?.access_point) return '';
  params.push(station.access_point.id);
  const pointIdx = params.length;
  params.push(station.access_zone?.id || station.access_point.zone_id);
  const zoneIdx = params.length;
  return ` AND (p.point_id IS NULL OR p.point_id = $${pointIdx})
           AND (p.zone_id IS NULL OR p.zone_id = $${zoneIdx})`;
}

function scopedRequestFilter(station, params) {
  if (!station?.access_point) return '';
  params.push(station.access_point.id);
  const pointIdx = params.length;
  params.push(station.access_zone?.id || station.access_point.zone_id);
  const zoneIdx = params.length;
  return ` AND (ar.target_point_id IS NULL OR ar.target_point_id = $${pointIdx})
           AND (ar.target_zone_id IS NULL OR ar.target_zone_id = $${zoneIdx})`;
}

async function listActivePasses(queryable, { propertyId, station, now, limit }) {
  const params = [propertyId, now.toISOString()];
  const scopeSql = scopedPassFilter(station, params);
  params.push(limit);
  const limitIdx = params.length;

  const { rows } = await queryable.query(
    `SELECT p.id, p.property_id, p.pass_type, p.subject_type,
            p.subject_resident_id, p.subject_staff_id,
            p.subject_contractor_user_id, p.subject_vehicle_id,
            p.zone_id, p.point_id, p.policy_id,
            p.valid_from, p.valid_until, p.status,
            v.plate_number, v.is_whitelisted, v.is_blacklisted,
            r.full_name AS resident_name, r.phone AS resident_phone,
            u.unit_number, u.unit_type
       FROM passes p
       LEFT JOIN vehicles v ON v.id = p.subject_vehicle_id
       LEFT JOIN residents r
         ON r.id = p.subject_resident_id
         OR r.id = v.owner_resident_id
       LEFT JOIN units u ON u.id = r.unit_id
      WHERE p.property_id = $1
        AND p.status = 'active'
        AND p.valid_from <= $2
        AND p.valid_until >= $2
        ${scopeSql}
      ORDER BY p.valid_until ASC, p.created_at DESC
      LIMIT $${limitIdx}`,
    params,
  );
  return rows;
}

async function listExpectedGuests(queryable, { propertyId, station, now, limit }) {
  const until = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const params = [propertyId, now.toISOString(), until];
  const scopeSql = scopedRequestFilter(station, params);
  params.push(limit);
  const limitIdx = params.length;

  const { rows } = await queryable.query(
    `SELECT ar.id, ar.property_id, ar.request_type, ar.visitor_name,
            ar.visitor_phone, ar.vehicle_id, ar.target_zone_id,
            ar.target_point_id, ar.target_unit_id, ar.reason,
            ar.starts_at, ar.ends_at, ar.status, ar.approval_required,
            v.plate_number, u.unit_number, u.unit_type,
            p.id AS pass_id, p.status AS pass_status
       FROM access_requests ar
       LEFT JOIN vehicles v ON v.id = ar.vehicle_id
       LEFT JOIN units u ON u.id = ar.target_unit_id
       LEFT JOIN passes p ON p.access_request_id = ar.id
      WHERE ar.property_id = $1
        AND ar.status IN ('approved','pending_approval','escalated')
        AND ar.ends_at >= $2
        AND ar.starts_at <= $3
        ${scopeSql}
      ORDER BY ar.starts_at ASC, ar.created_at DESC
      LIMIT $${limitIdx}`,
    params,
  );
  return rows;
}

async function listRecentEvents(queryable, { propertyId, accessPointId = null, limit, offset = 0 }) {
  const params = [propertyId];
  const filters = ['vl.property_id = $1'];
  if (accessPointId) {
    params.push(accessPointId);
    filters.push(`vl.access_point_id = $${params.length}`);
  }
  params.push(limit);
  const limitIdx = params.length;
  params.push(offset);
  const offsetIdx = params.length;

  const { rows } = await queryable.query(
    `SELECT vl.id, vl.property_id, vl.pass_id, vl.access_point_id,
            vl.event_type, vl.event_source, vl.person_label, vl.vehicle_plate,
            vl.performed_by_staff_id, vl.occurred_at, vl.created_at,
            ap.name AS access_point_name, az.name AS access_zone_name,
            ai.id AS incident_id, ai.incident_type, ai.severity, ai.status AS incident_status
       FROM visit_logs_v2 vl
       LEFT JOIN access_points ap
         ON ap.id = vl.access_point_id
        AND ap.property_id = vl.property_id
       LEFT JOIN access_zones az
         ON az.id = ap.zone_id
        AND az.property_id = ap.property_id
       LEFT JOIN access_incidents ai
         ON ai.related_visit_log_id = vl.id
      WHERE ${filters.join(' AND ')}
      ORDER BY vl.occurred_at DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params,
  );
  return rows;
}

async function listBlacklistHits(queryable, { propertyId, limit }) {
  const { rows } = await queryable.query(
    `SELECT ai.id, ai.property_id, ai.related_vehicle_id, ai.related_visit_log_id,
            ai.incident_type, ai.severity, ai.status, ai.title, ai.created_at,
            v.plate_number, v.owner_type, v.is_blacklisted
       FROM access_incidents ai
       LEFT JOIN vehicles v ON v.id = ai.related_vehicle_id
      WHERE ai.property_id = $1
        AND ai.incident_type IN ('blacklist_hit','policy_denied','policy_security_review_required')
        AND ai.status IN ('open','investigating')
      ORDER BY ai.created_at DESC
      LIMIT $2`,
    [propertyId, limit],
  );
  return rows;
}

async function getSecurityWorkspaceBootstrap({
  queryable,
  propertyId,
  accessPointId = null,
  now = new Date(),
  limits = {},
}) {
  const station = await loadStationContext(queryable, { propertyId, accessPointId });
  const [activePasses, expectedGuests, recentEvents, blacklistHits] = await Promise.all([
    listActivePasses(queryable, {
      propertyId,
      station,
      now,
      limit: limitOrDefault(limits.activePasses, DEFAULT_LIMITS.activePasses),
    }),
    listExpectedGuests(queryable, {
      propertyId,
      station,
      now,
      limit: limitOrDefault(limits.expectedGuests, DEFAULT_LIMITS.expectedGuests),
    }),
    listRecentEvents(queryable, {
      propertyId,
      accessPointId,
      limit: limitOrDefault(limits.recentEvents, DEFAULT_LIMITS.recentEvents),
      offset: 0,
    }),
    listBlacklistHits(queryable, {
      propertyId,
      limit: limitOrDefault(limits.blacklistHits, DEFAULT_LIMITS.blacklistHits),
    }),
  ]);

  return {
    property_id: propertyId,
    generated_at: now.toISOString(),
    station_context: station,
    active_passes: activePasses,
    expected_guests: expectedGuests,
    recent_events: recentEvents,
    blacklist_hits: blacklistHits,
  };
}

async function searchSecurityWorkspace({
  queryable,
  propertyId,
  q,
  limit = DEFAULT_LIMITS.search,
}) {
  const term = typeof q === 'string' ? q.trim() : '';
  if (term.length < 2) throw serviceError(400, 'q must be at least 2 characters');
  const normalizedPlate = normalizePlate(term);
  const like = `%${term}%`;
  const normalizedLike = normalizedPlate ? `%${normalizedPlate}%` : null;
  const boundedLimit = limitOrDefault(limit, DEFAULT_LIMITS.search);

  const [vehicles, residents, units, passes] = await Promise.all([
    queryable.query(
      `SELECT id, property_id, owner_type, owner_resident_id, owner_staff_id,
              owner_contractor_user_id, plate_number, vehicle_type, color,
              brand, model, is_whitelisted, is_blacklisted, notes
         FROM vehicles
        WHERE property_id = $1
          AND (
            plate_number ILIKE $2
            OR ($3::text IS NOT NULL AND plate_number ILIKE $3)
            OR brand ILIKE $2
            OR model ILIKE $2
          )
        ORDER BY is_blacklisted DESC, is_whitelisted DESC, plate_number ASC
        LIMIT $4`,
      [propertyId, like, normalizedLike, boundedLimit],
    ),
    queryable.query(
      `SELECT r.id, r.property_id, r.unit_id, r.full_name, r.phone, r.email,
              r.role, r.resident_type, r.is_active,
              u.unit_number, u.unit_type
         FROM residents r
         JOIN units u ON u.id = r.unit_id
        WHERE r.property_id = $1
          AND r.is_active = true
          AND (r.full_name ILIKE $2 OR r.phone ILIKE $2 OR r.email ILIKE $2)
        ORDER BY r.full_name ASC
        LIMIT $3`,
      [propertyId, like, boundedLimit],
    ),
    queryable.query(
      `SELECT id, property_id, building_id, entrance_id, unit_number, unit_type,
              floor, is_active
         FROM units
        WHERE property_id = $1
          AND is_active = true
          AND unit_number ILIKE $2
        ORDER BY unit_number ASC
        LIMIT $3`,
      [propertyId, like, boundedLimit],
    ),
    queryable.query(
      `SELECT p.id, p.property_id, p.pass_type, p.subject_type,
              p.subject_resident_id, p.subject_vehicle_id, p.zone_id,
              p.point_id, p.valid_from, p.valid_until, p.status,
              v.plate_number, r.full_name AS resident_name, u.unit_number
         FROM passes p
         LEFT JOIN vehicles v ON v.id = p.subject_vehicle_id
         LEFT JOIN residents r
           ON r.id = p.subject_resident_id
           OR r.id = v.owner_resident_id
         LEFT JOIN units u ON u.id = r.unit_id
        WHERE p.property_id = $1
          AND (
            p.id::text = $2
            OR v.plate_number ILIKE $3
            OR r.full_name ILIKE $4
            OR u.unit_number ILIKE $4
          )
        ORDER BY p.created_at DESC
        LIMIT $5`,
      [propertyId, term, normalizedLike || like, like, boundedLimit],
    ),
  ]);

  return {
    query: term,
    normalized_plate: normalizedPlate || null,
    vehicles: vehicles.rows,
    residents: residents.rows,
    units: units.rows,
    passes: passes.rows,
  };
}

module.exports = {
  DEFAULT_LIMITS,
  SecurityWorkspaceServiceError,
  getSecurityWorkspaceBootstrap,
  isSecurityWorkspaceServiceError,
  limitOrDefault,
  listRecentEvents,
  searchSecurityWorkspace,
};
