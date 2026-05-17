'use strict';

// platform-v1 Structure routes — buildings / entrances / units.
// Spec: docs/product/specs/platform-v1/units-spec.md
// Phase: 2 (Structure layer).
//
// All routes are mounted under /api/v1/* and protected by the legacy
// requireAuth (auth-v1-spec §7: we do NOT introduce requireAuthV1 in
// Фаза 2 — the surface area is structural, behaviour stays on legacy auth).
//
// Role mapping legacy → v1:
//   legacy role='admin'      ≙ v1 property_admin  (all mutations)
//   legacy isStaff(role)     ≙ v1 staff           (reads)
//
// Tenancy note: property_id is NOT derived from req.user (legacy JWT has no
// property_id claim).  We rely on tenant-resolver middleware to scope the DB
// connection, and store property_id in the row from an explicit request
// field so that tests can assert tenant isolation.  In Фаза 7 the claim
// becomes the source of truth — see auth-v1-spec.

const express = require('express');
const db = require('../../db');
const logger = require('../../logger');
const requireAuth = require('../../middleware/auth');
const { canInPropertyScope, isStaff, isAdmin } = require('../lib/authz');
const { parsePaginationParams, buildPageMeta } = require('../lib/pagination');
const {
  buildImportTemplate,
  importStructureRows,
  isStructureImportError,
  normalizePropertyType,
} = require('../services/structureImport');
const {
  isResourceScopeServiceError,
  loadResourcePropertyId,
} = require('../services/resourceScope');

const router = express.Router();
router.use(requireAuth);
const importCsvParser = express.text({
  type: ['text/csv', 'text/plain', 'application/csv'],
  limit: '1mb',
});

// SEC [AUDIT #1] — multi-tenant гейт смонтирован в registerApiRoutes.js на
// `/api/v1/*` и прикрепляет per-property pool в req.db.  Роут-функции
// вызывают `getDb(req).query(...)` чтобы:
//   • прод: использовать tenant pool из propertyDbMiddleware,
//   • тесты (где роутер mount'ится напрямую, middleware'а нет): fallback
//     на глобальный db-mock из '../../db' (см. v1Routes.test.js).
const getDb = (req) => req.db || db;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNIT_TYPES = new Set(['apartment', 'townhouse', 'house', 'commercial', 'utility']);

function isValidUuid(v) {
  return typeof v === 'string' && UUID_RE.test(v);
}

function isNonEmptyString(v, maxLen) {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= maxLen;
}

function isPropertyAdmin(req, propertyId = null) {
  if (!propertyId) return isAdmin(req);
  return canInPropertyScope(req, 'structure:write', propertyId);
}
function canReadStructure(req, propertyId) {
  return canInPropertyScope(req, 'structure:read', propertyId);
}
function resolvePropertyId(req) {
  return req.query.property_id
    || req.query.propertyId
    || req.body?.property_id
    || req.body?.propertyId
    || req.property?.id
    || req.property?.property_id
    || req.user?.property_id
    || req.user?.propertyId
    || null;
}

function sendScopeError(res, err) {
  if (!isResourceScopeServiceError(err)) return false;
  res.status(err.status).json({ error: err.message });
  return true;
}

async function requirePropertyAdminForResource(req, res, resourceType, resourceId, notFoundMessage) {
  const propertyId = await loadResourcePropertyId(getDb(req), resourceType, resourceId, { notFoundMessage });
  if (!isPropertyAdmin(req, propertyId)) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }
  return propertyId;
}

// Small helper: write to property-DB audit_log with fire-and-forget semantics.
// We never block the mutation on audit-insert failure — alerting on audit
// gaps is part of observability (ROADMAP P0-4), not the request pipeline.
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
  ).catch((err) => logger.warn({ err, action }, '[v1/structure] audit write failed'));
}

// ─── Buildings ────────────────────────────────────────────────────────────────

// GET /api/v1/buildings — list (staff-read, no PII)
router.get('/buildings', async (req, res, next) => {
  try {
    if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    const propertyId = resolvePropertyId(req);
    if (!isValidUuid(propertyId)) return res.status(400).json({ error: 'property_id must be UUID' });
    if (!canReadStructure(req, propertyId)) return res.status(403).json({ error: 'Forbidden' });
    const { rows } = await getDb(req).query(
      `SELECT id, property_id, code, name, sort_order, created_at
         FROM buildings
        WHERE property_id = $1
        ORDER BY sort_order ASC, name ASC`,
      [propertyId],
    );
    res.json({ buildings: rows });
  } catch (err) { next(err); }
});

// POST /api/v1/buildings — create (property_admin only)
router.post('/buildings', async (req, res, next) => {
  try {
    const { property_id, name, code = null, sort_order = 0 } = req.body || {};

    if (!isValidUuid(property_id)) return res.status(400).json({ error: 'property_id must be UUID' });
    if (!isPropertyAdmin(req, property_id)) return res.status(403).json({ error: 'Forbidden' });
    if (!isNonEmptyString(name, 100)) return res.status(400).json({ error: 'name required (1–100 chars)' });
    if (code !== null && !isNonEmptyString(code, 50)) return res.status(400).json({ error: 'code must be 1–50 chars or null' });
    if (!Number.isInteger(sort_order)) return res.status(400).json({ error: 'sort_order must be integer' });

    const { rows } = await getDb(req).query(
      `INSERT INTO buildings(property_id, code, name, sort_order)
       VALUES ($1, $2, $3, $4)
       RETURNING id, property_id, code, name, sort_order, created_at`,
      [property_id, code, name.trim(), sort_order],
    );
    auditLog(req, {
      action: 'building.created',
      resourceType: 'building',
      resourceId: rows[0].id,
      changes: { name: rows[0].name, code: rows[0].code },
    });
    res.status(201).json({ building: rows[0] });
  } catch (err) {
    if (err && err.code === '23505') return res.status(409).json({ error: 'building code already exists for this property' });
    next(err);
  }
});

// ─── Entrances ────────────────────────────────────────────────────────────────

// GET /api/v1/buildings/:id/entrances — list entrances of a building
router.get('/buildings/:id/entrances', async (req, res, next) => {
  try {
    if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid building id' });
    const propertyId = await loadResourcePropertyId(
      getDb(req),
      'building',
      req.params.id,
      { notFoundMessage: 'Building not found' },
    );
    if (!canReadStructure(req, propertyId)) return res.status(403).json({ error: 'Forbidden' });
    const { rows } = await getDb(req).query(
      `SELECT id, building_id, code, name, sort_order, created_at
         FROM entrances
        WHERE building_id = $1
        ORDER BY sort_order ASC, name ASC`,
      [req.params.id],
    );
    res.json({ entrances: rows });
  } catch (err) { next(err); }
});

// POST /api/v1/entrances — create
router.post('/entrances', async (req, res, next) => {
  try {
    const { building_id, name, code = null, sort_order = 0 } = req.body || {};

    if (!isValidUuid(building_id)) return res.status(400).json({ error: 'building_id must be UUID' });
    const buildingPropertyId = await loadResourcePropertyId(
      getDb(req),
      'building',
      building_id,
      { notFoundStatus: 400, notFoundMessage: 'building_id does not exist' },
    );
    if (!isPropertyAdmin(req, buildingPropertyId)) return res.status(403).json({ error: 'Forbidden' });
    if (!isNonEmptyString(name, 100)) return res.status(400).json({ error: 'name required (1–100 chars)' });
    if (code !== null && !isNonEmptyString(code, 50)) return res.status(400).json({ error: 'code must be 1–50 chars or null' });
    if (!Number.isInteger(sort_order)) return res.status(400).json({ error: 'sort_order must be integer' });

    const { rows } = await getDb(req).query(
      `INSERT INTO entrances(building_id, code, name, sort_order)
       VALUES ($1, $2, $3, $4)
       RETURNING id, building_id, code, name, sort_order, created_at`,
      [building_id, code, name.trim(), sort_order],
    );
    auditLog(req, {
      action: 'entrance.created',
      resourceType: 'entrance',
      resourceId: rows[0].id,
      changes: { building_id, name: rows[0].name, code: rows[0].code },
    });
    res.status(201).json({ entrance: rows[0] });
  } catch (err) {
    if (sendScopeError(res, err)) return;
    if (err && err.code === '23503') return res.status(400).json({ error: 'building_id does not exist' });
    if (err && err.code === '23505') return res.status(409).json({ error: 'entrance code already exists for this building' });
    next(err);
  }
});

// ─── Units ───────────────────────────────────────────────────────────────────

// GET /api/v1/units?building_id=&entrance_id=&unit_type=&q=&is_active=&limit=&offset=
router.get('/units', async (req, res, next) => {
  try {
    if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    const propertyId = resolvePropertyId(req);
    if (!isValidUuid(propertyId)) return res.status(400).json({ error: 'property_id must be UUID' });
    if (!canReadStructure(req, propertyId)) return res.status(403).json({ error: 'Forbidden' });

    let pagination;
    try {
      pagination = parsePaginationParams(req.query);
    } catch (rangeErr) {
      return res.status(400).json({ error: rangeErr.message });
    }

    const filters = ['property_id = $1'];
    const params = [propertyId];
    if (req.query.building_id) {
      if (!isValidUuid(req.query.building_id)) return res.status(400).json({ error: 'Invalid building_id' });
      params.push(req.query.building_id); filters.push(`building_id = $${params.length}`);
    }
    if (req.query.entrance_id) {
      if (!isValidUuid(req.query.entrance_id)) return res.status(400).json({ error: 'Invalid entrance_id' });
      params.push(req.query.entrance_id); filters.push(`entrance_id = $${params.length}`);
    }
    if (req.query.unit_type) {
      if (!UNIT_TYPES.has(String(req.query.unit_type))) return res.status(400).json({ error: 'Invalid unit_type' });
      params.push(req.query.unit_type); filters.push(`unit_type = $${params.length}`);
    }
    if (req.query.is_active !== undefined) {
      const active = req.query.is_active === 'true' || req.query.is_active === '1';
      params.push(active); filters.push(`is_active = $${params.length}`);
    }
    if (req.query.q) {
      params.push(`%${String(req.query.q).trim().toLowerCase()}%`);
      filters.push(`LOWER(unit_number) LIKE $${params.length}`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    params.push(pagination.limit);
    const limitIdx = params.length;
    params.push(pagination.offset);
    const offsetIdx = params.length;

    const { rows } = await getDb(req).query(
      `SELECT id, property_id, building_id, entrance_id, unit_number, unit_type, floor, is_active, created_at
         FROM units
         ${where}
        ORDER BY unit_number ASC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );
    res.json({
      units: rows,
      page: buildPageMeta({ ...pagination, returnedCount: rows.length }),
    });
  } catch (err) { next(err); }
});

// GET /api/v1/units/import/template?property_type=
router.get('/units/import/template', async (req, res, next) => {
  try {
    if (!isPropertyAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    const template = buildImportTemplate(req.query.property_type);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${template.filename}"`);
    res.send(template.content);
  } catch (err) { next(err); }
});

// POST /api/v1/units/import — CSV or JSON initial onboarding import.
router.post('/units/import', importCsvParser, async (req, res, next) => {
  try {
    const body = req.body || {};
    const property_id = typeof body === 'object' && !Array.isArray(body)
      ? body.property_id
      : req.query.property_id;
    const property_type = normalizePropertyType(
      typeof body === 'object' && !Array.isArray(body)
        ? body.property_type
        : req.query.property_type,
    );

    if (!isValidUuid(property_id)) return res.status(400).json({ error: 'property_id must be UUID' });
    if (!isPropertyAdmin(req, property_id)) return res.status(403).json({ error: 'Forbidden' });

    const result = await importStructureRows({
      queryable: getDb(req),
      propertyId: property_id,
      propertyType: property_type,
      body,
    });
    auditLog(req, {
      action: 'units.imported',
      resourceType: 'unit_import',
      resourceId: property_id,
      changes: {
        property_type,
        imported: result.imported,
        skipped: result.skipped,
        readiness: result.readiness,
        planned_access_points: result.planned_access_points,
        access_topology: result.access_topology,
      },
    });
    res.status(201).json({ property_type, ...result });
  } catch (err) {
    if (isStructureImportError(err)) {
      const body = { error: err.message };
      if (err.details) body.details = err.details;
      return res.status(err.status).json(body);
    }
    if (err && err.code === '23505') return res.status(409).json({ error: 'import duplicate conflict' });
    if (err && err.code === '23503') return res.status(400).json({ error: 'import references a non-existent row' });
    next(err);
  }
});

// GET /api/v1/units/:id — detail + list of residents
router.get('/units/:id', async (req, res, next) => {
  try {
    if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid unit id' });
    const { rows: unitRows } = await getDb(req).query(
      `SELECT id, property_id, building_id, entrance_id, unit_number, unit_type, floor, is_active, created_at
         FROM units WHERE id = $1`,
      [req.params.id],
    );
    if (!unitRows[0]) return res.status(404).json({ error: 'Unit not found' });
    if (!canReadStructure(req, unitRows[0].property_id)) return res.status(403).json({ error: 'Forbidden' });

    const { rows: residents } = await getDb(req).query(
      `SELECT id, full_name, resident_type, is_active, consent_given_at
         FROM residents WHERE unit_id = $1 AND is_active = true
         ORDER BY full_name ASC`,
      [req.params.id],
    );
    res.json({ unit: unitRows[0], residents });
  } catch (err) { next(err); }
});

// POST /api/v1/units — create single unit
router.post('/units', async (req, res, next) => {
  try {
    const {
      property_id, building_id, entrance_id, unit_number,
      unit_type = 'apartment', floor = null,
    } = req.body || {};

    if (!isValidUuid(property_id)) return res.status(400).json({ error: 'property_id must be UUID' });
    if (!isPropertyAdmin(req, property_id)) return res.status(403).json({ error: 'Forbidden' });
    if (!isValidUuid(building_id)) return res.status(400).json({ error: 'building_id must be UUID' });
    if (!isValidUuid(entrance_id)) return res.status(400).json({ error: 'entrance_id must be UUID' });
    if (!isNonEmptyString(unit_number, 30)) return res.status(400).json({ error: 'unit_number required (1–30 chars)' });
    if (!UNIT_TYPES.has(unit_type)) return res.status(400).json({ error: 'Invalid unit_type' });
    if (floor !== null && !Number.isInteger(floor)) return res.status(400).json({ error: 'floor must be integer or null' });

    // Defense in depth: verify entrance belongs to building so the
    // denormalised fields can never drift from the authoritative FK.
    const { rows: check } = await getDb(req).query(
      `SELECT 1
         FROM entrances e
         JOIN buildings b ON b.id = e.building_id
        WHERE e.id = $1
          AND e.building_id = $2
          AND b.property_id = $3`,
      [entrance_id, building_id, property_id],
    );
    if (!check[0]) return res.status(400).json({ error: 'entrance does not belong to the given building' });

    const { rows } = await getDb(req).query(
      `INSERT INTO units(property_id, building_id, entrance_id, unit_number, unit_type, floor)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, property_id, building_id, entrance_id, unit_number, unit_type, floor, is_active, created_at`,
      [property_id, building_id, entrance_id, unit_number.trim(), unit_type, floor],
    );
    auditLog(req, {
      action: 'unit.created',
      resourceType: 'unit',
      resourceId: rows[0].id,
      changes: { unit_number: rows[0].unit_number, unit_type: rows[0].unit_type, entrance_id },
    });
    res.status(201).json({ unit: rows[0] });
  } catch (err) {
    if (err && err.code === '23505') return res.status(409).json({ error: 'unit_number already exists at this address' });
    next(err);
  }
});

// PATCH /api/v1/units/:id
router.patch('/units/:id', async (req, res, next) => {
  try {
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid unit id' });
    const propertyId = await requirePropertyAdminForResource(req, res, 'unit', req.params.id, 'Unit not found');
    if (!propertyId) return;

    const changes = {};
    const sets = [];
    const params = [];

    if (req.body.unit_number !== undefined) {
      if (!isNonEmptyString(req.body.unit_number, 30)) return res.status(400).json({ error: 'unit_number must be 1–30 chars' });
      params.push(req.body.unit_number.trim()); sets.push(`unit_number = $${params.length}`); changes.unit_number = req.body.unit_number.trim();
    }
    if (req.body.unit_type !== undefined) {
      if (!UNIT_TYPES.has(req.body.unit_type)) return res.status(400).json({ error: 'Invalid unit_type' });
      params.push(req.body.unit_type); sets.push(`unit_type = $${params.length}`); changes.unit_type = req.body.unit_type;
    }
    if (req.body.floor !== undefined) {
      if (req.body.floor !== null && !Number.isInteger(req.body.floor)) return res.status(400).json({ error: 'floor must be integer or null' });
      params.push(req.body.floor); sets.push(`floor = $${params.length}`); changes.floor = req.body.floor;
    }

    if (!sets.length) return res.status(400).json({ error: 'No updatable fields provided' });

    sets.push(`updated_at = NOW()`);
    params.push(req.params.id);
    const idIdx = params.length;
    params.push(propertyId);

    const { rows } = await getDb(req).query(
      `UPDATE units SET ${sets.join(', ')}
        WHERE id = $${idIdx} AND property_id = $${params.length}
        RETURNING id, property_id, building_id, entrance_id, unit_number, unit_type, floor, is_active, created_at`,
      params,
    );
    if (!rows[0]) return res.status(404).json({ error: 'Unit not found' });
    auditLog(req, { action: 'unit.updated', resourceType: 'unit', resourceId: rows[0].id, changes });
    res.json({ unit: rows[0] });
  } catch (err) {
    if (sendScopeError(res, err)) return;
    if (err && err.code === '23505') return res.status(409).json({ error: 'unit_number already exists at this address' });
    next(err);
  }
});

// POST /api/v1/units/:id/deactivate — soft-delete.
// Rejected (409) if there are active residents; property_admin must move or
// deactivate residents first (units-spec §5 acceptance criterion).
router.post('/units/:id/deactivate', async (req, res, next) => {
  try {
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid unit id' });
    const propertyId = await requirePropertyAdminForResource(req, res, 'unit', req.params.id, 'Unit not found');
    if (!propertyId) return;

    const { rows: residents } = await getDb(req).query(
      `SELECT COUNT(*)::int AS c
         FROM residents
        WHERE unit_id = $1 AND property_id = $2 AND is_active = true`,
      [req.params.id, propertyId],
    );
    if (residents[0].c > 0) {
      return res.status(409).json({ error: 'Cannot deactivate: unit still has active residents', residents: residents[0].c });
    }

    const { rows } = await getDb(req).query(
      `UPDATE units
          SET is_active = false, updated_at = NOW()
        WHERE id = $1 AND property_id = $2
        RETURNING id`,
      [req.params.id, propertyId],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Unit not found' });
    auditLog(req, { action: 'unit.deactivated', resourceType: 'unit', resourceId: rows[0].id, changes: null });
    res.status(204).end();
  } catch (err) {
    if (sendScopeError(res, err)) return;
    next(err);
  }
});

module.exports = router;
