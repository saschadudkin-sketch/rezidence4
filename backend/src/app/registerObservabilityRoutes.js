'use strict';

const fs = require('fs');
const path = require('path');
const requireAuth = require('../middleware/auth');
const logger = require('../logger');
const appMetrics = require('../metrics');
const sse = require('../sse');
const sseRedis = require('../sse-redis');
const { getRedis } = require('../lib/redisClient');
const { isOutboxEnabled } = require('../v1/services/notificationOutbox');
const { fetchTenantOutboxHealth } = require('../v1/services/outboxHealth');
const { resurrectOutboxRows } = require('../v1/services/outboxRetry');

function resolvePropertyId(req) {
  return req.property?.id || req.property?.property_id || req.user?.property_id || req.user?.propertyId || null;
}

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

  app.get('/api/v1/events/health', requireAuth, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const { clients: sseClientsMap } = sse;
    const uniqueUsers = sseClientsMap.size;
    const totalConnections = [...sseClientsMap.values()].reduce((sum, set) => sum + set.size, 0);
    const redis = getRedis();
    let redisPublisher = redis ? 'configured' : 'unconfigured';
    if (redis) {
      try {
        await redis.ping();
        redisPublisher = 'ok';
      } catch {
        redisPublisher = 'error';
      }
    }
    const redisStatus = sseRedis.getStatus();
    const redisDegraded = redisPublisher === 'error'
      || (redisStatus.enabled && redisStatus.subscriber !== 'ok');
    res.json({
      ok: !redisDegraded,
      degraded: redisDegraded,
      uniqueUsers,
      totalConnections,
      maxTotalConnections: 2000,
      saturated: totalConnections >= 1800,
      redis: {
        publisher: redisPublisher,
        subscriber: redisStatus.subscriber,
        enabled: redisStatus.enabled,
      },
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
    const propertyId = resolvePropertyId(req);
    try {
      // fetchTenantOutboxHealth — один aggregate SELECT + нормализация pg-
      // bigint-строк в number'ы.  SQL + формат выкатывается также из
      // superadmin platform-wide дашборда → держим в одном месте.
      const snapshot = await fetchTenantOutboxHealth(pool, { propertyId });
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
      res.status(503).json({ ok: false, error: 'Outbox health temporarily unavailable' });
    }
  });

  // POST /api/v1/notifications/outbox/retry — admin escape-hatch.  Spec:
  // notifications-outbox-spec.md §4.5.  Позволяет «поднять» строки из
  // dead/failed обратно в pending — worker подхватит их на ближайшем tick'е.
  //
  // Body (взаимоисключающие режимы):
  //   { ids: ['<uuid>', ...] }                — точечный retry (max 1000 id)
  //   { status: 'dead'|'failed', limit?: N } — bulk retry (default 100, cap 1000)
  //
  // Response:
  //   200 { ok:true, revived:N, revivedIds:[...] }
  //   400 { error: 'validation-message' }
  //   403 { error: 'Admin only' }
  //   503 { ok:false, error: '...' }
  //
  // Защита: resurrectOutboxRows WHERE status IN ('dead','failed') —
  // in_flight/pending/sent никогда не трогаем.  См. outboxRetry.js.
  app.post('/api/v1/notifications/outbox/retry', requireAuth, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const pool = req.db || db;
    const propertyId = resolvePropertyId(req);
    const body = req.body || {};
    try {
      const out = await resurrectOutboxRows(pool, {
        ids:    body.ids,
        status: body.status,
        limit:  body.limit,
        propertyId,
      });
      logger.info(
        { admin: req.user.uid, revived: out.revived, mode: body.ids ? 'ids' : 'bulk' },
        '[outbox-retry] rows revived',
      );
      return res.json({ ok: true, ...out });
    } catch (err) {
      if (err instanceof TypeError) {
        // Validation errors are explicit — caller can fix request and retry.
        return res.status(400).json({ error: err.message });
      }
      logger.error({ err }, '[outbox-retry] update failed');
      return res.status(503).json({ ok: false, error: 'Outbox retry temporarily unavailable' });
    }
  });

  app.get('/api/health/detailed', requireAuth, async (_req, res) => {
    try {
      const { rows } = await db.query('SELECT NOW() AS ts');
      res.json({ ok: true, db: 'up', dbTs: rows[0].ts, serverTs: new Date() });
    } catch (err) {
      logger.error({ err }, '[health] db check failed');
      res.status(503).json({ ok: false, db: 'down', error: 'Database health check failed' });
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

    // platform-v1 notifications outbox — per-channel counters + duration summary.
    // Spec: notifications-outbox-spec.md §4.5.  Labels:
    //   channel ∈ {web_push, sms, telegram, webhook, email}
    //   outcome ∈ {sent, failed, dead}  (as separate metric-name суффиксов
    //     потому что sent/failed/dead имеют разный операционный смысл:
    //     sent — success rate, dead — хард-алерт, failed — retry in progress).
    const outboxChannels = (m.outbox && m.outbox.channels) || {};
    const channelNames = Object.keys(outboxChannels);
    if (channelNames.length > 0) {
      lines.push(
        '# HELP rez_outbox_sent_total Total successful outbox deliveries',
        '# TYPE rez_outbox_sent_total counter',
      );
      for (const ch of channelNames) {
        lines.push(`rez_outbox_sent_total{channel="${ch}"} ${outboxChannels[ch].sent}`);
      }
      lines.push(
        '# HELP rez_outbox_failed_total Total retryable outbox failures (will retry)',
        '# TYPE rez_outbox_failed_total counter',
      );
      for (const ch of channelNames) {
        lines.push(`rez_outbox_failed_total{channel="${ch}"} ${outboxChannels[ch].failed}`);
      }
      lines.push(
        '# HELP rez_outbox_dead_total Total outbox rows exhausted (terminal)',
        '# TYPE rez_outbox_dead_total counter',
      );
      for (const ch of channelNames) {
        lines.push(`rez_outbox_dead_total{channel="${ch}"} ${outboxChannels[ch].dead}`);
      }
      lines.push(
        '# HELP rez_outbox_send_duration_milliseconds Outbox adapter dispatch duration',
        '# TYPE rez_outbox_send_duration_milliseconds summary',
      );
      for (const ch of channelNames) {
        const d = outboxChannels[ch].duration;
        lines.push(
          `rez_outbox_send_duration_milliseconds{channel="${ch}",quantile="0.5"} ${d.p50 ?? 'NaN'}`,
          `rez_outbox_send_duration_milliseconds{channel="${ch}",quantile="0.95"} ${d.p95 ?? 'NaN'}`,
          `rez_outbox_send_duration_milliseconds{channel="${ch}",quantile="0.99"} ${d.p99 ?? 'NaN'}`,
          `rez_outbox_send_duration_milliseconds_count{channel="${ch}"} ${d.sampleCount}`,
        );
      }
    }

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

    const healthy = checks.db === 'ok' && checks.redis !== 'error';
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
