'use strict';

// platform-v1 notification_log_v2 HTTP router — Spec: notification-log-v2-spec.md §3.2.
//
// Только READ endpoints — запись в log_v2 эксклюзивно делает outbox worker
// (spec §3.1).  Роут экспонирует 4 метода:
//
//   GET /api/v1/admin/notification-log              (admin)    list с фильтрами
//   GET /api/v1/admin/notification-log/metrics      (admin)    агрегаты 24h/7d/30d
//   GET /api/v1/admin/notification-log/:id          (admin)    full row
//   GET /api/v1/notification-log/mine               (resident) свои, payload trimmed
//
// Авторизация:
//   - Все методы через requireAuth (JWT).
//   - /admin/* — role === 'admin' enforced на уровне роута.
//   - /mine — role === 'resident' enforced; residentId резолвится через
//     residents.external_uid = req.user.uid.
//
// Per-tenant scoping: роут использует req.db (если propertyDb middleware
// установил) иначе legacy singleton db.  Admin endpoints are tenant-only:
// property scope may come from authenticated middleware/user context, never
// from query params.
//
// Ошибки:
//   400 — валидация (since/until обязательны когда recipient_id пуст; bad period)
//   403 — role mismatch
//   404 — /:id не найден
//   503 — DB rejection (pool down, таблицы нет)

const express = require('express');
const db = require('../../db');
const logger = require('../../logger');
const requireAuth = require('../../middleware/auth');
const { isResidentUser, requireCapability } = require('../lib/authz');
const {
  listForTenant,
  getById,
  listForResident,
  resolveResidentByUid,
  getMetrics,
  LIMIT_MAX,
} = require('../services/notificationLog');

const router = express.Router();
router.use(requireAuth);

const PERIOD_TO_HOURS = Object.freeze({
  '24h': 24,
  '7d':  24 * 7,
  '30d': 24 * 30,
});

// Pre-built middleware — `notification-log:read` capability покрывает admin-only
// доступ ко всем /admin/notification-log/* endpoints.  Resident /mine остаётся
// через isResident предикат, т.к. это role-filter а не capability.
const requireLogAdmin = requireCapability('notification-log:read', { message: 'Admin only' });
const isResident = isResidentUser;

function isValidIso(v) {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v));
}

function resolvePropertyId(req) {
  return req.property?.id
    || req.property?.property_id
    || req.user?.property_id
    || req.user?.propertyId
    || null;
}

// ─── GET /api/v1/admin/notification-log/metrics ──────────────────────────────
// ВАЖНО: /metrics должен быть определён ПЕРЕД /:id, иначе express matchнет
// "metrics" как id и уйдёт в getById.
router.get('/admin/notification-log/metrics', requireLogAdmin, async (req, res) => {
  const period = String(req.query.period || '24h');
  const hours = PERIOD_TO_HOURS[period];
  if (!hours) {
    return res.status(400).json({
      error: `Invalid period. Allowed: ${Object.keys(PERIOD_TO_HOURS).join(', ')}`,
    });
  }

  const pool = req.db || db;
  const propertyId = resolvePropertyId(req);
  try {
    const snapshot = await getMetrics(pool, hours, { propertyId });
    return res.json({ ok: true, period, ...snapshot });
  } catch (err) {
    logger.error({ err }, '[notification-log] metrics query failed');
    return res.status(503).json({ ok: false, error: err.message });
  }
});

// ─── GET /api/v1/admin/notification-log ──────────────────────────────────────
router.get('/admin/notification-log', requireLogAdmin, async (req, res) => {
  // Anti-full-scan guard: if no recipient_id, at least one temporal filter
  // must be present.  Otherwise we'd ORDER BY created_at DESC across the
  // entire table — safe on 10k rows, painful on 10M.  Spec §3 «limit default
  // 50, max 500» — но defensiveness на scan'ах важнее лимита.
  const { recipient_id: recipientId, since, until } = req.query;
  if (!recipientId && !since && !until) {
    return res.status(400).json({
      error: 'since or until required when recipient_id not provided',
    });
  }
  if (since && !isValidIso(since)) {
    return res.status(400).json({ error: 'since must be ISO-8601 datetime' });
  }
  if (until && !isValidIso(until)) {
    return res.status(400).json({ error: 'until must be ISO-8601 datetime' });
  }
  if (since && until && Date.parse(since) > Date.parse(until)) {
    return res.status(400).json({ error: 'since must be <= until' });
  }

  const pool = req.db || db;
  const propertyId = resolvePropertyId(req);
  try {
    const result = await listForTenant(pool, {
      propertyId,
      recipient_type: req.query.recipient_type,
      recipient_id:   recipientId,
      channel:        req.query.channel,
      event_type:     req.query.event_type,
      status:         req.query.status,
      since,
      until,
      limit:  req.query.limit,
      offset: req.query.offset,
    });
    return res.json({
      ok: true,
      items: result.rows,
      limit: result.limit,
      offset: result.offset,
      count: result.rows.length,
    });
  } catch (err) {
    logger.error({ err }, '[notification-log] list query failed');
    return res.status(503).json({ ok: false, error: err.message });
  }
});

// ─── GET /api/v1/admin/notification-log/:id ──────────────────────────────────
router.get('/admin/notification-log/:id', requireLogAdmin, async (req, res) => {
  const pool = req.db || db;
  const propertyId = resolvePropertyId(req);
  try {
    const row = await getById(pool, req.params.id, { propertyId });
    if (!row) return res.status(404).json({ error: 'Not found' });
    return res.json({ ok: true, item: row });
  } catch (err) {
    logger.error({ err }, '[notification-log] byId query failed');
    return res.status(503).json({ ok: false, error: err.message });
  }
});

// ─── GET /api/v1/notification-log/mine (resident) ────────────────────────────
router.get('/notification-log/mine', async (req, res) => {
  if (!isResident(req)) return res.status(403).json({ error: 'Residents only' });
  const pool = req.db || db;
  const propertyId = resolvePropertyId(req);
  try {
    const residentId = await resolveResidentByUid(pool, req.user.uid, { propertyId });
    // Резидент без residents-row (pre-Phase-7 legacy user) → пустой список,
    // а не 404.  404 пугает UI — «у вас нет уведомлений» более корректно.
    if (!residentId) {
      return res.json({ ok: true, items: [], count: 0 });
    }
    const items = await listForResident(pool, residentId, { propertyId, limit: req.query.limit });
    return res.json({ ok: true, items, count: items.length });
  } catch (err) {
    logger.error({ err }, '[notification-log] mine query failed');
    return res.status(503).json({ ok: false, error: err.message });
  }
});

// Shared cap advert — чтобы клиенты знали предел limit для pagination.
router.get('/notification-log/_meta', (_req, res) => {
  res.json({ ok: true, limit_max: LIMIT_MAX });
});

module.exports = router;
