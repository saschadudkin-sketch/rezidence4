'use strict';

// platform-v1 Vehicles route — /api/v1/vehicles.
// Spec: docs/product/specs/platform-v1/vehicles-spec.md
// Phase: 3 (Access-core).
//
// Транспортное средство как first-class сущность.  В legacy plate жил
// в трёх несвязанных местах (requests.car_plate, blacklist.car_plate,
// никакого whitelist).  Здесь единая таблица с owner-flags и
// white/blacklist.
//
// Auth: legacy requireAuth + role-mapping как в structure.js:
//   legacy 'admin'   = v1 property_admin (все mutations)
//   isStaff(role)    = v1 staff (read)
//   residents могут создавать СВОЁ авто через POST с owner_resident_id=uid.
//
// Normalization: все plate-поля проходят через `normalizePlate` на entry.
// В БД храним уже канонический вид (Latin upper, no spaces/dashes).

const express = require('express');
const db = require('../../db');
const logger = require('../../logger');
const { broadcastAccessEvent } = require('../../sse');
const requireAuth = require('../../middleware/auth');
const idempotency = require('../../middleware/idempotency');
const { canInPropertyScope, isStaff, isAdmin, isResident } = require('../lib/authz');
const { normalizePlate } = require('../lib/normalizePlate');
const { parsePaginationParams, buildPageMeta } = require('../lib/pagination');
const { resolveResidentIdByUid } = require('../services/accessActorResolver');
const {
  isResourceScopeServiceError,
  loadResourcePropertyId,
} = require('../services/resourceScope');
const {
  VEHICLE_COLS,
  blacklistVehicle,
  clearVehicleFlags,
  createVehicle,
  deleteVehicle,
  isVehicleServiceError,
  updateVehicle,
  whitelistVehicle,
} = require('../services/vehicleService');

const router = express.Router();
router.use(requireAuth);

// SEC [AUDIT #1] — per-tenant pool, см. комментарий в structure.js.
const getDb = (req) => req.db || db;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OWNER_TYPES = new Set(['resident', 'staff', 'contractor', 'guest']);
const VEHICLE_TYPES = new Set(['car', 'motorcycle', 'truck', 'service_vehicle']);

function isValidUuid(v) { return typeof v === 'string' && UUID_RE.test(v); }
function isNonEmptyString(v, maxLen) {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= maxLen;
}
function isPropertyAdmin(req, propertyId = null) {
  if (!propertyId) return isAdmin(req);
  return canInPropertyScope(req, 'vehicles:manage', propertyId);
}

function resolvePropertyId(req) {
  return req.property?.id
    || req.property?.property_id
    || req.query?.property_id
    || req.body?.property_id
    || req.user?.property_id
    || req.user?.propertyId
    || null;
}

function canReadVehicles(req, propertyId) {
  return canInPropertyScope(req, 'vehicles:read', propertyId);
}

function canSecurityManageVehicleFlag(req, propertyId) {
  return canInPropertyScope(req, 'access.plate.verify', propertyId);
}

function sendScopeError(res, err) {
  if (!isResourceScopeServiceError(err)) return false;
  res.status(err.status).json({ error: err.message });
  return true;
}

async function loadVehicleProperty(req, vehicleId) {
  return loadResourcePropertyId(getDb(req), 'vehicle', vehicleId, { notFoundMessage: 'Vehicle not found' });
}

async function requireResidentVehicleOwner(req, res, vehicleId) {
  const residentId = await resolveResidentIdByUid(getDb(req), req.user?.uid);
  if (!residentId) {
    res.status(403).json({ error: 'Resident identity is not mapped to v1' });
    return null;
  }
  const { rows } = await getDb(req).query(
    `SELECT property_id, owner_resident_id FROM vehicles WHERE id = $1`,
    [vehicleId],
  );
  if (!rows[0]) {
    res.status(404).json({ error: 'Vehicle not found' });
    return null;
  }
  if (rows[0].owner_resident_id !== residentId) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }
  return { propertyId: rows[0].property_id, residentId };
}

function actorTypeForRole(role) {
  if (role === 'contractor') return 'contractor';
  if (role === 'owner' || role === 'tenant' || role === 'resident') return 'resident';
  if (role === 'system') return 'system';
  return 'staff';
}

function auditLog(req, {
  propertyId,
  action,
  resourceType,
  resourceId,
  changes,
  entityType = resourceType,
  entityId = resourceId,
}) {
  getDb(req).query(
    `INSERT INTO property_audit_log
       (property_id, actor_uid, actor_role, actor_type, entity_type, entity_id,
        action, resource_type, resource_id, changes, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      propertyId,
      req.user?.uid || null,
      req.user?.role || null,
      actorTypeForRole(req.user?.role),
      entityType,
      entityId,
      action,
      resourceType,
      resourceId,
      changes ? JSON.stringify(changes) : null,
      req.ip || null,
    ],
  ).catch((err) => logger.warn({ err, action }, '[v1/vehicles] audit write failed'));
}

function sendServiceError(res, err) {
  if (!isVehicleServiceError(err)) return false;
  const body = { error: err.message };
  if (err.details) Object.assign(body, err.details);
  res.status(err.status).json(body);
  return true;
}

function emitAccessEvent(req, payload) {
  broadcastAccessEvent(payload, { propertySlug: req.propertySlug });
}

// ─── GET /api/v1/vehicles ────────────────────────────────────────────────────
// Pagination: ?limit=1..200 (default 50), ?offset=0..100000 (default 0)
router.get('/', async (req, res, next) => {
  try {
    const propertyId = resolvePropertyId(req);
    if (!isValidUuid(propertyId)) return res.status(400).json({ error: 'property_id must be UUID' });
    let residentOwnerId = null;
    if (isStaff(req.user.role)) {
      if (!canReadVehicles(req, propertyId)) return res.status(403).json({ error: 'Forbidden' });
    } else if (isResident(req.user.role)) {
      if (!canInPropertyScope(req, 'access.request.create', propertyId)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      residentOwnerId = await resolveResidentIdByUid(getDb(req), req.user?.uid);
      if (!residentOwnerId) return res.status(403).json({ error: 'Resident identity is not mapped to v1' });
      if (req.query.owner_resident_id && req.query.owner_resident_id !== residentOwnerId) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    } else {
      return res.status(403).json({ error: 'Forbidden' });
    }

    let pagination;
    try {
      pagination = parsePaginationParams(req.query);
    } catch (rangeErr) {
      return res.status(400).json({ error: rangeErr.message });
    }

    const filters = ['property_id = $1'];
    const params = [propertyId];
    if (req.query.plate) {
      params.push(normalizePlate(String(req.query.plate)));
      filters.push(`plate_number = $${params.length}`);
    }
    if (residentOwnerId) {
      params.push(residentOwnerId);
      filters.push(`owner_resident_id = $${params.length}`);
    } else if (req.query.owner_resident_id) {
      if (!isValidUuid(req.query.owner_resident_id)) {
        return res.status(400).json({ error: 'Invalid owner_resident_id' });
      }
      params.push(req.query.owner_resident_id);
      filters.push(`owner_resident_id = $${params.length}`);
    }
    if (req.query.is_whitelisted !== undefined) {
      params.push(req.query.is_whitelisted === 'true' || req.query.is_whitelisted === '1');
      filters.push(`is_whitelisted = $${params.length}`);
    }
    if (req.query.is_blacklisted !== undefined) {
      params.push(req.query.is_blacklisted === 'true' || req.query.is_blacklisted === '1');
      filters.push(`is_blacklisted = $${params.length}`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    params.push(pagination.limit);
    const limitIdx = params.length;
    params.push(pagination.offset);
    const offsetIdx = params.length;

    const { rows } = await getDb(req).query(
      `SELECT ${VEHICLE_COLS} FROM vehicles ${where}
        ORDER BY created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );
    res.json({
      vehicles: rows,
      page: buildPageMeta({ ...pagination, returnedCount: rows.length }),
    });
  } catch (err) { next(err); }
});

// ─── GET /api/v1/vehicles/by-plate/:plate ────────────────────────────────────
// Быстрый lookup для guard-console при въезде.
router.get('/by-plate/:plate', async (req, res, next) => {
  try {
    if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    const propertyId = resolvePropertyId(req);
    if (!isValidUuid(propertyId)) return res.status(400).json({ error: 'property_id must be UUID' });
    if (!canReadVehicles(req, propertyId)) return res.status(403).json({ error: 'Forbidden' });
    const normalized = normalizePlate(req.params.plate);
    if (!normalized) return res.status(400).json({ error: 'Invalid plate' });
    const { rows } = await getDb(req).query(
      `SELECT ${VEHICLE_COLS} FROM vehicles WHERE property_id = $1 AND plate_number = $2`,
      [propertyId, normalized],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Vehicle not found', plate: normalized });
    res.json({ vehicle: rows[0] });
  } catch (err) { next(err); }
});

// ─── GET /api/v1/vehicles/:id ────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid vehicle id' });
    let propertyId;
    if (isStaff(req.user.role)) {
      propertyId = await loadVehicleProperty(req, req.params.id);
      if (!canReadVehicles(req, propertyId)) return res.status(403).json({ error: 'Forbidden' });
    } else if (isResident(req.user.role)) {
      const owner = await requireResidentVehicleOwner(req, res, req.params.id);
      if (!owner) return;
      if (!canInPropertyScope(req, 'access.request.create', owner.propertyId)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      propertyId = owner.propertyId;
    } else {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { rows } = await getDb(req).query(
      `SELECT ${VEHICLE_COLS} FROM vehicles WHERE id = $1 AND property_id = $2`,
      [req.params.id, propertyId],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Vehicle not found' });
    res.json({ vehicle: rows[0] });
  } catch (err) { next(err); }
});

// ─── POST /api/v1/vehicles ───────────────────────────────────────────────────
// Регистрация.  Резидент может создать своё авто (owner_resident_id=uid-resident);
// property_admin — любое.
// Idempotency: optional Idempotency-Key — защита от double-tap при регистрации
// своего авто резидентом через мобильный UI.
router.post('/', idempotency, async (req, res, next) => {
  try {
    const {
      property_id, owner_type,
      owner_resident_id = null, owner_staff_id = null, owner_contractor_user_id = null,
      plate_number,
      vehicle_type = 'car',
      color = null, brand = null, model = null,
      notes = null,
    } = req.body || {};

    if (!isValidUuid(property_id)) return res.status(400).json({ error: 'property_id must be UUID' });
    if (!OWNER_TYPES.has(owner_type)) return res.status(400).json({ error: 'Invalid owner_type' });
    if (!VEHICLE_TYPES.has(vehicle_type)) return res.status(400).json({ error: 'Invalid vehicle_type' });

    // owner exclusivity — БД CHECK'нет, но хотим ответить 400 до INSERT
    if (owner_type === 'guest') {
      if (owner_resident_id || owner_staff_id || owner_contractor_user_id) {
        return res.status(400).json({ error: "owner_*_id must be null for owner_type='guest'" });
      }
    } else {
      const triple = [owner_resident_id, owner_staff_id, owner_contractor_user_id];
      const present = triple.filter(Boolean).length;
      if (present !== 1) {
        return res.status(400).json({ error: 'Exactly one owner_*_id must match owner_type' });
      }
      const ids = {
        resident: owner_resident_id,
        staff: owner_staff_id,
        contractor: owner_contractor_user_id,
      };
      if (!ids[owner_type]) {
        return res.status(400).json({ error: `owner_${owner_type}_id required for owner_type='${owner_type}'` });
      }
      for (const id of triple) if (id && !isValidUuid(id)) return res.status(400).json({ error: 'owner_*_id must be UUID' });
    }

    const normalized = normalizePlate(plate_number);
    if (!normalized || normalized.length < 3 || normalized.length > 20) {
      return res.status(400).json({ error: 'plate_number required (3–20 chars after normalization)' });
    }

    if (color !== null && !isNonEmptyString(color, 40)) return res.status(400).json({ error: 'color: 1–40 chars or null' });
    if (brand !== null && !isNonEmptyString(brand, 60)) return res.status(400).json({ error: 'brand: 1–60 chars or null' });
    if (model !== null && !isNonEmptyString(model, 60)) return res.status(400).json({ error: 'model: 1–60 chars or null' });
    if (notes !== null && typeof notes !== 'string') return res.status(400).json({ error: 'notes must be string or null' });

    if (!isPropertyAdmin(req, property_id) && !canInPropertyScope(req, 'access.request.create', property_id)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const result = await createVehicle({
      queryable: getDb(req),
      user: req.user,
      isPropertyAdmin: isPropertyAdmin(req, property_id),
      input: {
        property_id,
        owner_type,
        owner_resident_id,
        owner_staff_id,
        owner_contractor_user_id,
        plate_number: normalized,
        vehicle_type,
        color,
        brand,
        model,
        notes,
      },
    });
    auditLog(req, {
      propertyId: result.vehicle.property_id,
      action: 'vehicle.created',
      resourceType: 'vehicle',
      resourceId: result.vehicle.id,
      changes: { plate_number: normalized, owner_type, vehicle_type },
    });
    res.status(201).json({ vehicle: result.vehicle });
  } catch (err) {
    if (sendServiceError(res, err)) return;
    if (err && err.code === '23505') return res.status(409).json({ error: 'plate_number already registered for this property' });
    if (err && err.code === '23503') return res.status(400).json({ error: 'owner id references a non-existent entity' });
    if (err && err.code === '23514') return res.status(400).json({ error: 'vehicle constraint violation (owner exclusivity or flag conflict)' });
    next(err);
  }
});

// ─── PATCH /api/v1/vehicles/:id ──────────────────────────────────────────────
// Редактирование metadata + canonical flag updates.
router.patch('/:id', async (req, res, next) => {
  try {
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid vehicle id' });
    const propertyId = await loadVehicleProperty(req, req.params.id);
    const adminForVehicle = isPropertyAdmin(req, propertyId);
    if (isAdmin(req) && !adminForVehicle) return res.status(403).json({ error: 'Forbidden' });

    const wantsFlagChange = req.body.is_whitelisted !== undefined || req.body.is_blacklisted !== undefined;
    if (wantsFlagChange) {
      if (!adminForVehicle && !canSecurityManageVehicleFlag(req, propertyId)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const isWhitelisted = req.body.is_whitelisted === true;
      const isBlacklisted = req.body.is_blacklisted === true;
      if (isWhitelisted && isBlacklisted) return res.status(400).json({ error: 'flag conflict' });
      const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : null;
      if (isBlacklisted && !reason) return res.status(400).json({ error: 'reason is required' });

      let action;
      let result;
      if (isBlacklisted) {
        action = 'vehicle.blacklisted';
        result = await blacklistVehicle({ queryable: getDb(req), vehicleId: req.params.id, propertyId });
      } else if (isWhitelisted) {
        action = 'vehicle.whitelisted';
        result = await whitelistVehicle({ queryable: getDb(req), vehicleId: req.params.id, propertyId });
      } else {
        action = 'vehicle.flags_cleared';
        result = await clearVehicleFlags({ queryable: getDb(req), vehicleId: req.params.id, propertyId });
      }
      auditLog(req, {
        propertyId: result.vehicle.property_id,
        action,
        resourceType: 'vehicle',
        resourceId: result.vehicle.id,
        changes: { reason, is_whitelisted: result.vehicle.is_whitelisted, is_blacklisted: result.vehicle.is_blacklisted },
      });
      emitAccessEvent(req, {
        event_type: `access.${action}`,
        property_id: result.vehicle.property_id,
        vehicle_id: result.vehicle.id,
        plate_number: result.vehicle.plate_number,
      });
      return res.json({ vehicle: result.vehicle });
    }

    const changes = {};
    const str = (k, max) => {
      if (req.body[k] === undefined) return true;
      if (req.body[k] !== null && !isNonEmptyString(req.body[k], max)) {
        res.status(400).json({ error: `${k}: 1–${max} chars or null` });
        return false;
      }
      changes[k] = req.body[k];
      return true;
    };
    if (!str('color', 40)) return;
    if (!str('brand', 60)) return;
    if (!str('model', 60)) return;
    if (req.body.notes !== undefined) {
      if (req.body.notes !== null && typeof req.body.notes !== 'string') {
        return res.status(400).json({ error: 'notes must be string or null' });
      }
      changes.notes = req.body.notes;
    }
    if (req.body.vehicle_type !== undefined) {
      if (!VEHICLE_TYPES.has(req.body.vehicle_type)) return res.status(400).json({ error: 'Invalid vehicle_type' });
      changes.vehicle_type = req.body.vehicle_type;
    }

    const result = await updateVehicle({
      queryable: getDb(req),
      user: req.user,
      isPropertyAdmin: adminForVehicle,
      vehicleId: req.params.id,
      propertyId,
      changes,
    });
    auditLog(req, {
      propertyId: result.vehicle.property_id,
      action: 'vehicle.updated',
      resourceType: 'vehicle',
      resourceId: result.vehicle.id,
      changes,
    });
    res.json({ vehicle: result.vehicle });
  } catch (err) {
    if (sendScopeError(res, err)) return;
    if (sendServiceError(res, err)) return;
    next(err);
  }
});

// ─── POST /api/v1/vehicles/:id/whitelist ─────────────────────────────────────
router.post('/:id/whitelist', async (req, res, next) => {
  try {
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid vehicle id' });
    const propertyId = await loadVehicleProperty(req, req.params.id);
    if (!isPropertyAdmin(req, propertyId)) return res.status(403).json({ error: 'Forbidden' });
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : null;
    const result = await whitelistVehicle({ queryable: getDb(req), vehicleId: req.params.id, propertyId });
    auditLog(req, {
      propertyId: result.vehicle.property_id,
      action: 'vehicle.whitelisted',
      resourceType: 'vehicle',
      resourceId: result.vehicle.id,
      changes: { reason },
    });
    emitAccessEvent(req, {
      event_type: 'access.vehicle.whitelisted',
      property_id: result.vehicle.property_id,
      vehicle_id: result.vehicle.id,
      plate_number: result.vehicle.plate_number,
    });
    res.json({ vehicle: result.vehicle });
  } catch (err) {
    if (sendScopeError(res, err)) return;
    if (sendServiceError(res, err)) return;
    if (err && err.code === '23514') return res.status(400).json({ error: 'flag conflict' });
    next(err);
  }
});

// ─── POST /api/v1/vehicles/:id/blacklist ─────────────────────────────────────
router.post('/:id/blacklist', async (req, res, next) => {
  try {
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid vehicle id' });
    const propertyId = await loadVehicleProperty(req, req.params.id);
    if (!isPropertyAdmin(req, propertyId) && !canSecurityManageVehicleFlag(req, propertyId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : null;
    if (!reason) return res.status(400).json({ error: 'reason is required' });
    const result = await blacklistVehicle({ queryable: getDb(req), vehicleId: req.params.id, propertyId });
    auditLog(req, {
      propertyId: result.vehicle.property_id,
      action: 'vehicle.blacklisted',
      resourceType: 'vehicle',
      resourceId: result.vehicle.id,
      changes: { reason },
    });
    emitAccessEvent(req, {
      event_type: 'access.vehicle.blacklisted',
      property_id: result.vehicle.property_id,
      vehicle_id: result.vehicle.id,
      plate_number: result.vehicle.plate_number,
    });
    res.json({ vehicle: result.vehicle });
  } catch (err) {
    if (sendScopeError(res, err)) return;
    if (sendServiceError(res, err)) return;
    if (err && err.code === '23514') return res.status(400).json({ error: 'flag conflict' });
    next(err);
  }
});

// ─── POST /api/v1/vehicles/:id/clear-flags ───────────────────────────────────
router.post('/:id/clear-flags', async (req, res, next) => {
  try {
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid vehicle id' });
    const propertyId = await loadVehicleProperty(req, req.params.id);
    if (!isPropertyAdmin(req, propertyId)) return res.status(403).json({ error: 'Forbidden' });
    const result = await clearVehicleFlags({ queryable: getDb(req), vehicleId: req.params.id, propertyId });
    auditLog(req, {
      propertyId: result.vehicle.property_id,
      action: 'vehicle.flags_cleared',
      resourceType: 'vehicle',
      resourceId: result.vehicle.id,
      changes: null,
    });
    emitAccessEvent(req, {
      event_type: 'access.vehicle.flags_cleared',
      property_id: result.vehicle.property_id,
      vehicle_id: result.vehicle.id,
      plate_number: result.vehicle.plate_number,
    });
    res.json({ vehicle: result.vehicle });
  } catch (err) {
    if (sendScopeError(res, err)) return;
    if (sendServiceError(res, err)) return;
    next(err);
  }
});

// ─── DELETE /api/v1/vehicles/:id ─────────────────────────────────────────────
// Hard delete разрешён только если на авто нет истории (passes/access_requests).
// Если есть — отказываем 409 (сервис отдельно решает, переводить ли в
// «архивный» owner_type='guest' — отложено в BACKLOG на Фазу 4).
router.delete('/:id', async (req, res, next) => {
  try {
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid vehicle id' });
    const propertyId = await loadVehicleProperty(req, req.params.id);
    const adminForVehicle = isPropertyAdmin(req, propertyId);
    if (isAdmin(req) && !adminForVehicle) return res.status(403).json({ error: 'Forbidden' });
    await deleteVehicle({
      queryable: getDb(req),
      user: req.user,
      isPropertyAdmin: adminForVehicle,
      vehicleId: req.params.id,
      propertyId,
    });
    auditLog(req, {
      propertyId,
      action: 'vehicle.deleted',
      resourceType: 'vehicle',
      resourceId: req.params.id,
      changes: null,
    });
    res.status(204).end();
  } catch (err) {
    if (sendScopeError(res, err)) return;
    if (sendServiceError(res, err)) return;
    if (err && err.code === '23503') return res.status(409).json({ error: 'Cannot delete: FK constraint' });
    next(err);
  }
});

module.exports = router;
