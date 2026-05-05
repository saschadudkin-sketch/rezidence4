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
const requireAuth = require('../../middleware/auth');
const idempotency = require('../../middleware/idempotency');
const { isStaff, isAdmin } = require('../lib/authz');
const { normalizePlate } = require('../lib/normalizePlate');
const { parsePaginationParams, buildPageMeta } = require('../lib/pagination');
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
// Shim под legacy callsite — isPropertyAdmin = isAdmin из authz.
const isPropertyAdmin = isAdmin;

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
  ).catch((err) => logger.warn({ err, action }, '[v1/vehicles] audit write failed'));
}

function sendServiceError(res, err) {
  if (!isVehicleServiceError(err)) return false;
  const body = { error: err.message };
  if (err.details) Object.assign(body, err.details);
  res.status(err.status).json(body);
  return true;
}

// ─── GET /api/v1/vehicles ────────────────────────────────────────────────────
// Pagination: ?limit=1..200 (default 50), ?offset=0..100000 (default 0)
router.get('/', async (req, res, next) => {
  try {
    if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Forbidden' });

    let pagination;
    try {
      pagination = parsePaginationParams(req.query);
    } catch (rangeErr) {
      return res.status(400).json({ error: rangeErr.message });
    }

    const filters = [];
    const params = [];
    if (req.query.plate) {
      params.push(normalizePlate(String(req.query.plate)));
      filters.push(`plate_number = $${params.length}`);
    }
    if (req.query.owner_resident_id) {
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
    const normalized = normalizePlate(req.params.plate);
    if (!normalized) return res.status(400).json({ error: 'Invalid plate' });
    const { rows } = await getDb(req).query(
      `SELECT ${VEHICLE_COLS} FROM vehicles WHERE plate_number = $1`,
      [normalized],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Vehicle not found', plate: normalized });
    res.json({ vehicle: rows[0] });
  } catch (err) { next(err); }
});

// ─── GET /api/v1/vehicles/:id ────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid vehicle id' });
    const { rows } = await getDb(req).query(
      `SELECT ${VEHICLE_COLS} FROM vehicles WHERE id = $1`,
      [req.params.id],
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

    const result = await createVehicle({
      queryable: getDb(req),
      user: req.user,
      isPropertyAdmin: isPropertyAdmin(req),
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
// Редактирование (color/brand/model/notes/vehicle_type) — не трогаем owner/plate.
router.patch('/:id', async (req, res, next) => {
  try {
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid vehicle id' });

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
      isPropertyAdmin: isPropertyAdmin(req),
      vehicleId: req.params.id,
      changes,
    });
    auditLog(req, { action: 'vehicle.updated', resourceType: 'vehicle', resourceId: result.vehicle.id, changes });
    res.json({ vehicle: result.vehicle });
  } catch (err) {
    if (sendServiceError(res, err)) return;
    next(err);
  }
});

// ─── POST /api/v1/vehicles/:id/whitelist ─────────────────────────────────────
router.post('/:id/whitelist', async (req, res, next) => {
  try {
    if (!isPropertyAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid vehicle id' });
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : null;
    const result = await whitelistVehicle({ queryable: getDb(req), vehicleId: req.params.id });
    auditLog(req, {
      action: 'vehicle.whitelisted',
      resourceType: 'vehicle',
      resourceId: result.vehicle.id,
      changes: { reason },
    });
    res.json({ vehicle: result.vehicle });
  } catch (err) {
    if (sendServiceError(res, err)) return;
    if (err && err.code === '23514') return res.status(400).json({ error: 'flag conflict' });
    next(err);
  }
});

// ─── POST /api/v1/vehicles/:id/blacklist ─────────────────────────────────────
router.post('/:id/blacklist', async (req, res, next) => {
  try {
    if (!isPropertyAdmin(req) && req.user?.role !== 'security') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid vehicle id' });
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : null;
    if (!reason) return res.status(400).json({ error: 'reason is required' });
    const result = await blacklistVehicle({ queryable: getDb(req), vehicleId: req.params.id });
    auditLog(req, {
      action: 'vehicle.blacklisted',
      resourceType: 'vehicle',
      resourceId: result.vehicle.id,
      changes: { reason },
    });
    res.json({ vehicle: result.vehicle });
  } catch (err) {
    if (sendServiceError(res, err)) return;
    if (err && err.code === '23514') return res.status(400).json({ error: 'flag conflict' });
    next(err);
  }
});

// ─── POST /api/v1/vehicles/:id/clear-flags ───────────────────────────────────
router.post('/:id/clear-flags', async (req, res, next) => {
  try {
    if (!isPropertyAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid vehicle id' });
    const result = await clearVehicleFlags({ queryable: getDb(req), vehicleId: req.params.id });
    auditLog(req, {
      action: 'vehicle.flags_cleared',
      resourceType: 'vehicle',
      resourceId: result.vehicle.id,
      changes: null,
    });
    res.json({ vehicle: result.vehicle });
  } catch (err) {
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
    await deleteVehicle({
      queryable: getDb(req),
      user: req.user,
      isPropertyAdmin: isPropertyAdmin(req),
      vehicleId: req.params.id,
    });
    auditLog(req, {
      action: 'vehicle.deleted',
      resourceType: 'vehicle',
      resourceId: req.params.id,
      changes: null,
    });
    res.status(204).end();
  } catch (err) {
    if (sendServiceError(res, err)) return;
    if (err && err.code === '23503') return res.status(409).json({ error: 'Cannot delete: FK constraint' });
    next(err);
  }
});

module.exports = router;
