'use strict';

// platform-v1 Access-Requests route — /api/v1/access-requests (+ approvals).
// Spec: docs/product/specs/platform-v1/access-requests-spec.md
// Phase: 3 (Access-core).
//
// Заявка на доступ: резидент/staff/contractor просит пропустить
// гостя/авто/курьера в конкретное окно.  Жизненный цикл:
//   new → pending_approval → approved | rejected | cancelled | expired
//
// Отличие от legacy `requests`: access и service разделены; заявки не
// используются как монолит-таблица задач УК.  Service-request модель будет
// добавлена в Фазе 6.
//
// Ключевой инвариант: переход `approve` ДОЛЖЕН быть транзакционным — либо
// одновременно пишется access_approvals row, статус заявки = 'approved' и
// создаётся пасс, либо откатываем всё (acceptance §6).

const express = require('express');
const db = require('../../db');
const logger = require('../../logger');
const requireAuth = require('../../middleware/auth');
const { isStaff, isAdmin } = require('../lib/authz');

const router = express.Router();
router.use(requireAuth);

// SEC [AUDIT #1] — per-tenant pool, см. комментарий в structure.js.
// У `req.db` (pg.Pool, приходит из propertyDbMiddleware) метод .connect()
// есть сразу, у legacy-модуля db — только через db.pool.  getTxPool
// нормализует это для BEGIN/ROLLBACK транзакций.
const getDb = (req) => req.db || db;
const getTxPool = (req) => (typeof req.db?.connect === 'function' ? req.db : db.pool);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CREATOR_TYPES = new Set(['resident', 'staff', 'contractor']);
const REQUEST_TYPES = new Set([
  'guest_access', 'vehicle_access', 'contractor_access',
  'courier_access', 'service_access', 'temporary_resident_access',
]);

// Маппинг request_type → pass_type, когда заявка одобрена.
const REQUEST_TO_PASS_TYPE = Object.freeze({
  guest_access: 'guest',
  vehicle_access: 'vehicle',
  contractor_access: 'contractor',
  courier_access: 'courier',
  service_access: 'service',
  temporary_resident_access: 'guest',
});

const TERMINAL_STATUSES = new Set(['rejected', 'cancelled', 'expired']);

function isValidUuid(v) { return typeof v === 'string' && UUID_RE.test(v); }
// Shim под legacy callsite: isPropertyAdmin → isAdmin из authz.
const isPropertyAdmin = isAdmin;
function isValidIso(v) { return typeof v === 'string' && !Number.isNaN(Date.parse(v)); }

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
  ).catch((err) => logger.warn({ err, action }, '[v1/access-requests] audit write failed'));
}

const AR_COLS = `
  id, property_id, created_by_type,
  created_by_resident_id, created_by_staff_id, created_by_contractor_user_id,
  request_type, visitor_name, visitor_phone, vehicle_id,
  target_zone_id, target_point_id, target_unit_id,
  reason, starts_at, ends_at, status, approval_required,
  approved_at, rejected_at, cancelled_at, created_at, updated_at
`;

// ─── GET /api/v1/access-requests ─────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const filters = [];
    const params = [];

    // Резиденты могут видеть только свои; staff — все в property.
    if (!isStaff(req.user.role)) {
      params.push(req.user.uid);
      filters.push(`created_by_resident_id = $${params.length}`);
    }
    if (req.query.status) {
      params.push(String(req.query.status));
      filters.push(`status = $${params.length}`);
    }
    if (req.query.created_by_resident_id) {
      if (!isValidUuid(req.query.created_by_resident_id)) {
        return res.status(400).json({ error: 'Invalid created_by_resident_id' });
      }
      params.push(req.query.created_by_resident_id);
      filters.push(`created_by_resident_id = $${params.length}`);
    }
    if (req.query.request_type) {
      if (!REQUEST_TYPES.has(req.query.request_type)) {
        return res.status(400).json({ error: 'Invalid request_type' });
      }
      params.push(req.query.request_type);
      filters.push(`request_type = $${params.length}`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const { rows } = await getDb(req).query(
      `SELECT ${AR_COLS} FROM access_requests ${where}
        ORDER BY created_at DESC LIMIT 500`,
      params,
    );
    res.json({ access_requests: rows });
  } catch (err) { next(err); }
});

// ─── GET /api/v1/access-requests/:id ─────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const { rows } = await getDb(req).query(`SELECT ${AR_COLS} FROM access_requests WHERE id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Access request not found' });
    const ar = rows[0];

    // Visibility: staff — всё; резидент — только своё.
    if (!isStaff(req.user.role) && ar.created_by_resident_id !== req.user.uid) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const approvalsP = getDb(req).query(
      `SELECT id, approver_type, approver_staff_id, approver_resident_id,
              decision, comment, created_at
         FROM access_approvals
        WHERE access_request_id = $1
        ORDER BY created_at ASC`,
      [req.params.id],
    );
    const passP = getDb(req).query(
      `SELECT id, pass_type, status, valid_from, valid_until
         FROM passes WHERE access_request_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [req.params.id],
    );
    const [approvalsR, passR] = await Promise.all([approvalsP, passP]);
    res.json({
      access_request: ar,
      approvals: approvalsR.rows,
      pass: passR.rows[0] || null,
    });
  } catch (err) { next(err); }
});

// ─── POST /api/v1/access-requests ────────────────────────────────────────────
// Создание.  Резидент создаёт как себя; staff — от имени любого; contractor
// пока не создаёт через этот endpoint в v1 (см. BACKLOG Фаза 4).
router.post('/', async (req, res, next) => {
  try {
    const {
      property_id, request_type,
      visitor_name = null, visitor_phone = null, vehicle_id = null,
      target_unit_id = null, target_zone_id = null, target_point_id = null,
      reason = null,
      starts_at, ends_at,
      approval_required = true,
    } = req.body || {};

    if (!isValidUuid(property_id)) return res.status(400).json({ error: 'property_id must be UUID' });
    if (!REQUEST_TYPES.has(request_type)) return res.status(400).json({ error: 'Invalid request_type' });
    if (!isValidIso(starts_at) || !isValidIso(ends_at)) {
      return res.status(400).json({ error: 'starts_at and ends_at must be ISO-8601 strings' });
    }
    if (new Date(ends_at) <= new Date(starts_at)) {
      return res.status(400).json({ error: 'ends_at must be after starts_at' });
    }
    for (const [k, v] of [['vehicle_id', vehicle_id], ['target_unit_id', target_unit_id],
                          ['target_zone_id', target_zone_id], ['target_point_id', target_point_id]]) {
      if (v !== null && !isValidUuid(v)) return res.status(400).json({ error: `${k} must be UUID or null` });
    }

    // Определяем creator.  Без Phase-7 v1-auth — role='admin' становится staff-создателем,
    // всё остальное — resident.  В v1 contractor не создаёт через HTTP (Backlog Фаза 4).
    let created_by_type;
    let created_by_resident_id = null;
    let created_by_staff_id = null;
    const created_by_contractor_user_id = null;
    if (isStaff(req.user.role)) {
      created_by_type = 'staff';
      created_by_staff_id = req.user.uid;
    } else {
      created_by_type = 'resident';
      created_by_resident_id = req.user.uid;
    }
    if (!CREATOR_TYPES.has(created_by_type)) {
      return res.status(400).json({ error: 'Unsupported creator' });
    }

    // vehicle_access: vehicle_id обязателен.
    if (request_type === 'vehicle_access' && !vehicle_id) {
      return res.status(400).json({ error: 'vehicle_access requires vehicle_id' });
    }
    // guest_access/courier_access: visitor_name рекомендуется (не enforce сейчас).
    if (visitor_name !== null && typeof visitor_name !== 'string') return res.status(400).json({ error: 'visitor_name must be string or null' });
    if (visitor_phone !== null && typeof visitor_phone !== 'string') return res.status(400).json({ error: 'visitor_phone must be string or null' });
    if (reason !== null && typeof reason !== 'string') return res.status(400).json({ error: 'reason must be string or null' });

    const { rows } = await getDb(req).query(
      `INSERT INTO access_requests
         (property_id, created_by_type,
          created_by_resident_id, created_by_staff_id, created_by_contractor_user_id,
          request_type, visitor_name, visitor_phone, vehicle_id,
          target_zone_id, target_point_id, target_unit_id,
          reason, starts_at, ends_at, approval_required)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING ${AR_COLS}`,
      [
        property_id, created_by_type,
        created_by_resident_id, created_by_staff_id, created_by_contractor_user_id,
        request_type, visitor_name, visitor_phone, vehicle_id,
        target_zone_id, target_point_id, target_unit_id,
        reason, starts_at, ends_at, !!approval_required,
      ],
    );
    auditLog(req, {
      action: 'access_request.created',
      resourceType: 'access_request',
      resourceId: rows[0].id,
      changes: { request_type, starts_at, ends_at },
    });
    res.status(201).json({ access_request: rows[0] });
  } catch (err) {
    if (err && err.code === '23503') return res.status(400).json({ error: 'referenced entity does not exist' });
    if (err && err.code === '23514') return res.status(400).json({ error: 'access_request constraint violation' });
    next(err);
  }
});

// ─── POST /api/v1/access-requests/:id/submit ─────────────────────────────────
// new → pending_approval.  Делает creator; staff тоже допустим.
router.post('/:id/submit', async (req, res, next) => {
  try {
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const { rows: curRows } = await getDb(req).query(
      `SELECT status, created_by_resident_id FROM access_requests WHERE id = $1`,
      [req.params.id],
    );
    if (!curRows[0]) return res.status(404).json({ error: 'Access request not found' });
    if (!isStaff(req.user.role) && curRows[0].created_by_resident_id !== req.user.uid) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (curRows[0].status !== 'new') {
      return res.status(409).json({ error: `Cannot submit from status '${curRows[0].status}'` });
    }
    const { rows } = await getDb(req).query(
      `UPDATE access_requests SET status = 'pending_approval', updated_at = NOW()
         WHERE id = $1 RETURNING ${AR_COLS}`,
      [req.params.id],
    );
    auditLog(req, {
      action: 'access_request.submitted',
      resourceType: 'access_request',
      resourceId: req.params.id,
      changes: null,
    });
    res.json({ access_request: rows[0] });
  } catch (err) { next(err); }
});

// ─── POST /api/v1/access-requests/:id/approve ────────────────────────────────
// Транзакция: access_approvals INSERT + access_requests UPDATE + passes INSERT.
router.post('/:id/approve', async (req, res, next) => {
  if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });

  const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim() : null;
  const client = await getTxPool(req).connect();
  try {
    await client.query('BEGIN');
    const { rows: arRows } = await client.query(
      `SELECT id, property_id, request_type, vehicle_id, starts_at, ends_at, status
         FROM access_requests WHERE id = $1 FOR UPDATE`,
      [req.params.id],
    );
    if (!arRows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Access request not found' });
    }
    const ar = arRows[0];
    if (TERMINAL_STATUSES.has(ar.status) || ar.status === 'approved') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Cannot approve from status '${ar.status}'` });
    }

    await client.query(
      `INSERT INTO access_approvals
         (access_request_id, approver_type, approver_staff_id, decision, comment)
       VALUES ($1, 'staff', $2, 'approved', $3)`,
      [ar.id, req.user.uid, comment],
    );
    const { rows: updatedArRows } = await client.query(
      `UPDATE access_requests
          SET status = 'approved', approved_at = NOW(), updated_at = NOW()
        WHERE id = $1
        RETURNING ${AR_COLS}`,
      [ar.id],
    );

    // Создаём pass.  subject — vehicle (если есть vehicle_id) или guest.
    const passType = REQUEST_TO_PASS_TYPE[ar.request_type];
    let subjectType; let subjectVehicleId = null;
    if (ar.vehicle_id) {
      subjectType = 'vehicle';
      subjectVehicleId = ar.vehicle_id;
    } else {
      subjectType = 'guest';
    }
    const { rows: passRows } = await client.query(
      `INSERT INTO passes
         (property_id, access_request_id, pass_type, subject_type, subject_vehicle_id,
          valid_from, valid_until, status, approved_by_staff_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8)
       RETURNING id, pass_type, status, valid_from, valid_until`,
      [ar.property_id, ar.id, passType, subjectType, subjectVehicleId,
       ar.starts_at, ar.ends_at, req.user.uid],
    );

    await client.query('COMMIT');
    auditLog(req, {
      action: 'access_request.approved',
      resourceType: 'access_request',
      resourceId: ar.id,
      changes: { pass_id: passRows[0].id },
    });
    res.json({ access_request: updatedArRows[0], pass: passRows[0] });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    if (err && err.code === '23514') return res.status(400).json({ error: 'constraint violation during approve' });
    next(err);
  } finally {
    client.release();
  }
});

// ─── POST /api/v1/access-requests/:id/reject ─────────────────────────────────
router.post('/:id/reject', async (req, res, next) => {
  if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const comment = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (!comment) return res.status(400).json({ error: 'reason is required' });

  const client = await getTxPool(req).connect();
  try {
    await client.query('BEGIN');
    const { rows: curRows } = await client.query(
      `SELECT status FROM access_requests WHERE id = $1 FOR UPDATE`,
      [req.params.id],
    );
    if (!curRows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Access request not found' });
    }
    if (TERMINAL_STATUSES.has(curRows[0].status) || curRows[0].status === 'approved') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Cannot reject from status '${curRows[0].status}'` });
    }
    await client.query(
      `INSERT INTO access_approvals
         (access_request_id, approver_type, approver_staff_id, decision, comment)
       VALUES ($1, 'staff', $2, 'rejected', $3)`,
      [req.params.id, req.user.uid, comment],
    );
    const { rows } = await client.query(
      `UPDATE access_requests
          SET status = 'rejected', rejected_at = NOW(), updated_at = NOW()
        WHERE id = $1 RETURNING ${AR_COLS}`,
      [req.params.id],
    );
    await client.query('COMMIT');
    auditLog(req, {
      action: 'access_request.rejected',
      resourceType: 'access_request',
      resourceId: req.params.id,
      changes: { reason: comment },
    });
    res.json({ access_request: rows[0] });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    next(err);
  } finally {
    client.release();
  }
});

// ─── POST /api/v1/access-requests/:id/cancel ─────────────────────────────────
// Отмена создателем (или property_admin).  Terminal после вызова.
//
// AUDIT #3: BEGIN + SELECT FOR UPDATE, как в approve/reject — иначе два
// одновременных cancel (или approve+cancel) могут оба прочитать 'pending',
// оба сделать UPDATE, и мы получим поломанный audit-trail ("cancelled после
// approved" — читается как пост-фактум отмена, хотя на самом деле race).
router.post('/:id/cancel', async (req, res, next) => {
  if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const pool = getDb(req);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: curRows } = await client.query(
      `SELECT status, created_by_resident_id
         FROM access_requests WHERE id = $1 FOR UPDATE`,
      [req.params.id],
    );
    if (!curRows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Access request not found' });
    }
    if (!isPropertyAdmin(req) && curRows[0].created_by_resident_id !== req.user.uid) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (TERMINAL_STATUSES.has(curRows[0].status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Cannot cancel from status '${curRows[0].status}'` });
    }
    const { rows } = await client.query(
      `UPDATE access_requests
          SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
        WHERE id = $1 RETURNING ${AR_COLS}`,
      [req.params.id],
    );
    await client.query('COMMIT');
    auditLog(req, {
      action: 'access_request.cancelled',
      resourceType: 'access_request',
      resourceId: req.params.id,
      changes: null,
    });
    res.json({ access_request: rows[0] });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    next(err);
  } finally {
    client.release();
  }
});

// ─── POST /api/v1/access-requests/:id/escalate ───────────────────────────────
// Staff просит property_admin'а посмотреть заявку.  Не меняет status заявки —
// пишет только approvals(decision='escalated').
router.post('/:id/escalate', async (req, res, next) => {
  try {
    if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim() : null;
    const { rows: curRows } = await getDb(req).query(
      `SELECT status FROM access_requests WHERE id = $1`,
      [req.params.id],
    );
    if (!curRows[0]) return res.status(404).json({ error: 'Access request not found' });
    if (TERMINAL_STATUSES.has(curRows[0].status) || curRows[0].status === 'approved') {
      return res.status(409).json({ error: `Cannot escalate from status '${curRows[0].status}'` });
    }
    await getDb(req).query(
      `INSERT INTO access_approvals
         (access_request_id, approver_type, approver_staff_id, decision, comment)
       VALUES ($1, 'staff', $2, 'escalated', $3)`,
      [req.params.id, req.user.uid, comment],
    );
    auditLog(req, {
      action: 'access_request.escalated',
      resourceType: 'access_request',
      resourceId: req.params.id,
      changes: { comment },
    });
    res.json({ ok: true, access_request_id: req.params.id });
  } catch (err) { next(err); }
});

module.exports = router;
