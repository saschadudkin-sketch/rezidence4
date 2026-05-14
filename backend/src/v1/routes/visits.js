'use strict';

// platform-v1 Visits route — /api/v1/visits.
// Spec: docs/product/specs/platform-v1/visit-logs-spec.md
//       docs/product/specs/platform-v1/qr-verification-spec.md
// Phase: 3 (Access-core).
//
// Append-only журнал событий прохода/проезда + verify endpoint для guard-console.
// Все UPDATE/DELETE запрещены на уровне route (нет соответствующих методов);
// корректировки — только через access_overrides (отдельный endpoint на
// accessIncidents route).
//
// Legacy `/api/v1/visit-logs` (старый роут) продолжает работать на таблице
// `visit_logs` до cut-over в Фазе 7.  Здесь работаем с `visit_logs_v2`.

const express = require('express');
const db = require('../../db');
const logger = require('../../logger');
const requireAuth = require('../../middleware/auth');
const { can } = require('../lib/authz');
const { normalizePlate, looksLikeRuPlate } = require('../lib/normalizePlate');
const { parsePaginationParams, buildPageMeta } = require('../lib/pagination');
const {
  VL_COLS,
  createVisitLog,
  isVisitServiceError,
  verifyVisit,
} = require('../services/visitService');
const {
  isAccessTopologyServiceError,
  validateAccessPoint,
} = require('../services/accessTopologyService');

const router = express.Router();
router.use(requireAuth);

// SEC [AUDIT #1] — per-tenant pool, см. комментарий в structure.js.
const getDb = (req) => req.db || db;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVENT_TYPES = new Set([
  'entry_allowed', 'entry_denied', 'exit_allowed', 'exit_denied',
  'manual_admit', 'manual_deny', 'override',
]);
const MANUAL_EVENT_TYPES = new Set(['manual_admit', 'manual_deny']);
const EVENT_SOURCES = new Set(['domhub', 'skud', 'guard_console', 'import']);

function isValidUuid(v) { return typeof v === 'string' && UUID_RE.test(v); }
function isValidIso(v) { return typeof v === 'string' && !Number.isNaN(Date.parse(v)); }

function sendServiceError(res, err) {
  if (!isVisitServiceError(err)) return false;
  res.status(err.status).json({ error: err.message });
  return true;
}

function sendKnownError(res, err) {
  if (sendServiceError(res, err)) return true;
  if (!isAccessTopologyServiceError(err)) return false;
  res.status(err.status).json({ error: err.message });
  return true;
}

async function sendVerify(req, res, next, defaults = {}) {
  try {
    if (!can(req.user, 'access.qr.verify') && !can(req.user, 'access.plate.verify')) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const {
      property_id,
      mode = defaults.mode,
      token = null,
      plate = null,
      access_point_id = null,
      direction = 'entry',
      occurred_at = null,
    } = req.body || {};
    if (!isValidUuid(property_id)) return res.status(400).json({ error: 'property_id must be UUID' });
    if (access_point_id !== null && !isValidUuid(access_point_id)) {
      return res.status(400).json({ error: 'access_point_id must be UUID or null' });
    }
    if (!['qr', 'plate'].includes(mode)) return res.status(400).json({ error: "mode must be 'qr' or 'plate'" });
    if (!['entry', 'exit'].includes(direction)) return res.status(400).json({ error: "direction must be 'entry' or 'exit'" });
    if (mode === 'qr' && (typeof token !== 'string' || token.length < 16)) {
      return res.status(400).json({ error: 'token required for mode=qr' });
    }
    if (mode === 'plate' && (typeof plate !== 'string' || !plate.trim())) {
      return res.status(400).json({ error: 'plate required for mode=plate' });
    }
    if (occurred_at && !isValidIso(occurred_at)) {
      return res.status(400).json({ error: 'occurred_at must be ISO-8601 or omitted' });
    }
    await validateAccessPoint(getDb(req), { propertyId: property_id, accessPointId: access_point_id });
    const { result, pass } = await verifyVisit({
      queryable: getDb(req),
      verifyDb: req.db || null,
      user: req.user,
      input: { property_id, mode, token, plate, access_point_id, direction, occurred_at },
    });

    res.json({
      allowed: result.verdict.allowed,
      reason: result.verdict.reason,
      policy_decision: result.verdict.policy_decision || null,
      direction,
      visit_log_id: result.visit_log_id,
      incident_id: result.incident_id,
      pass,
    });
  } catch (err) {
    if (sendKnownError(res, err)) return;
    logger.error({ err }, '[v1/visits] verify failed');
    next(err);
  }
}

// ─── POST /api/v1/visits/verify ──────────────────────────────────────────────
// Главный endpoint guard-console.  Возвращает 200 OK { allowed } вне
// зависимости от verdict'а — deny это валидный бизнес-ответ.
router.post('/verify', async (req, res, next) => {
  await sendVerify(req, res, next);
});

// Contract alias for POST /api/v1/guard/scan-pass when this router is mounted
// at /api/v1/guard.
router.post('/scan-pass', async (req, res, next) => {
  await sendVerify(req, res, next, { mode: 'qr' });
});

// ─── POST /api/v1/visits ─────────────────────────────────────────────────────
// Прямой INSERT события — только для provider/import/system logs.
// Manual admit/deny must go through createManualSecurityDecision so override,
// incident, degraded reconciliation, and sensitive audit rows are atomic.
router.post('/', async (req, res, next) => {
  try {
    if (!can(req.user, 'access.qr.verify') && !can(req.user, 'access.plate.verify')) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const {
      property_id, pass_id = null, access_point_id = null, event_type, event_source,
      person_label = null, vehicle_plate = null,
      provider_event_id = null, provider_payload = null,
      occurred_at = null,
    } = req.body || {};

    if (!isValidUuid(property_id)) return res.status(400).json({ error: 'property_id must be UUID' });
    if (!EVENT_TYPES.has(event_type)) return res.status(400).json({ error: 'Invalid event_type' });
    if (MANUAL_EVENT_TYPES.has(event_type)) {
      return res.status(422).json({
        error: 'manual_admit/manual_deny must use the manual security decision endpoint',
      });
    }
    if (!EVENT_SOURCES.has(event_source)) return res.status(400).json({ error: 'Invalid event_source' });
    if (pass_id && !isValidUuid(pass_id)) return res.status(400).json({ error: 'pass_id must be UUID or null' });
    if (access_point_id !== null && !isValidUuid(access_point_id)) {
      return res.status(400).json({ error: 'access_point_id must be UUID or null' });
    }
    if (occurred_at && !isValidIso(occurred_at)) return res.status(400).json({ error: 'occurred_at must be ISO-8601' });
    await validateAccessPoint(getDb(req), { propertyId: property_id, accessPointId: access_point_id });

    const result = await createVisitLog({
      queryable: getDb(req),
      user: req.user,
      input: {
        property_id,
        pass_id,
        access_point_id,
        event_type,
        event_source,
        person_label,
        vehicle_plate,
        provider_event_id,
        provider_payload,
        occurred_at,
      },
    });
    res.status(201).json({ visit_log: result.visit_log });
  } catch (err) {
    if (sendKnownError(res, err)) return;
    if (err && err.code === '23505') {
      // provider_event_id unique conflict — идемпотентный вебхук, вернуть существующую строку
      if (req.body?.provider_event_id) {
        const { rows } = await getDb(req).query(
          `SELECT ${VL_COLS} FROM visit_logs_v2
            WHERE event_source = $1 AND provider_event_id = $2`,
          [req.body.event_source, req.body.provider_event_id],
        );
        if (rows[0]) return res.status(200).json({ visit_log: rows[0], idempotent: true });
      }
      return res.status(409).json({ error: 'duplicate visit log' });
    }
    next(err);
  }
});

// ─── GET /api/v1/visits ──────────────────────────────────────────────────────
// Pagination: ?limit=1..200 (default 50), ?offset=0..100000 (default 0)
router.get('/', async (req, res, next) => {
  try {
    if (!can(req.user, 'visits:read')) return res.status(403).json({ error: 'Forbidden' });

    let pagination;
    try {
      pagination = parsePaginationParams(req.query);
    } catch (rangeErr) {
      return res.status(400).json({ error: rangeErr.message });
    }

    const filters = [];
    const params = [];
    if (req.query.pass_id) {
      if (!isValidUuid(req.query.pass_id)) return res.status(400).json({ error: 'Invalid pass_id' });
      params.push(req.query.pass_id); filters.push(`pass_id = $${params.length}`);
    }
    if (req.query.vehicle_plate) {
      params.push(normalizePlate(String(req.query.vehicle_plate)));
      filters.push(`vehicle_plate = $${params.length}`);
    }
    if (req.query.event_type) {
      if (!EVENT_TYPES.has(req.query.event_type)) return res.status(400).json({ error: 'Invalid event_type' });
      params.push(req.query.event_type); filters.push(`event_type = $${params.length}`);
    }
    if (req.query.from) {
      if (!isValidIso(String(req.query.from))) return res.status(400).json({ error: 'Invalid from' });
      params.push(req.query.from); filters.push(`occurred_at >= $${params.length}`);
    }
    if (req.query.to) {
      if (!isValidIso(String(req.query.to))) return res.status(400).json({ error: 'Invalid to' });
      params.push(req.query.to); filters.push(`occurred_at <= $${params.length}`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    params.push(pagination.limit);
    const limitIdx = params.length;
    params.push(pagination.offset);
    const offsetIdx = params.length;

    const { rows } = await getDb(req).query(
      `SELECT ${VL_COLS} FROM visit_logs_v2 ${where}
        ORDER BY occurred_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );
    res.json({
      visit_logs: rows,
      page: buildPageMeta({ ...pagination, returnedCount: rows.length }),
    });
  } catch (err) { next(err); }
});

// ─── GET /api/v1/visits/by-pass/:pass_id ─────────────────────────────────────
router.get('/by-pass/:pass_id', async (req, res, next) => {
  try {
    if (!can(req.user, 'visits:read')) return res.status(403).json({ error: 'Forbidden' });
    if (!isValidUuid(req.params.pass_id)) return res.status(400).json({ error: 'Invalid pass_id' });
    let pagination;
    try {
      pagination = parsePaginationParams(req.query);
    } catch (rangeErr) {
      return res.status(400).json({ error: rangeErr.message });
    }
    const { rows } = await getDb(req).query(
      `SELECT ${VL_COLS} FROM visit_logs_v2
        WHERE pass_id = $1
        ORDER BY occurred_at DESC LIMIT $2 OFFSET $3`,
      [req.params.pass_id, pagination.limit, pagination.offset],
    );
    res.json({
      visit_logs: rows,
      page: buildPageMeta({ ...pagination, returnedCount: rows.length }),
    });
  } catch (err) { next(err); }
});

// ─── GET /api/v1/visits/by-plate/:plate ──────────────────────────────────────
router.get('/by-plate/:plate', async (req, res, next) => {
  try {
    if (!can(req.user, 'visits:read')) return res.status(403).json({ error: 'Forbidden' });
    const normalized = normalizePlate(req.params.plate);
    if (!normalized) return res.status(400).json({ error: 'Invalid plate' });
    if (!looksLikeRuPlate(normalized) && normalized.length < 3) {
      return res.status(400).json({ error: 'Plate too short' });
    }
    let pagination;
    try {
      pagination = parsePaginationParams(req.query);
    } catch (rangeErr) {
      return res.status(400).json({ error: rangeErr.message });
    }
    const { rows } = await getDb(req).query(
      `SELECT ${VL_COLS} FROM visit_logs_v2
        WHERE vehicle_plate = $1
        ORDER BY occurred_at DESC LIMIT $2 OFFSET $3`,
      [normalized, pagination.limit, pagination.offset],
    );
    res.json({
      plate: normalized,
      visit_logs: rows,
      page: buildPageMeta({ ...pagination, returnedCount: rows.length }),
    });
  } catch (err) { next(err); }
});

// ─── GET /api/v1/visits/:id ──────────────────────────────────────────────────
// Детали + linked incident (если есть).  Держим в самом конце, чтобы
// `/by-pass/:pass_id` и `/by-plate/:plate` не перехватывались.
router.get('/:id', async (req, res, next) => {
  try {
    if (!can(req.user, 'visits:read')) return res.status(403).json({ error: 'Forbidden' });
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const { rows } = await getDb(req).query(
      `SELECT ${VL_COLS} FROM visit_logs_v2 WHERE id = $1`,
      [req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Visit log not found' });

    const { rows: incRows } = await getDb(req).query(
      `SELECT id, incident_type, severity, status, title, created_at
         FROM access_incidents
        WHERE related_visit_log_id = $1
        ORDER BY created_at DESC`,
      [req.params.id],
    );
    res.json({ visit_log: rows[0], incidents: incRows });
  } catch (err) { next(err); }
});

module.exports = router;
