'use strict';

const fs = require('fs');
const path = require('path');
const requireAuth = require('../middleware/auth');
const logger = require('../logger');
const appMetrics = require('../metrics');
const sse = require('../sse');
const { getRedis } = require('../lib/redisClient');
const { isOutboxEnabled } = require('../v1/services/notificationOutbox');
const { fetchTenantOutboxHealth } = require('../v1/services/outboxHealth');

function registerObservabilityRoutes(app, { db }) {
  const openApiPath = path.resolve(__dirname, '../../../docs/openapi.json');

  app.get('/api/health', (_req, res) => res.json({ ok: true, ts: new Date() }));

  app.get('/api/docs/openapi.json', (_req, res) => {
    try {
      const spec = fs.readFileSync(openApiPath, 'utf8');
      res.type('application/json').send(spec);
    } catch (err) {
      logger.error({ err }, '[docs] failed to read OpenAPI spec');
      res.status(500).json({ error: 'OpenAPI spec unavailable' });
    }
  });

  app.get('/api/v1/events/health', requireAuth, (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const { clients: sseClientsMap } = sse;
    const uniqueUsers = sseClientsMap.size;
    const totalConnections = [...sseClientsMap.values()].reduce((sum, set) => sum + set.size, 0);
    res.json({
      ok: true,
      uniqueUsers,
      totalConnections,
      maxTotalConnections: 2000,
      saturated: totalConnections >= 1800,
      ts: new Date().toISOString(),
    });
  });

  // platform-v1 notifications outbox health.  Admin-only.
  // Spec: notifications-outbox-spec.md §4.5 — introspection для runner'а.
  //
  // Читает текущий tenant (req.db если установлен middleware'ом, иначе
  // legacy single-tenant db).  Суперадмин per-tenant health через
  // /platform/... остаётся отдельной задачей (см. BACKLOG).
  //
  // Поля:
  //   counts              per-status фотография текущего состояния outbox'а.
  //                       Предел 24h по last_attempted_at для sent — чтобы
  //                       не тащить всю историю.
  //   oldest_pending_age_seconds   возраст самой старой pending-строки.  Если
  //                       этот возраст растёт бесконтрольно — worker не
  //                       справляется / мёртв / флаг отключён на проде.
  //   stuck_in_flight     строки, зависшие в in_flight > 30 минут (reaper-target).
  //   feature_enabled     NOTIFICATIONS_OUTBOX_ENABLED — для диагностики,
  //                       почему outbox пуст (flag off → всё уходит inline).
  app.get('/api/v1/notifications/outbox/health', requireAuth, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const pool = req.db || db;
    try {
      // fetchTenantOutboxHealth — один aggregate SELECT + нормализация pg-
      // bigint-строк в number'ы.  SQL + формат выкатывается также из
      // superadmin platform-wide дашборда → держим в одном месте.
      const snapshot = await fetchTenantOutboxHealth(pool);
      res.json({
        ok: true,
        feature_enabled: isOutboxEnabled(),
        counts: snapshot.counts,
        stuck_in_flight: snapshot.stuck_in_flight,
        oldest_pending_age_seconds: snapshot.oldest_pending_age_seconds,
        ts: new Date().toISOString(),
      });
    } catch (err) {
      logger.error({ err }, '[outbox-health] query failed');
      res.status(503).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/health/detailed', requireAuth, async (_req, res) => {
    try {
      const { rows } = await db.query('SELECT NOW() AS ts');
      res.json({ ok: true, db: 'up', dbTs: rows[0].ts, serverTs: new Date() });
    } catch (err) {
      logger.error({ err }, '[health] db check failed');
      res.status(503).json({ ok: false, db: 'down', error: err.message });
    }
  });

  app.get('/api/metrics', requireAuth, (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const activeSSE = [...sse.clients.values()].reduce((sum, set) => sum + set.size, 0);
    res.json({
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      activeSSEConnections: activeSSE,
      dbPool: {
        total: db.pool.totalCount,
        idle: db.pool.idleCount,
        waiting: db.pool.waitingCount,
      },
      nodeVersion: process.version,
      timestamp: new Date().toISOString(),
      appMetrics: appMetrics.getSnapshot(),
    });
  });

  app.get('/api/metrics/prometheus', requireAuth, (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const m = appMetrics.getSnapshot();
    const lines = [
      '# HELP rez_auth_refresh_requests_total Total refresh endpoint requests',
      '# TYPE rez_auth_refresh_requests_total counter',
      `rez_auth_refresh_requests_total ${m.authRefreshRequests}`,
      '# HELP rez_auth_refresh_success_total Total successful refresh operations',
      '# TYPE rez_auth_refresh_success_total counter',
      `rez_auth_refresh_success_total ${m.authRefreshSuccess}`,
      '# HELP rez_auth_refresh_failed_total Total failed refresh operations',
      '# TYPE rez_auth_refresh_failed_total counter',
      `rez_auth_refresh_failed_total ${m.authRefreshFailed}`,
      '# HELP rez_auth_refresh_legacy_fallback_total Legacy refresh fallback usage',
      '# TYPE rez_auth_refresh_legacy_fallback_total counter',
      `rez_auth_refresh_legacy_fallback_total ${m.authRefreshLegacyFallbackUsed}`,
      '# HELP rez_db_pool_total Total PostgreSQL pool connections',
      '# TYPE rez_db_pool_total gauge',
      `rez_db_pool_total ${db.pool.totalCount}`,
      '# HELP rez_db_pool_idle Idle PostgreSQL pool connections',
      '# TYPE rez_db_pool_idle gauge',
      `rez_db_pool_idle ${db.pool.idleCount}`,
      '# HELP rez_db_pool_waiting Waiting PostgreSQL pool clients',
      '# TYPE rez_db_pool_waiting gauge',
      `rez_db_pool_waiting ${db.pool.waitingCount}`,
      '# HELP rez_http_request_duration_milliseconds HTTP request duration in milliseconds',
      '# TYPE rez_http_request_duration_milliseconds summary',
      `rez_http_request_duration_milliseconds{quantile="0.5"} ${m.latency.p50 ?? 'NaN'}`,
      `rez_http_request_duration_milliseconds{quantile="0.95"} ${m.latency.p95 ?? 'NaN'}`,
      `rez_http_request_duration_milliseconds{quantile="0.99"} ${m.latency.p99 ?? 'NaN'}`,
      `rez_http_request_duration_milliseconds_count ${m.latency.sampleCount}`,
    ];
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(lines.join('\n') + '\n');
  });

  app.get('/health', async (_req, res) => {
    const checks = {};
    try {
      await db.query('SELECT 1');
      checks.db = 'ok';
    } catch {
      checks.db = 'error';
    }

    const redis = getRedis();
    if (redis) {
      try {
        await redis.ping();
        checks.redis = 'ok';
      } catch {
        checks.redis = 'error';
      }
    } else {
      checks.redis = 'unconfigured';
    }

    const healthy = checks.db === 'ok';
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'error',
      checks,
      uptime: process.uptime(),
      ts: new Date().toISOString(),
    });
  });
}

module.exports = {
  registerObservabilityRoutes,
};
