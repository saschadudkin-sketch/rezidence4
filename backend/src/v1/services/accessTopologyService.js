'use strict';

class AccessTopologyServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'AccessTopologyServiceError';
    this.status = status;
  }
}

function serviceError(status, message) {
  return new AccessTopologyServiceError(status, message);
}

function isAccessTopologyServiceError(err) {
  return err instanceof AccessTopologyServiceError;
}

async function validateAccessTopologyTarget(
  queryable,
  {
    propertyId,
    zoneId = null,
    pointId = null,
    zoneField = 'zone_id',
    pointField = 'point_id',
  },
) {
  let zone = null;
  let point = null;

  if (zoneId) {
    const { rows } = await queryable.query(
      `SELECT id
         FROM access_zones
        WHERE id = $1
          AND property_id = $2
          AND is_active = true
        LIMIT 1`,
      [zoneId, propertyId],
    );
    if (!rows[0]) throw serviceError(400, `${zoneField} does not exist for this property`);
    zone = rows[0];
  }

  if (pointId) {
    const { rows } = await queryable.query(
      `SELECT id, zone_id
         FROM access_points
        WHERE id = $1
          AND property_id = $2
          AND is_active = true
        LIMIT 1`,
      [pointId, propertyId],
    );
    if (!rows[0]) throw serviceError(400, `${pointField} does not exist for this property`);
    point = rows[0];
    if (zoneId && point.zone_id !== zoneId) {
      throw serviceError(400, `${pointField} does not belong to ${zoneField}`);
    }
  }

  return { zone, point };
}

async function validateAccessPoint(
  queryable,
  {
    propertyId,
    accessPointId = null,
    fieldName = 'access_point_id',
  },
) {
  if (!accessPointId) return { point: null };
  const { point } = await validateAccessTopologyTarget(queryable, {
    propertyId,
    pointId: accessPointId,
    pointField: fieldName,
  });
  return { point };
}

module.exports = {
  AccessTopologyServiceError,
  isAccessTopologyServiceError,
  validateAccessPoint,
  validateAccessTopologyTarget,
};
