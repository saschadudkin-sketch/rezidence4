'use strict';

const { PASS_COLS } = require('./passService');

const PASS_LIST_COLS = PASS_COLS
  .split(',')
  .map((col) => col.trim())
  .filter(Boolean)
  .map((col) => `p.${col}`)
  .join(',\n         ');

function likeSearchTerm(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  return `%${trimmed}%`;
}

async function listPassesForAdmin({ queryable, propertyId, filters = {}, pagination }) {
  const where = ['p.property_id = $1'];
  const params = [propertyId];

  if (filters.status) {
    params.push(filters.status);
    where.push(`p.status = $${params.length}`);
  }
  if (filters.pass_type) {
    params.push(filters.pass_type);
    where.push(`p.pass_type = $${params.length}`);
  }
  if (filters.subject_vehicle_id) {
    params.push(filters.subject_vehicle_id);
    where.push(`p.subject_vehicle_id = $${params.length}`);
  }
  if (filters.subject_resident_id) {
    params.push(filters.subject_resident_id);
    where.push(`p.subject_resident_id = $${params.length}`);
  }
  if (filters.access_request_id) {
    params.push(filters.access_request_id);
    where.push(`p.access_request_id = $${params.length}`);
  }

  const searchTerm = likeSearchTerm(filters.q);
  if (searchTerm) {
    params.push(searchTerm);
    const idx = params.length;
    where.push(`(
      p.id::text ILIKE $${idx}
      OR ar.visitor_name ILIKE $${idx}
      OR r.full_name ILIKE $${idx}
      OR u.unit_number ILIKE $${idx}
      OR v.plate_number ILIKE $${idx}
    )`);
  }

  params.push(pagination.limit);
  const limitIdx = params.length;
  params.push(pagination.offset);
  const offsetIdx = params.length;

  const { rows } = await queryable.query(
    `SELECT ${PASS_LIST_COLS},
            ar.request_type,
            ar.visitor_name,
            ar.guest_instructions,
            ar.guard_notes,
            u.unit_number,
            u.unit_type,
            r.full_name AS resident_name,
            v.plate_number AS vehicle_plate,
            ap.name AS access_point_name,
            az.name AS access_zone_name,
            COALESCE(cred.credential_types, ARRAY[]::text[]) AS credential_types
       FROM passes p
       LEFT JOIN access_requests ar
              ON ar.id = p.access_request_id
             AND ar.property_id = p.property_id
       LEFT JOIN units u
              ON u.id = ar.target_unit_id
             AND u.property_id = p.property_id
       LEFT JOIN residents r
              ON r.id = COALESCE(p.subject_resident_id, ar.created_by_resident_id)
             AND r.property_id = p.property_id
       LEFT JOIN vehicles v
              ON v.id = p.subject_vehicle_id
             AND v.property_id = p.property_id
       LEFT JOIN access_points ap
              ON ap.id = COALESCE(p.point_id, ar.target_point_id)
             AND ap.property_id = p.property_id
       LEFT JOIN access_zones az
              ON az.id = COALESCE(p.zone_id, ar.target_zone_id, ap.zone_id)
             AND az.property_id = p.property_id
       LEFT JOIN LATERAL (
         SELECT ARRAY_AGG(DISTINCT pc.credential_type ORDER BY pc.credential_type) AS credential_types
           FROM pass_credentials pc
          WHERE pc.pass_id = p.id
            AND pc.property_id = p.property_id
            AND pc.revoked_at IS NULL
       ) cred ON true
      WHERE ${where.join(' AND ')}
      ORDER BY p.created_at DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params,
  );

  return rows;
}

module.exports = {
  listPassesForAdmin,
};
