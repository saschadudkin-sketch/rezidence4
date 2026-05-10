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
  access_policy: {
    sql: `SELECT property_id FROM access_policies WHERE id = $1`,
  },
  access_request: {
    sql: `SELECT property_id FROM access_requests WHERE id = $1`,
  },
  pass: {
    sql: `SELECT property_id FROM passes WHERE id = $1`,
  },
  visit_log: {
    sql: `SELECT property_id FROM visit_logs_v2 WHERE id = $1`,
  },
  access_incident: {
    sql: `SELECT property_id FROM access_incidents WHERE id = $1`,
  },
  access_override: {
    sql: `SELECT property_id FROM access_overrides WHERE id = $1`,
  },
  package: {
    sql: `SELECT property_id FROM packages_v2 WHERE id = $1`,
  },
  announcement: {
    sql: `SELECT property_id FROM announcements_v2 WHERE id = $1`,
  },
  document: {
    sql: `SELECT property_id FROM documents_v2 WHERE id = $1`,
  },
  video_evidence: {
    sql: `SELECT property_id FROM video_evidence_references WHERE id = $1`,
  },
  erp_provider_config: {
    sql: `SELECT property_id FROM erp_provider_configs WHERE id = $1`,
  },
  skud_provider_config: {
    sql: `SELECT property_id FROM skud_provider_configs WHERE id = $1`,
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
