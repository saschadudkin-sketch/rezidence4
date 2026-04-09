'use strict';

const requireAuth = require('../middleware/auth');
const logger = require('../logger');
const appMetrics = require('../metrics');
const sse = require('../sse');
const { getRedis } = require('../lib/redisClient');

function registerObservabilityRoutes(app, { db }) {
  app.get('/api/health', (_req, res) => res.json({ ok: true, ts: new Date() }));

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
