'use strict';

// platform-v1 /api/v1/admin/outbox HTTP router — Spec: notifications-outbox-spec.md §4.2.
// Фаза: 5 (Content + Notifications).
//
// Endpoints (все admin-only, per-property scope через req.db):
//
//   GET    /api/v1/admin/outbox                    list (фильтры status/channel/from/to/q)
//   GET    /api/v1/admin/outbox/metrics            JSON snapshot + ?format=prometheus text
//   GET    /api/v1/admin/outbox/sla                package-SLA gauges + ?format=prometheus
//   GET    /api/v1/admin/outbox/:id                row detail
//   POST   /api/v1/admin/outbox/:id/requeue        force-retry dead/failed → pending
//   POST   /api/v1/admin/outbox/:id/cancel         pending/failed → dead (manual)
//
// Порядок регистрации важен:
//   /metrics и /sla ДО /:id — иначе express matchнет их как id → UUID-400.
//
// Связь с platform-level ручками:
//   /platform/api/v1/notifications/outbox/health  — cross-tenant superadmin dashboard
//   /platform/api/v1/notifications/outbox/retry   — cross-tenant superadmin force-retry
//   /api/v1/admin/outbox/*  (эти)                 — per-property admin UI
//
// Кнопки requeue/cancel используют общие DB-сервисы (outboxRetry + adminOutbox),
// а не вызывают platform-level HTTP — это были бы лишний hop и двойная auth.
//
// Безопасность:
//   • requireAuth middleware + role === 'admin' gate на всех роутах.
//   • audit_log пишется на каждом mutating endpoint (requeue/cancel).
//     audit НЕ блокирует ответ (.catch(warn)) — см. паттерн announcements.js.
//   • UUID guard для :id — 400 до похода в БД.

const express = require('express');
const db = require('../../db');
const logger = require('../../logger');
const requireAuth = require('../../middleware/auth');
const {
  listOutbox,
  getOutboxById,
  requeueOutboxRow,
  cancelOutboxRow,
  getOutboxMetrics,
  renderMetricsAsPrometheus,
  isValidUuid,
} = require('../services/adminOutbox');
const {
  getPackageSlaSnapshot,
  renderSlaAsPrometheus,
} = require('../services/packageSla');

const router = express.Router();
router.use(requireAuth);

function isAdmin(req) { return req.user && req.user.role === 'admin'; }

// ─── Audit ──────────────────────────────────────────────────────────────────
// Fire-and-forget INSERT — audit не должен ломать HTTP-ответ, если audit_log
// временно недоступен.  Повторяем паттерн announcements/documents routes.
function audit(req, action, resourceId, changes) {
  db.query(
    `INSERT INTO audit_log
       (actor_uid, actor_role, action, resource_type, resource_id, changes, ip_address)
     VALUES ($1,$2,$3,'outbox_row',$4,$5,$6)`,
    [
      req.user?.uid || null,
      req.user?.role || null,
      action,
      resourceId,
      changes ? JSON.stringify(changes) : null,
      req.ip || null,
    ],
  ).catch((err) => logger.warn({ err, action }, '[v1/admin/outbox] audit write failed'));
}

// ─── GET /metrics ────────────────────────────────────────────────────────────
// ВАЖНО: регистрируется ДО /:id, иначе express matchнет «metrics» как id.
// Prometheus scrape-endpoint отдаёт text/plain с `format=prometheus`;
// default (без query) — JSON для admin UI.
router.get('/metrics', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  const pool = req.db || db.pool;

  try {
    const snapshot = await getOutboxMetrics(pool);

    // Content negotiation: ?format=prometheus → text/plain.
    const format = String(req.query.format || '').toLowerCase();
    if (format === 'prometheus') {
      // propertySlug берём из req.property (если propertyDb middleware раскрыл);
      // для legacy-mount'а (singleton DB) будет undefined — renderMetricsAsPrometheus
      // просто опустит label, Prometheus-консьюмер сможет пережить.
      const propertySlug = req.property?.slug || '';
      const body = renderMetricsAsPrometheus(snapshot, { propertySlug });
      res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      return res.status(200).send(body);
    }

    return res.json({ ok: true, ...snapshot });
  } catch (err) {
    logger.error({ err }, '[v1/admin/outbox] metrics query failed');
    return res.status(503).json({ ok: false, error: err.message });
  }
});

// ─── GET /sla ────────────────────────────────────────────────────────────────
// Registered BEFORE /:id so 'sla' doesn't match UUID guard (which would 400).
// Шесть gauge'ей по packages_v2 + outbox: queue size, overdue-for-reminder,
// overdue-for-return, auto-returns 24h, reminders 24h, received 24h.
// Content negotiation тот же, что и /metrics: ?format=prometheus → text/plain.
router.get('/sla', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  const pool = req.db || db.pool;

  try {
    const snapshot = await getPackageSlaSnapshot(pool);

    const format = String(req.query.format || '').toLowerCase();
    if (format === 'prometheus') {
      const propertySlug = req.property?.slug || '';
      const body = renderSlaAsPrometheus(snapshot, { propertySlug });
      res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      return res.status(200).send(body);
    }

    return res.json({ ok: true, ...snapshot });
  } catch (err) {
    logger.error({ err }, '[v1/admin/outbox] sla query failed');
    return res.status(503).json({ ok: false, error: err.message });
  }
});

// ─── GET / ───────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  const pool = req.db || db.pool;

  // Early validation: если `from`/`to` указаны, но невалидны — 400 (не SILENT
  // игнорирование, иначе админ не поймёт, почему получил слишком много).
  if (req.query.from && Number.isNaN(Date.parse(req.query.from))) {
    return res.status(400).json({ error: 'from must be ISO-8601 datetime' });
  }
  if (req.query.to && Number.isNaN(Date.parse(req.query.to))) {
    return res.status(400).json({ error: 'to must be ISO-8601 datetime' });
  }
  if (req.query.from && req.query.to
      && Date.parse(req.query.from) > Date.parse(req.query.to)) {
    return res.status(400).json({ error: 'from must be <= to' });
  }

  try {
    const result = await listOutbox(pool, {
      status:  req.query.status,
      channel: req.query.channel,
      from:    req.query.from,
      to:      req.query.to,
      q:       req.query.q,
      limit:   req.query.limit,
      offset:  req.query.offset,
    });
    return res.json({
      ok: true,
      items:  result.rows,
      count:  result.rows.length,
      limit:  result.limit,
      offset: result.offset,
    });
  } catch (err) {
    logger.error({ err }, '[v1/admin/outbox] list query failed');
    return res.status(503).json({ ok: false, error: err.message });
  }
});

// ─── GET /:id ────────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const pool = req.db || db.pool;
  try {
    const row = await getOutboxById(pool, req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    return res.json({ ok: true, item: row });
  } catch (err) {
    logger.error({ err, id: req.params.id }, '[v1/admin/outbox] get failed');
    return res.status(503).json({ ok: false, error: err.message });
  }
});

// ─── POST /:id/requeue ───────────────────────────────────────────────────────
router.post('/:id/requeue', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const pool = req.db || db.pool;
  try {
    const out = await requeueOutboxRow(pool, req.params.id);
    if (out.revived) {
      audit(req, 'outbox.requeued', req.params.id, {
        previous_status: out.previousStatus,
      });
      return res.json({
        ok: true,
        id: out.id,
        previous_status: out.previousStatus,
      });
    }
    if (out.conflict === 'not_found') {
      return res.status(404).json({ error: 'Not found' });
    }
    if (out.conflict === 'not_retryable') {
      return res.status(409).json({
        error: `Cannot requeue row in status '${out.status}'. Only dead/failed.`,
        status: out.status,
      });
    }
    // Защитная ветка — conflict из service'а должен быть в whitelist выше.
    logger.error({ out, id: req.params.id }, '[v1/admin/outbox] unexpected requeue conflict');
    return res.status(500).json({ ok: false, error: 'unexpected conflict' });
  } catch (err) {
    logger.error({ err, id: req.params.id }, '[v1/admin/outbox] requeue failed');
    return res.status(503).json({ ok: false, error: err.message });
  }
});

// ─── POST /:id/cancel ────────────────────────────────────────────────────────
router.post('/:id/cancel', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const pool = req.db || db.pool;
  try {
    const out = await cancelOutboxRow(pool, req.params.id);
    if (out.cancelled) {
      audit(req, 'outbox.cancelled', req.params.id, null);
      return res.json({ ok: true, item: out.row });
    }
    if (out.conflict === 'not_found') {
      return res.status(404).json({ error: 'Not found' });
    }
    if (out.conflict === 'not_cancellable') {
      return res.status(409).json({
        error: `Cannot cancel row in status '${out.status}'. Only pending/failed.`,
        status: out.status,
      });
    }
    logger.error({ out, id: req.params.id }, '[v1/admin/outbox] unexpected cancel conflict');
    return res.status(500).json({ ok: false, error: 'unexpected conflict' });
  } catch (err) {
    logger.error({ err, id: req.params.id }, '[v1/admin/outbox] cancel failed');
    return res.status(503).json({ ok: false, error: err.message });
  }
});

module.exports = router;
