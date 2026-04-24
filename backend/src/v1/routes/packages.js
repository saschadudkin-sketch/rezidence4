'use strict';

// platform-v1 packages_v2 HTTP router — Spec: packages-v2-spec.md §4.
//
// Endpoints:
//   GET    /api/v1/packages                      (staff, admin)         list
//   GET    /api/v1/packages/mine                 (resident)             own
//   GET    /api/v1/packages/metrics              (admin)                agg
//   GET    /api/v1/packages/:id                  (resident own | staff) row
//   POST   /api/v1/packages                      (staff, admin)         create
//   PATCH  /api/v1/packages/:id                  (staff, admin)         metadata
//   POST   /api/v1/packages/:id/pickup           (staff, admin)         state→picked_up
//   POST   /api/v1/packages/:id/return           (staff, admin)         state→returned
//   POST   /api/v1/packages/:id/mark-lost        (admin)                state→lost (confirm+reason)
//   POST   /api/v1/packages/:id/remind           (staff, admin)         manual reminder
//
// Порядок маршрутов: специфичные (/mine, /metrics) ПЕРЕД параметрическим /:id
// (иначе express поймает 'mine' как id → 404/400 при UUID-валидации).
//
// Auth mapping (в v1 до Phase-7):
//   - legacy 'admin'            ≙ v1 property_admin (все mutations)
//   - isStaff(role)             ≙ v1 staff (concierge, security, manager) —
//                                  POST + pickup + return + remind + PATCH
//   - legacy 'resident'         ≙ v1 resident (видит только свои)
// Capability-matrix spec §4:
//   mark-lost  — только property_admin
//   всё остальное mutation — staff + admin

const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../../db');
const logger = require('../../logger');
const requireAuth = require('../../middleware/auth');
const {
  isAdmin,
  isStaffOrAdmin,
  isResidentUser,
  requireCapability,
} = require('../lib/authz');
const {
  listForTenant,
  listForResident,
  getById,
  createPackage,
  updatePackage,
  pickupPackage,
  returnPackage,
  markLostPackage,
  remindPackage,
  getMetrics,
  resolveResidentByUid,
  resolveStaffIdByUid,
  resolveUnitIdsForResident,
} = require('../services/packages');

const router = express.Router();
router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUuid(v) { return typeof v === 'string' && UUID_RE.test(v); }
// Shim: legacy callsites ожидают `isResident(req)`.
const isResident = isResidentUser;

// ─── Rate limiters (spec §4) ─────────────────────────────────────────────────
// Защищены от спама: POST /packages 30/min, POST /:id/remind 1/hour per-package.
// Per-package ключ для remind'а: IP + :id комбо (чтобы разные посылки не
// блокировали друг друга).  windowMs=3600000, max=1.
const createLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.user?.uid || req.ip),
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Слишком много посылок. Попробуйте позже.' } },
});
const remindLimiter = rateLimit({
  windowMs: 60 * 60_000,
  max: 1,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.user?.uid || req.ip}:${req.params?.id || '_'}`,
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Напоминание уже отправлено. Подождите час.' } },
});

function audit(req, action, resourceId, changes) {
  // SEC [AUDIT #1]: audit остаётся на singleton db.query (не req.db).
  //   • Single-tenant go-live: DATABASE_URL === tenant DB → корректно.
  //   • Multi-tenant post-launch: TODO — мигрировать на req.db, когда подключён
  //     второй property и надо гарантировать tenant-isolated audit_log.
  //   • Сохранили именно db.query (не db.pool.query), чтобы тесты видели
  //     mockDb.query с default mockResolvedValue({rows:[]}) — иначе
  //     .catch() на undefined из mockPool.query ломает handler.
  db.query(
    `INSERT INTO audit_log
       (actor_uid, actor_role, action, resource_type, resource_id, changes, ip_address)
     VALUES ($1,$2,$3,'package',$4,$5,$6)`,
    [
      req.user?.uid || null,
      req.user?.role || null,
      action,
      resourceId,
      changes ? JSON.stringify(changes) : null,
      req.ip || null,
    ],
  ).catch((err) => logger.warn({ err, action }, '[v1/packages] audit write failed'));
}

// ─── GET /api/v1/packages/mine (resident) ────────────────────────────────────
// ВАЖНО: должен быть ПЕРЕД /:id.
router.get('/mine', async (req, res) => {
  if (!isResident(req)) return res.status(403).json({ error: 'Residents only' });
  const pool = req.db || db.pool;
  try {
    const residentId = await resolveResidentByUid(pool, req.user.uid);
    if (!residentId) return res.json({ ok: true, packages: [], count: 0 });
    const unitIds = await resolveUnitIdsForResident(pool, residentId);
    const rows = await listForResident(pool, residentId, unitIds, { limit: req.query.limit });
    return res.json({ ok: true, packages: rows, count: rows.length });
  } catch (err) {
    logger.error({ err }, '[v1/packages] mine query failed');
    return res.status(503).json({ ok: false, error: err.message });
  }
});

// ─── GET /api/v1/packages/metrics (admin) ────────────────────────────────────
router.get('/metrics',
  requireCapability('packages:manage', { message: 'Admin only' }),
  async (req, res) => {
  const periods = { '24h': 24, '7d': 24 * 7, '30d': 24 * 30 };
  const period = String(req.query.period || '7d');
  const hours = periods[period];
  if (!hours) return res.status(400).json({ error: `Invalid period. Allowed: ${Object.keys(periods).join(', ')}` });

  const pool = req.db || db.pool;
  try {
    const snapshot = await getMetrics(pool, hours);
    return res.json({ ok: true, period, ...snapshot });
  } catch (err) {
    logger.error({ err }, '[v1/packages] metrics query failed');
    return res.status(503).json({ ok: false, error: err.message });
  }
});

// ─── GET /api/v1/packages (staff, admin) ─────────────────────────────────────
router.get('/', async (req, res) => {
  if (!isStaffOrAdmin(req)) return res.status(403).json({ error: 'Staff or admin required' });
  const pool = req.db || db.pool;
  try {
    const result = await listForTenant(pool, {
      status: req.query.status,
      unit_id: req.query.unit_id,
      recipient_resident_id: req.query.recipient_resident_id,
      carrier: req.query.carrier,
      since: req.query.since,
      until: req.query.until,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    return res.json({
      ok: true,
      packages: result.rows,
      limit: result.limit,
      offset: result.offset,
      count: result.rows.length,
    });
  } catch (err) {
    if (/^invalid |must be |must be ISO-8601/i.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    logger.error({ err }, '[v1/packages] list query failed');
    return res.status(503).json({ ok: false, error: err.message });
  }
});

// ─── GET /api/v1/packages/:id (resident own | staff) ─────────────────────────
router.get('/:id', async (req, res) => {
  if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const pool = req.db || db.pool;
  try {
    const pkg = await getById(pool, req.params.id);
    if (!pkg) return res.status(404).json({ error: 'Not found' });

    // Visibility: staff — всё; резидент — только свои (по recipient_resident_id
    // или unit_id принадлежит резиденту).
    if (!isStaffOrAdmin(req)) {
      const myResidentId = await resolveResidentByUid(pool, req.user.uid);
      if (!myResidentId) return res.status(403).json({ error: 'Forbidden' });
      const matchesRecipient = pkg.recipient_resident_id === myResidentId;
      if (!matchesRecipient) {
        // Иначе — проверяем юнит: посылка без явного получателя, на мою квартиру.
        const myUnits = await resolveUnitIdsForResident(pool, myResidentId);
        if (pkg.recipient_resident_id !== null || !myUnits.includes(pkg.unit_id)) {
          return res.status(403).json({ error: 'Forbidden' });
        }
      }
    }
    return res.json({ ok: true, package: pkg });
  } catch (err) {
    logger.error({ err }, '[v1/packages] getById query failed');
    return res.status(503).json({ ok: false, error: err.message });
  }
});

// ─── POST /api/v1/packages (staff, admin) ────────────────────────────────────
router.post('/', createLimiter, async (req, res) => {
  if (!isStaffOrAdmin(req)) return res.status(403).json({ error: 'Staff or admin required' });
  const b = req.body || {};
  if (!isValidUuid(b.property_id)) return res.status(400).json({ error: 'property_id must be UUID' });
  if (!isValidUuid(b.unit_id)) return res.status(400).json({ error: 'unit_id must be UUID' });

  const pool = req.db || db.pool;
  try {
    const staffId = await resolveStaffIdByUid(pool, req.user.uid);
    if (!staffId) {
      return res.status(400).json({
        error: 'staff user not registered in staff_users (received_by_staff_id required)',
      });
    }
    const { package: pkg, outboxRows } = await createPackage(pool, {
      propertyId: b.property_id,
      unitId: b.unit_id,
      recipientResidentId: b.recipient_resident_id || null,
      recipientNameSnapshot: b.recipient_name_snapshot || null,
      senderName: b.sender_name || null,
      carrier: b.carrier || null,
      trackingNumber: b.tracking_number || null,
      photoUrl: b.photo_url || null,
      sizeCategory: b.size_category || null,
      receivedByStaffId: staffId,
      storageLocation: b.storage_location || null,
      notes: b.notes || null,
    });
    audit(req, 'package.received', pkg.id, {
      unit_id: pkg.unit_id,
      carrier: pkg.carrier,
      tracking_number: pkg.tracking_number,
      outbox_fanout: outboxRows.length,
    });
    return res.status(201).json({ ok: true, package: pkg, outbox_fanout: outboxRows.length });
  } catch (err) {
    if (/^invalid |must be |must start with/i.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    if (err.code === '23503') return res.status(400).json({ error: 'referenced entity does not exist' });
    if (err.code === '23514') return res.status(400).json({ error: 'packages_v2 constraint violation' });
    logger.error({ err }, '[v1/packages] create failed');
    return res.status(503).json({ ok: false, error: err.message });
  }
});

// ─── PATCH /api/v1/packages/:id (staff, admin) ───────────────────────────────
router.patch('/:id', async (req, res) => {
  if (!isStaffOrAdmin(req)) return res.status(403).json({ error: 'Staff or admin required' });
  if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const pool = req.db || db.pool;
  try {
    const pkg = await updatePackage(pool, req.params.id, req.body || {});
    if (!pkg) return res.status(404).json({ error: 'Not found' });
    audit(req, 'package.updated', pkg.id, req.body || null);
    return res.json({ ok: true, package: pkg });
  } catch (err) {
    if (/^invalid |must start with/i.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    logger.error({ err }, '[v1/packages] update failed');
    return res.status(503).json({ ok: false, error: err.message });
  }
});

// ─── POST /api/v1/packages/:id/pickup ────────────────────────────────────────
router.post('/:id/pickup', async (req, res) => {
  if (!isStaffOrAdmin(req)) return res.status(403).json({ error: 'Staff or admin required' });
  if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const b = req.body || {};
  const pool = req.db || db.pool;
  try {
    const staffId = await resolveStaffIdByUid(pool, req.user.uid);
    if (!staffId) {
      return res.status(400).json({ error: 'staff user not registered in staff_users' });
    }
    const { package: pkg, outboxRows, conflict } = await pickupPackage(pool, req.params.id, {
      pickedUpByResidentId: b.picked_up_by_resident_id || null,
      pickedUpByName: b.picked_up_by_name || null,
      pickedUpByStaffId: staffId,
    });
    if (conflict === 'not_found') return res.status(404).json({ error: 'Not found' });
    if (conflict !== null) {
      return res.status(409).json({ error: `Cannot pickup from status '${conflict}'` });
    }
    audit(req, 'package.picked_up', pkg.id, {
      picked_up_by_resident_id: pkg.picked_up_by_resident_id,
      picked_up_by_name: pkg.picked_up_by_name,
      outbox_fanout: outboxRows.length,
    });
    return res.json({ ok: true, package: pkg, outbox_fanout: outboxRows.length });
  } catch (err) {
    if (/(either |mutually exclusive|must be UUID|invalid )/i.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    logger.error({ err }, '[v1/packages] pickup failed');
    return res.status(503).json({ ok: false, error: err.message });
  }
});

// ─── POST /api/v1/packages/:id/return ────────────────────────────────────────
router.post('/:id/return', async (req, res) => {
  if (!isStaffOrAdmin(req)) return res.status(403).json({ error: 'Staff or admin required' });
  if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const pool = req.db || db.pool;
  try {
    const { package: pkg, conflict } = await returnPackage(pool, req.params.id, req.body || {});
    if (conflict === 'not_found') return res.status(404).json({ error: 'Not found' });
    if (conflict !== null) {
      return res.status(409).json({ error: `Cannot return from status '${conflict}'` });
    }
    audit(req, 'package.returned', pkg.id, { reason: pkg.returned_reason });
    return res.json({ ok: true, package: pkg });
  } catch (err) {
    logger.error({ err }, '[v1/packages] return failed');
    return res.status(503).json({ ok: false, error: err.message });
  }
});

// ─── POST /api/v1/packages/:id/mark-lost (admin) ─────────────────────────────
router.post('/:id/mark-lost',
  requireCapability('packages:manage', { message: 'Admin only' }),
  async (req, res) => {
  if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const pool = req.db || db.pool;
  try {
    const { package: pkg, conflict } = await markLostPackage(pool, req.params.id, req.body || {});
    if (conflict === 'not_found') return res.status(404).json({ error: 'Not found' });
    if (conflict !== null) {
      return res.status(409).json({ error: `Cannot mark-lost from status '${conflict}'` });
    }
    audit(req, 'package.marked_lost', pkg.id, {
      reason: pkg.returned_reason,
      confirmed_by: req.user.uid,
    });
    return res.json({ ok: true, package: pkg });
  } catch (err) {
    if (/^(confirm|reason)/i.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    logger.error({ err }, '[v1/packages] mark-lost failed');
    return res.status(503).json({ ok: false, error: err.message });
  }
});

// ─── POST /api/v1/packages/:id/remind ────────────────────────────────────────
router.post('/:id/remind', remindLimiter, async (req, res) => {
  if (!isStaffOrAdmin(req)) return res.status(403).json({ error: 'Staff or admin required' });
  if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const pool = req.db || db.pool;
  try {
    const { package: pkg, outboxRows, conflict } = await remindPackage(pool, req.params.id);
    if (conflict === 'not_found') return res.status(404).json({ error: 'Not found' });
    if (conflict !== null) {
      return res.status(409).json({ error: `Cannot remind from status '${conflict}'` });
    }
    audit(req, 'package.reminded', pkg.id, { outbox_fanout: outboxRows.length });
    return res.json({ ok: true, package: pkg, outbox_fanout: outboxRows.length });
  } catch (err) {
    logger.error({ err }, '[v1/packages] remind failed');
    return res.status(503).json({ ok: false, error: err.message });
  }
});

module.exports = router;
