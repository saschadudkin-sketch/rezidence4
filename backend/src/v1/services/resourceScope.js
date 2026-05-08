'use strict';

const RESOURCE_PROPERTY_QUERIES = Object.freeze({
  building: {
    sql: `SELECT property_id FROM buildings WHERE id = $1`,
  },
  entrance: {
    sql: `SELECT b.property_id
            FROM entrances e
            JOIN buildings b ON b.id = e.building_id
           WHERE e.id = $1`,
  },
  unit: {
    sql: `SELECT property_id FROM units WHERE id = $1`,
  },
  resident: {
    sql: `SELECT property_id FROM residents WHERE id = $1`,
  },
  staff_user: {
    sql: `SELECT property_id FROM staff_users WHERE id = $1`,
  },
  contractor_company: {
    sql: `SELECT property_id FROM contractor_companies WHERE id = $1`,
  },
  contractor_user: {
    sql: `SELECT property_id FROM contractor_users WHERE id = $1`,
  },
  vehicle: {
    sql: `SELECT property_id FROM vehicles WHERE id = $1`,
  },
  access_zone: {
    sql: `SELECT property_id FROM access_zones WHERE id = $1`,
  },
  access_point: {
    sql: `SELECT property_id FROM access_points WHERE id = $1`,
  },
});

class ResourceScopeServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ResourceScopeServiceError';
    this.status = status;
  }
}

function serviceError(status, message) {
  return new ResourceScopeServiceError(status, message);
}

function isResourceScopeServiceError(err) {
  return err instanceof ResourceScopeServiceError;
}

async function loadResourcePropertyId(queryable, resourceType, resourceId, options = {}) {
  const spec = RESOURCE_PROPERTY_QUERIES[resourceType];
  if (!spec) throw serviceError(500, `Unknown property-owned resource '${resourceType}'`);

  const { rows } = await queryable.query(spec.sql, [resourceId]);
  if (!rows[0]) {
    throw serviceError(options.notFoundStatus || 404, options.notFoundMessage || 'Resource not found');
  }
  return rows[0].property_id;
}

module.exports = {
  RESOURCE_PROPERTY_QUERIES,
  ResourceScopeServiceError,
  isResourceScopeServiceError,
  loadResourcePropertyId,
};
