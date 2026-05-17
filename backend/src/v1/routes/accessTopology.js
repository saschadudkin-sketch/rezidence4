'use strict';

// platform-v1 Access Topology routes — /api/v1/access-zones + access-points.
// Spec: docs/product/specs/platform-v1/access-topology-spec.md
// Ticket: DH-06 Access Zones And Points.

const express = require('express');
const db = require('../../db');
const logger = require('../../logger');
const requireAuth = require('../../middleware/auth');
const { canInPropertyScope } = require('../lib/authz');
const { parsePaginationParams, buildPageMeta } = require('../lib/pagination');

const router = express.Router();
router.use(requireAuth);

const getDb = (req) => req.db || db;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ZONE_TYPES = new Set([
  'perimeter',
  'checkpoint',
  'residential_entry',
  'parking',
  'guest_parking',
  'resident_parking',
  'public_area',
  'technical_area',
  'service_area',
  'street',
  'sector',
]);
const POINT_TYPES = new Set([
  'gate',
  'barrier',
  'door',
  'turnstile',
  'wicket',
  'intercom',
  'checkpoint',
  'service_gate',
]);

function isValidUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

function isNonEmptyString(value, maxLength) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function resolveRequestPropertyId(req, explicitPropertyId = null) {
  return explicitPropertyId
    || req.property?.id
    || req.property?.property_id
    || req.query?.property_id
    || req.body?.property_id
    || null;
}

function canReadTopology(req, propertyId) {
  return canInPropertyScope(req, 'access.topology.read', propertyId);
}

function canWriteTopology(req, propertyId) {
  return canInPropertyScope(req, 'access.topology.write', propertyId);
}

function auditLog(req, { action, resourceType, resourceId, changes }) {
  getDb(req).query(
    `INSERT INTO property_audit_log
       (actor_uid, actor_role, action, resource_type, resource_id, changes, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      req.user?.uid || null,
      req.user?.role || null,
      action,
      resourceType,
      resourceId,
      changes ? JSON.stringify(changes) : null,
      req.ip || null,
    ],
  ).catch((err) => logger.warn({ err, action }, '[v1/accessTopology] audit write failed'));
}

async function loadResourceProperty(req, table, id, notFoundMessage) {
  const { rows } = await getDb(req).query(
    `SELECT property_id FROM ${table} WHERE id = $1`,
    [id],
  );
  if (!rows[0]) {
    const err = new Error(notFoundMessage);
    err.status = 404;
    throw err;
  }
  return rows[0].property_id;
}

function sendKnownError(res, err) {
  if (err?.status) {
    res.status(err.status).json({ error: err.message });
    return true;
  }
  return false;
}

// ─── Access zones ────────────────────────────────────────────────────────────

router.get('/access-zones', async (req, res, next) => {
  try {
    const propertyId = resolveRequestPropertyId(req);
    if (!isValidUuid(propertyId)) return res.status(400).json({ error: 'property_id must be UUID' });
    if (!canReadTopology(req, propertyId)) return res.status(403).json({ error: 'Forbidden' });

    let pagination;
    try {
      pagination = parsePaginationParams(req.query);
    } catch (rangeErr) {
      return res.status(400).json({ error: rangeErr.message });
    }

    const filters = ['property_id = $1'];
    const params = [propertyId];
    if (req.query.zone_type) {
      if (!ZONE_TYPES.has(req.query.zone_type)) return res.status(400).json({ error: 'Invalid zone_type' });
      params.push(req.query.zone_type);
      filters.push(`zone_type = $${params.length}`);
    }
    if (req.query.is_active !== undefined) {
      params.push(req.query.is_active === 'true' || req.query.is_active === '1');
      filters.push(`is_active = $${params.length}`);
    }
    params.push(pagination.limit);
    const limitIdx = params.length;
    params.push(pagination.offset);
    const offsetIdx = params.length;

    const { rows } = await getDb(req).query(
      `SELECT id, property_id, building_id, name, zone_type, description,
              is_active, sort_order, metadata, created_at, updated_at
         FROM access_zones
        WHERE ${filters.join(' AND ')}
        ORDER BY sort_order ASC, name ASC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );

    res.json({
      zones: rows,
      page: buildPageMeta({ ...pagination, returnedCount: rows.length }),
    });
  } catch (err) { next(err); }
});

router.post('/access-zones', async (req, res, next) => {
  try {
    const {
      property_id,
      building_id = null,
      name,
      zone_type,
      description = null,
      sort_order = 0,
      metadata = {},
    } = req.body || {};

    if (!isValidUuid(property_id)) return res.status(400).json({ error: 'property_id must be UUID' });
    if (!canWriteTopology(req, property_id)) return res.status(403).json({ error: 'Forbidden' });
    if (building_id !== null && !isValidUuid(building_id)) return res.status(400).json({ error: 'building_id must be UUID or null' });
    if (!isNonEmptyString(name, 100)) return res.status(400).json({ error: 'name required (1-100 chars)' });
    if (!ZONE_TYPES.has(zone_type)) return res.status(400).json({ error: 'Invalid zone_type' });
    if (description !== null && typeof description !== 'string') return res.status(400).json({ error: 'description must be string or null' });
    if (!Number.isInteger(sort_order)) return res.status(400).json({ error: 'sort_order must be integer' });
    if (!isPlainObject(metadata)) return res.status(400).json({ error: 'metadata must be object' });

    const { rows } = await getDb(req).query(
      `INSERT INTO access_zones
         (property_id, building_id, name, zone_type, description, sort_order, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       RETURNING id, property_id, building_id, name, zone_type, description,
                 is_active, sort_order, metadata, created_at, updated_at`,
      [
        property_id,
        building_id || null,
        name.trim(),
        zone_type,
        description || null,
        sort_order,
        JSON.stringify(metadata),
      ],
    );
    auditLog(req, {
      action: 'access_zone.created',
      resourceType: 'access_zone',
      resourceId: rows[0].id,
      changes: { name: rows[0].name, zone_type: rows[0].zone_type },
    });
    res.status(201).json({ zone: rows[0] });
  } catch (err) {
    if (err && err.code === '23503') return res.status(400).json({ error: 'building_id does not exist' });
    if (err && err.code === '23505') return res.status(409).json({ error: 'active access zone name already exists for this property' });
    next(err);
  }
});

router.patch('/access-zones/:id', async (req, res, next) => {
  try {
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid zone id' });
    const propertyId = await loadResourceProperty(req, 'access_zones', req.params.id, 'Access zone not found');
    if (!canWriteTopology(req, propertyId)) return res.status(403).json({ error: 'Forbidden' });

    const sets = [];
    const params = [];
    const changes = {};
    if (req.body.name !== undefined) {
      if (!isNonEmptyString(req.body.name, 100)) return res.status(400).json({ error: 'name must be 1-100 chars' });
      params.push(req.body.name.trim());
      sets.push(`name = $${params.length}`);
      changes.name = req.body.name.trim();
    }
    if (req.body.zone_type !== undefined) {
      if (!ZONE_TYPES.has(req.body.zone_type)) return res.status(400).json({ error: 'Invalid zone_type' });
      params.push(req.body.zone_type);
      sets.push(`zone_type = $${params.length}`);
      changes.zone_type = req.body.zone_type;
    }
    if (req.body.building_id !== undefined) {
      if (req.body.building_id !== null && !isValidUuid(req.body.building_id)) {
        return res.status(400).json({ error: 'building_id must be UUID or null' });
      }
      if (req.body.building_id !== null && req.body.building_id !== undefined) {
        const buildingPropertyId = await loadResourceProperty(
          req,
          'buildings',
          req.body.building_id,
          'building_id does not exist',
        );
        if (buildingPropertyId !== propertyId) {
          return res.status(400).json({ error: 'building_id does not belong to this property' });
        }
      }
      params.push(req.body.building_id || null);
      sets.push(`building_id = $${params.length}`);
      changes.building_id = req.body.building_id || null;
    }
    if (req.body.description !== undefined) {
      if (req.body.description !== null && typeof req.body.description !== 'string') {
        return res.status(400).json({ error: 'description must be string or null' });
      }
      params.push(req.body.description || null);
      sets.push(`description = $${params.length}`);
      changes.description = req.body.description || null;
    }
    if (req.body.sort_order !== undefined) {
      if (!Number.isInteger(req.body.sort_order)) return res.status(400).json({ error: 'sort_order must be integer' });
      params.push(req.body.sort_order);
      sets.push(`sort_order = $${params.length}`);
      changes.sort_order = req.body.sort_order;
    }
    if (req.body.metadata !== undefined) {
      if (!isPlainObject(req.body.metadata)) return res.status(400).json({ error: 'metadata must be object' });
      params.push(JSON.stringify(req.body.metadata));
      sets.push(`metadata = $${params.length}::jsonb`);
      changes.metadata = req.body.metadata;
    }
    if (req.body.is_active !== undefined) {
      if (typeof req.body.is_active !== 'boolean') return res.status(400).json({ error: 'is_active must be boolean' });
      params.push(req.body.is_active);
      sets.push(`is_active = $${params.length}`);
      changes.is_active = req.body.is_active;
    }

    if (!sets.length) return res.status(400).json({ error: 'No updatable fields provided' });
    sets.push('updated_at = NOW()');
    params.push(req.params.id);
    const idIdx = params.length;
    params.push(propertyId);

    const { rows } = await getDb(req).query(
      `UPDATE access_zones SET ${sets.join(', ')}
        WHERE id = $${idIdx} AND property_id = $${params.length}
        RETURNING id, property_id, building_id, name, zone_type, description,
                  is_active, sort_order, metadata, created_at, updated_at`,
      params,
    );
    if (!rows[0]) return res.status(404).json({ error: 'Access zone not found' });
    auditLog(req, { action: 'access_zone.updated', resourceType: 'access_zone', resourceId: rows[0].id, changes });
    res.json({ zone: rows[0] });
  } catch (err) {
    if (sendKnownError(res, err)) return;
    if (err && err.code === '23503') return res.status(400).json({ error: 'building_id does not exist' });
    if (err && err.code === '23505') return res.status(409).json({ error: 'active access zone name already exists for this property' });
    next(err);
  }
});

router.post('/access-zones/:id/deactivate', async (req, res, next) => {
  try {
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid zone id' });
    const propertyId = await loadResourceProperty(req, 'access_zones', req.params.id, 'Access zone not found');
    if (!canWriteTopology(req, propertyId)) return res.status(403).json({ error: 'Forbidden' });

    const { rows } = await getDb(req).query(
      `UPDATE access_zones SET is_active = false, updated_at = NOW()
        WHERE id = $1 AND property_id = $2
        RETURNING id`,
      [req.params.id, propertyId],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Access zone not found' });
    auditLog(req, { action: 'access_zone.deactivated', resourceType: 'access_zone', resourceId: rows[0].id, changes: null });
    res.status(204).end();
  } catch (err) {
    if (sendKnownError(res, err)) return;
    next(err);
  }
});

// ─── Access points ───────────────────────────────────────────────────────────

router.get('/access-points', async (req, res, next) => {
  try {
    const propertyId = resolveRequestPropertyId(req);
    if (!isValidUuid(propertyId)) return res.status(400).json({ error: 'property_id must be UUID' });
    if (!canReadTopology(req, propertyId)) return res.status(403).json({ error: 'Forbidden' });

    let pagination;
    try {
      pagination = parsePaginationParams(req.query);
    } catch (rangeErr) {
      return res.status(400).json({ error: rangeErr.message });
    }

    const filters = ['property_id = $1'];
    const params = [propertyId];
    if (req.query.zone_id) {
      if (!isValidUuid(req.query.zone_id)) return res.status(400).json({ error: 'Invalid zone_id' });
      params.push(req.query.zone_id);
      filters.push(`zone_id = $${params.length}`);
    }
    if (req.query.point_type) {
      if (!POINT_TYPES.has(req.query.point_type)) return res.status(400).json({ error: 'Invalid point_type' });
      params.push(req.query.point_type);
      filters.push(`point_type = $${params.length}`);
    }
    if (req.query.is_active !== undefined) {
      params.push(req.query.is_active === 'true' || req.query.is_active === '1');
      filters.push(`is_active = $${params.length}`);
    }
    params.push(pagination.limit);
    const limitIdx = params.length;
    params.push(pagination.offset);
    const offsetIdx = params.length;

    const { rows } = await getDb(req).query(
      `SELECT id, property_id, zone_id, name, point_type, provider,
              provider_external_id, description, is_active, sort_order,
              metadata, created_at, updated_at
         FROM access_points
        WHERE ${filters.join(' AND ')}
        ORDER BY sort_order ASC, name ASC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );

    res.json({
      points: rows,
      page: buildPageMeta({ ...pagination, returnedCount: rows.length }),
    });
  } catch (err) { next(err); }
});

router.post('/access-points', async (req, res, next) => {
  try {
    const {
      property_id,
      zone_id,
      name,
      point_type,
      provider = null,
      provider_external_id = null,
      description = null,
      sort_order = 0,
      metadata = {},
    } = req.body || {};

    if (!isValidUuid(property_id)) return res.status(400).json({ error: 'property_id must be UUID' });
    if (!canWriteTopology(req, property_id)) return res.status(403).json({ error: 'Forbidden' });
    if (!isValidUuid(zone_id)) return res.status(400).json({ error: 'zone_id must be UUID' });
    if (!isNonEmptyString(name, 100)) return res.status(400).json({ error: 'name required (1-100 chars)' });
    if (!POINT_TYPES.has(point_type)) return res.status(400).json({ error: 'Invalid point_type' });
    if (provider !== null && provider !== '' && !isNonEmptyString(provider, 50)) {
      return res.status(400).json({ error: 'provider must be 1-50 chars or null' });
    }
    if (provider_external_id !== null && provider_external_id !== '' && typeof provider_external_id !== 'string') {
      return res.status(400).json({ error: 'provider_external_id must be string or null' });
    }
    if (description !== null && typeof description !== 'string') return res.status(400).json({ error: 'description must be string or null' });
    if (!Number.isInteger(sort_order)) return res.status(400).json({ error: 'sort_order must be integer' });
    if (!isPlainObject(metadata)) return res.status(400).json({ error: 'metadata must be object' });

    const { rows: zoneCheck } = await getDb(req).query(
      `SELECT id FROM access_zones WHERE id = $1 AND property_id = $2 AND is_active = true`,
      [zone_id, property_id],
    );
    if (!zoneCheck[0]) return res.status(400).json({ error: 'zone_id does not exist for this property' });

    const { rows } = await getDb(req).query(
      `INSERT INTO access_points
         (property_id, zone_id, name, point_type, provider, provider_external_id,
          description, sort_order, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
       RETURNING id, property_id, zone_id, name, point_type, provider,
                 provider_external_id, description, is_active, sort_order,
                 metadata, created_at, updated_at`,
      [
        property_id,
        zone_id,
        name.trim(),
        point_type,
        provider || null,
        provider_external_id || null,
        description || null,
        sort_order,
        JSON.stringify(metadata),
      ],
    );
    auditLog(req, {
      action: 'access_point.created',
      resourceType: 'access_point',
      resourceId: rows[0].id,
      changes: { zone_id, name: rows[0].name, point_type: rows[0].point_type },
    });
    res.status(201).json({ point: rows[0] });
  } catch (err) {
    if (err && err.code === '23503') return res.status(400).json({ error: 'zone_id does not exist for this property' });
    next(err);
  }
});

router.patch('/access-points/:id', async (req, res, next) => {
  try {
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid point id' });
    const propertyId = await loadResourceProperty(req, 'access_points', req.params.id, 'Access point not found');
    if (!canWriteTopology(req, propertyId)) return res.status(403).json({ error: 'Forbidden' });

    const sets = [];
    const params = [];
    const changes = {};
    if (req.body.name !== undefined) {
      if (!isNonEmptyString(req.body.name, 100)) return res.status(400).json({ error: 'name must be 1-100 chars' });
      params.push(req.body.name.trim());
      sets.push(`name = $${params.length}`);
      changes.name = req.body.name.trim();
    }
    if (req.body.point_type !== undefined) {
      if (!POINT_TYPES.has(req.body.point_type)) return res.status(400).json({ error: 'Invalid point_type' });
      params.push(req.body.point_type);
      sets.push(`point_type = $${params.length}`);
      changes.point_type = req.body.point_type;
    }
    if (req.body.zone_id !== undefined) {
      if (!isValidUuid(req.body.zone_id)) return res.status(400).json({ error: 'zone_id must be UUID' });
      const { rows: zoneCheck } = await getDb(req).query(
        `SELECT id FROM access_zones WHERE id = $1 AND property_id = $2 AND is_active = true`,
        [req.body.zone_id, propertyId],
      );
      if (!zoneCheck[0]) return res.status(400).json({ error: 'zone_id does not exist for this property' });
      params.push(req.body.zone_id);
      sets.push(`zone_id = $${params.length}`);
      changes.zone_id = req.body.zone_id;
    }
    if (req.body.provider !== undefined) {
      if (req.body.provider !== null && req.body.provider !== '' && !isNonEmptyString(req.body.provider, 50)) {
        return res.status(400).json({ error: 'provider must be 1-50 chars or null' });
      }
      params.push(req.body.provider || null);
      sets.push(`provider = $${params.length}`);
      changes.provider = req.body.provider || null;
    }
    if (req.body.provider_external_id !== undefined) {
      if (req.body.provider_external_id !== null && req.body.provider_external_id !== '' && typeof req.body.provider_external_id !== 'string') {
        return res.status(400).json({ error: 'provider_external_id must be string or null' });
      }
      params.push(req.body.provider_external_id || null);
      sets.push(`provider_external_id = $${params.length}`);
      changes.provider_external_id = req.body.provider_external_id || null;
    }
    if (req.body.description !== undefined) {
      if (req.body.description !== null && typeof req.body.description !== 'string') {
        return res.status(400).json({ error: 'description must be string or null' });
      }
      params.push(req.body.description || null);
      sets.push(`description = $${params.length}`);
      changes.description = req.body.description || null;
    }
    if (req.body.sort_order !== undefined) {
      if (!Number.isInteger(req.body.sort_order)) return res.status(400).json({ error: 'sort_order must be integer' });
      params.push(req.body.sort_order);
      sets.push(`sort_order = $${params.length}`);
      changes.sort_order = req.body.sort_order;
    }
    if (req.body.metadata !== undefined) {
      if (!isPlainObject(req.body.metadata)) return res.status(400).json({ error: 'metadata must be object' });
      params.push(JSON.stringify(req.body.metadata));
      sets.push(`metadata = $${params.length}::jsonb`);
      changes.metadata = req.body.metadata;
    }
    if (req.body.is_active !== undefined) {
      if (typeof req.body.is_active !== 'boolean') return res.status(400).json({ error: 'is_active must be boolean' });
      params.push(req.body.is_active);
      sets.push(`is_active = $${params.length}`);
      changes.is_active = req.body.is_active;
    }

    if (!sets.length) return res.status(400).json({ error: 'No updatable fields provided' });
    sets.push('updated_at = NOW()');
    params.push(req.params.id);
    const idIdx = params.length;
    params.push(propertyId);

    const { rows } = await getDb(req).query(
      `UPDATE access_points SET ${sets.join(', ')}
        WHERE id = $${idIdx} AND property_id = $${params.length}
        RETURNING id, property_id, zone_id, name, point_type, provider,
                  provider_external_id, description, is_active, sort_order,
                  metadata, created_at, updated_at`,
      params,
    );
    if (!rows[0]) return res.status(404).json({ error: 'Access point not found' });
    auditLog(req, { action: 'access_point.updated', resourceType: 'access_point', resourceId: rows[0].id, changes });
    res.json({ point: rows[0] });
  } catch (err) {
    if (sendKnownError(res, err)) return;
    next(err);
  }
});

router.post('/access-points/:id/deactivate', async (req, res, next) => {
  try {
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid point id' });
    const propertyId = await loadResourceProperty(req, 'access_points', req.params.id, 'Access point not found');
    if (!canWriteTopology(req, propertyId)) return res.status(403).json({ error: 'Forbidden' });

    const { rows } = await getDb(req).query(
      `UPDATE access_points SET is_active = false, updated_at = NOW()
        WHERE id = $1 AND property_id = $2
        RETURNING id`,
      [req.params.id, propertyId],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Access point not found' });
    auditLog(req, { action: 'access_point.deactivated', resourceType: 'access_point', resourceId: rows[0].id, changes: null });
    res.status(204).end();
  } catch (err) {
    if (sendKnownError(res, err)) return;
    next(err);
  }
});

module.exports = router;
