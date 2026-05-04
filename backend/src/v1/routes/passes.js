'use strict';

// platform-v1 Passes route — /api/v1/passes.
// Spec: docs/product/specs/platform-v1/passes-spec.md
// Phase: 3 (Access-core).
//
// Пропуск как first-class entity: временной bounded grant на проход/проезд.
// В legacy пропуск был неявный (`requests WHERE type IN ('pass','car')` + FK из
// `qr_passes.request_id`).  Здесь `passes` — отдельная таблица, `qr_passes_v2`
// держит только QR-представление (token + render_version).
//
// State: active → used | expired | revoked | blocked (см. spec §3).
// Все mutations — с audit_log записью.
//
// Verify scan (проверка token при въезде) — вынесен в visits.js маршруту
// `POST /api/v1/visits/verify`, т.к. scan создаёт visit_log event, и
// семантика «event-первый» помогает читать код.

const crypto = require('crypto');
const express = require('express');
const db = require('../../db');
const logger = require('../../logger');
const requireAuth = require('../../middleware/auth');
const idempotency = require('../../middleware/idempotency');
const { isStaff, isAdmin, isSecurity: isSecurityAuthz } = require('../lib/authz');
const { parsePaginationParams, buildPageMeta } = require('../lib/pagination');
const {
  resolveResidentIdByUid,
  resolveStaffIdByUid,
} = require('../services/accessActorResolver');

const router = express.Router();
router.use(requireAuth);

// SEC [AUDIT #1] — per-tenant pool, см. комментарий в structure.js.
const getDb = (req) => req.db || db;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PASS_TYPES = new Set([
  'guest', 'vehicle', 'resident', 'staff',
  'contractor', 'courier', 'service', 'emergency',
]);
const SUBJECT_TYPES = new Set([
  'resident', 'staff', 'contractor_user', 'vehicle', 'guest',
]);
const TERMINAL_STATUSES = new Set(['expired', 'revoked']);

function isValidUuid(v) { return typeof v === 'string' && UUID_RE.test(v); }
// Shim'ы под legacy callsites:
const isPropertyAdmin = isAdmin;
const isSecurity = isSecurityAuthz;
function isValidIso(v) { return typeof v === 'string' && !Number.isNaN(Date.parse(v)); }

async function canReadPass(req, pass) {
  if (isStaff(req.user.role)) return true;
  const residentId = await resolveResidentIdByUid(getDb(req), req.user?.uid);
  if (!residentId) return false;
  if (pass.subject_resident_id === residentId) return true;
  if (!pass.access_request_id) return false;

  const { rows } = await getDb(req).query(
    `SELECT 1
       FROM access_requests
      WHERE id = $1
        AND created_by_resident_id = $2
      LIMIT 1`,
    [pass.access_request_id, residentId],
  );
  return rows.length > 0;
}

function newToken() {
  // 32 hex chars = 128 bits of entropy.  Enough to prevent brute-force for
  // active-pass lookup window (we also require property match on verify).
  return crypto.randomBytes(16).toString('hex');
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
  ).catch((err) => logger.warn({ err, action }, '[v1/passes] audit write failed'));
}

const PASS_COLS = `
  id, property_id, access_request_id, pass_type, subject_type,
  subject_resident_id, subject_staff_id, subject_contractor_user_id, subject_vehicle_id,
  zone_id, point_id, policy_id,
  valid_from, valid_until, status,
  approved_by_staff_id, revoked_at, revoked_by_staff_id, revoked_reason, created_at
`;

// Validation helper: ensures subject_type/subject_*_id pair is consistent before
// hitting DB CHECK (lets us return 400 vs 500 on violation).
function validateSubject({ subject_type, subject_resident_id, subject_staff_id,
                           subject_contractor_user_id, subject_vehicle_id }) {
  const ids = {
    resident: subject_resident_id,
    staff: subject_staff_id,
    contractor_user: subject_contractor_user_id,
    vehicle: subject_vehicle_id,
  };
  const triple = [subject_resident_id, subject_staff_id, subject_contractor_user_id, subject_vehicle_id];
  if (subject_type === 'guest') {
    return triple.every((v) => v === null || v === undefined)
      ? null
      : 'subject_*_id must all be null for subject_type=guest';
  }
  const expectId = ids[subject_type];
  if (!expectId) return `subject_${subject_type}_id is required for subject_type=${subject_type}`;
  const others = Object.entries(ids).filter(([k]) => k !== subject_type);
  for (const [k, v] of others) {
    if (v) return `subject_${k}_id must be null for subject_type=${subject_type}`;
  }
  return null;
}

// ─── GET /api/v1/passes ──────────────────────────────────────────────────────
// Pagination: ?limit=1..200 (default 50), ?offset=0..100000 (default 0).
// Response: { passes: [...], page: { limit, offset, hasMore } } —
// `passes` сохраняется (back-compat), `page` — additive.
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
    if (req.query.status) {
      params.push(String(req.query.status));
      filters.push(`status = $${params.length}`);
    }
    if (req.query.pass_type) {
      if (!PASS_TYPES.has(req.query.pass_type)) return res.status(400).json({ error: 'Invalid pass_type' });
      params.push(req.query.pass_type);
      filters.push(`pass_type = $${params.length}`);
    }
    if (req.query.subject_vehicle_id) {
      if (!isValidUuid(req.query.subject_vehicle_id)) return res.status(400).json({ error: 'Invalid subject_vehicle_id' });
      params.push(req.query.subject_vehicle_id);
      filters.push(`subject_vehicle_id = $${params.length}`);
    }
    if (req.query.access_request_id) {
      if (!isValidUuid(req.query.access_request_id)) return res.status(400).json({ error: 'Invalid access_request_id' });
      params.push(req.query.access_request_id);
      filters.push(`access_request_id = $${params.length}`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    params.push(pagination.limit);
    const limitIdx = params.length;
    params.push(pagination.offset);
    const offsetIdx = params.length;

    const { rows } = await getDb(req).query(
      `SELECT ${PASS_COLS} FROM passes ${where}
        ORDER BY created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );
    res.json({
      passes: rows,
      page: buildPageMeta({ ...pagination, returnedCount: rows.length }),
    });
  } catch (err) { next(err); }
});

// ─── GET /api/v1/passes/:id ──────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const { rows } = await getDb(req).query(`SELECT ${PASS_COLS} FROM passes WHERE id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Pass not found' });
    const pass = rows[0];

    // Visibility: staff — all; resident — own subject or request-created pass.
    if (!(await canReadPass(req, pass))) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { rows: qrRows } = await getDb(req).query(
      `SELECT id, token, render_version, created_at FROM qr_passes_v2 WHERE pass_id = $1`,
      [req.params.id],
    );
    res.json({ pass, qr: qrRows[0] || null });
  } catch (err) { next(err); }
});

// ─── GET /api/v1/passes/:id/qr ───────────────────────────────────────────────
// Возвращает актуальный QR-токен.  Создаёт строку qr_passes_v2 если её ещё нет
// (lazy init: пасс мог быть создан до первого запроса QR).
router.get('/:id/qr', async (req, res, next) => {
  try {
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });

    const { rows: passRows } = await getDb(req).query(
      `SELECT id, property_id, access_request_id, subject_resident_id, status FROM passes WHERE id = $1`,
      [req.params.id],
    );
    if (!passRows[0]) return res.status(404).json({ error: 'Pass not found' });
    const pass = passRows[0];

    if (!(await canReadPass(req, pass))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (TERMINAL_STATUSES.has(pass.status)) {
      return res.status(409).json({ error: `Cannot fetch QR for pass in status '${pass.status}'` });
    }

    const { rows: existing } = await getDb(req).query(
      `SELECT id, token, render_version FROM qr_passes_v2 WHERE pass_id = $1`,
      [pass.id],
    );
    if (existing[0]) return res.json({ qr: existing[0] });

    const token = newToken();
    const { rows: created } = await getDb(req).query(
      `INSERT INTO qr_passes_v2 (property_id, pass_id, token)
       VALUES ($1, $2, $3)
       RETURNING id, token, render_version`,
      [pass.property_id, pass.id, token],
    );
    res.json({ qr: created[0] });
  } catch (err) { next(err); }
});

// ─── POST /api/v1/passes/:id/regenerate-qr ───────────────────────────────────
// Резидент потерял экран — генерим новый token, инкрементим render_version.
// Старый token становится невалидным сразу (UNIQUE token enforced).
// Idempotency: повторный POST с тем же Idempotency-Key вернёт кеш — клиент
// не создаст лишний QR при retries (network glitches на мобиле).
router.post('/:id/regenerate-qr', idempotency, async (req, res, next) => {
  try {
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const { rows: passRows } = await getDb(req).query(
      `SELECT id, property_id, access_request_id, subject_resident_id, status FROM passes WHERE id = $1`,
      [req.params.id],
    );
    if (!passRows[0]) return res.status(404).json({ error: 'Pass not found' });
    const pass = passRows[0];
    if (!(await canReadPass(req, pass))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (TERMINAL_STATUSES.has(pass.status)) {
      return res.status(409).json({ error: `Cannot regenerate QR for pass in status '${pass.status}'` });
    }

    const token = newToken();
    const { rows } = await getDb(req).query(
      `INSERT INTO qr_passes_v2 (property_id, pass_id, token)
       VALUES ($1, $2, $3)
       ON CONFLICT (pass_id)
       DO UPDATE SET token = EXCLUDED.token,
                     render_version = qr_passes_v2.render_version + 1,
                     updated_at = NOW()
       RETURNING id, token, render_version`,
      [pass.property_id, pass.id, token],
    );
    auditLog(req, {
      action: 'pass.qr_regenerated',
      resourceType: 'pass',
      resourceId: pass.id,
      changes: { render_version: rows[0].render_version },
    });
    res.json({ qr: rows[0] });
  } catch (err) { next(err); }
});

// ─── POST /api/v1/passes ─────────────────────────────────────────────────────
// Создать pass напрямую (staff/contractor onboarding без промежуточной заявки).
// Для passes из одобренной access_request используется accessRequests.approve,
// не этот endpoint.
// Idempotency: optional Idempotency-Key header — defends against
// double-tap при создании пассов из admin UI.
router.post('/', idempotency, async (req, res, next) => {
  try {
    if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    const {
      property_id, pass_type, subject_type,
      subject_resident_id = null, subject_staff_id = null,
      subject_contractor_user_id = null, subject_vehicle_id = null,
      valid_from, valid_until,
      access_request_id = null,
    } = req.body || {};

    if (!isValidUuid(property_id)) return res.status(400).json({ error: 'property_id must be UUID' });
    if (!PASS_TYPES.has(pass_type)) return res.status(400).json({ error: 'Invalid pass_type' });
    if (!SUBJECT_TYPES.has(subject_type)) return res.status(400).json({ error: 'Invalid subject_type' });
    if (!isValidIso(valid_from) || !isValidIso(valid_until)) {
      return res.status(400).json({ error: 'valid_from and valid_until must be ISO-8601 strings' });
    }
    if (new Date(valid_until) <= new Date(valid_from)) {
      return res.status(400).json({ error: 'valid_until must be after valid_from' });
    }
    const subjErr = validateSubject({
      subject_type, subject_resident_id, subject_staff_id,
      subject_contractor_user_id, subject_vehicle_id,
    });
    if (subjErr) return res.status(400).json({ error: subjErr });
    for (const [k, v] of [
      ['subject_resident_id', subject_resident_id],
      ['subject_staff_id', subject_staff_id],
      ['subject_contractor_user_id', subject_contractor_user_id],
      ['subject_vehicle_id', subject_vehicle_id],
      ['access_request_id', access_request_id],
    ]) {
      if (v !== null && !isValidUuid(v)) return res.status(400).json({ error: `${k} must be UUID or null` });
    }

    const staffId = await resolveStaffIdByUid(getDb(req), req.user.uid);
    if (!staffId) return res.status(403).json({ error: 'Staff identity is not mapped to v1' });

    const { rows } = await getDb(req).query(
      `INSERT INTO passes
         (property_id, access_request_id, pass_type, subject_type,
          subject_resident_id, subject_staff_id, subject_contractor_user_id, subject_vehicle_id,
          valid_from, valid_until, approved_by_staff_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING ${PASS_COLS}`,
      [
        property_id, access_request_id, pass_type, subject_type,
        subject_resident_id, subject_staff_id, subject_contractor_user_id, subject_vehicle_id,
        valid_from, valid_until, staffId,
      ],
    );
    auditLog(req, {
      action: 'pass.created',
      resourceType: 'pass',
      resourceId: rows[0].id,
      changes: { pass_type, subject_type, valid_from, valid_until },
    });
    res.status(201).json({ pass: rows[0] });
  } catch (err) {
    if (err && err.code === '23503') return res.status(400).json({ error: 'referenced entity does not exist' });
    if (err && err.code === '23514') return res.status(400).json({ error: 'pass constraint violation' });
    next(err);
  }
});

// ─── POST /api/v1/passes/:id/revoke ──────────────────────────────────────────
// One-way: revoked — terminal.  reason обязателен (CHECK в БД).
router.post('/:id/revoke', async (req, res, next) => {
  try {
    if (!isPropertyAdmin(req) && req.user?.role !== 'security') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!reason) return res.status(400).json({ error: 'reason is required' });
    const staffId = await resolveStaffIdByUid(getDb(req), req.user.uid);
    if (!staffId) return res.status(403).json({ error: 'Staff identity is not mapped to v1' });

    const { rows: curRows } = await getDb(req).query(
      `SELECT status FROM passes WHERE id = $1`,
      [req.params.id],
    );
    if (!curRows[0]) return res.status(404).json({ error: 'Pass not found' });
    if (curRows[0].status === 'revoked') {
      return res.status(409).json({ error: 'Pass already revoked' });
    }

    const { rows } = await getDb(req).query(
      `UPDATE passes SET
         status = 'revoked',
         revoked_at = NOW(),
         revoked_by_staff_id = $1,
         revoked_reason = $2
      WHERE id = $3
       RETURNING ${PASS_COLS}`,
      [staffId, reason, req.params.id],
    );
    auditLog(req, {
      action: 'pass.revoked',
      resourceType: 'pass',
      resourceId: req.params.id,
      changes: { reason },
    });
    res.json({ pass: rows[0] });
  } catch (err) {
    if (err && err.code === '23514') return res.status(400).json({ error: 'constraint violation on revoke' });
    next(err);
  }
});

// ─── POST /api/v1/passes/:id/block ───────────────────────────────────────────
// Security временно блокирует пасс (подозрительный visitor, дубликат, etc.).
// Можно снять через /unblock.  Не terminal.
router.post('/:id/block', async (req, res, next) => {
  try {
    if (!isSecurity(req)) return res.status(403).json({ error: 'Forbidden' });
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : null;

    const { rows: curRows } = await getDb(req).query(
      `SELECT status FROM passes WHERE id = $1`,
      [req.params.id],
    );
    if (!curRows[0]) return res.status(404).json({ error: 'Pass not found' });
    if (curRows[0].status === 'revoked' || curRows[0].status === 'expired') {
      return res.status(409).json({ error: `Cannot block pass in status '${curRows[0].status}'` });
    }
    const { rows } = await getDb(req).query(
      `UPDATE passes SET status = 'blocked' WHERE id = $1 RETURNING ${PASS_COLS}`,
      [req.params.id],
    );
    auditLog(req, {
      action: 'pass.blocked',
      resourceType: 'pass',
      resourceId: req.params.id,
      changes: { reason },
    });
    res.json({ pass: rows[0] });
  } catch (err) { next(err); }
});

// ─── POST /api/v1/passes/:id/unblock ─────────────────────────────────────────
router.post('/:id/unblock', async (req, res, next) => {
  try {
    if (!isSecurity(req)) return res.status(403).json({ error: 'Forbidden' });
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });

    const { rows: curRows } = await getDb(req).query(
      `SELECT status FROM passes WHERE id = $1`,
      [req.params.id],
    );
    if (!curRows[0]) return res.status(404).json({ error: 'Pass not found' });
    if (curRows[0].status !== 'blocked') {
      return res.status(409).json({ error: `Pass is not blocked (status='${curRows[0].status}')` });
    }
    const { rows } = await getDb(req).query(
      `UPDATE passes SET status = 'active' WHERE id = $1 RETURNING ${PASS_COLS}`,
      [req.params.id],
    );
    auditLog(req, {
      action: 'pass.unblocked',
      resourceType: 'pass',
      resourceId: req.params.id,
      changes: null,
    });
    res.json({ pass: rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
