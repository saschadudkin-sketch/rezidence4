'use strict';
require('dotenv').config();

const express      = require('express');
const cors         = require('cors');
const path         = require('path');
const helmet       = require('helmet');           // security headers: CSP, X-Frame-Options, HSTS
const cookieParser = require('cookie-parser');
const rateLimit    = require('express-rate-limit');
const RedisStore   = require('rate-limit-redis');
const pinoHttp     = require('pino-http');
const logger       = require('./logger');
const appMetrics   = require('./metrics');
const { getRedis } = require('./lib/redisClient');
const { randomUUID } = require('crypto');

const db              = require('./db');
const authRouter      = require('./routes/auth');
const requestsRouter  = require('./routes/requests');
const usersRouter     = require('./routes/users');
const chatRouter      = require('./routes/chat');
const sse             = require('./sse');
const permsRouter     = require('./routes/perms');
const templatesRouter = require('./routes/templates');
const blacklistRouter = require('./routes/blacklist');
const visitLogsRouter = require('./routes/visitLogs');
const uploadRouter    = require('./routes/upload');
const clientLogsRouter = require('./routes/clientLogs');
const requireAuth     = require('./middleware/auth');
const { deprecate }   = require('./middleware/deprecate');

const app  = express();

const PORT = process.env.PORT || 3001;
const isProd = process.env.NODE_ENV === 'production';
// Trust proxy hops are controlled via TRUST_PROXY_HOPS env var.
// Defaults to 1 in production (nginx → backend) and false in non-prod
// to reject spoofed X-Forwarded-* headers on direct access.
const trustProxyHops = process.env.TRUST_PROXY_HOPS;
const trustProxyValue = trustProxyHops != null
  ? Number.parseInt(trustProxyHops, 10)
  : (isProd ? 1 : false);
app.set('trust proxy', Number.isInteger(trustProxyValue) && trustProxyValue >= 0 ? trustProxyValue : false);

// ─── Production guard ────────────────────────────────────────────────────────
// Fail fast on startup if required env vars are missing — prevents deploying
// with an open wildcard CORS origin or insecure / missing JWT secret.
if (isProd && !process.env.FRONTEND_URL) {
  logger.fatal('FRONTEND_URL must be set in production (cannot use wildcard CORS in prod)');
  process.exit(1);
}
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
  logger.fatal('JWT_SECRET must be set and at least 16 characters long');
  process.exit(1);
}
// DATABASE_URL is required — pool creation succeeds but first query fails
// with a cryptic runtime error without it.
if (!process.env.DATABASE_URL) {
  logger.fatal('DATABASE_URL must be set');
  process.exit(1);
}
if (process.env.REFRESH_LEGACY_FALLBACK_ENABLED === '0') {
  logger.info('[auth] legacy refresh fallback disabled (REFRESH_LEGACY_FALLBACK_ENABLED=0)');
} else {
  logger.warn('[auth] legacy refresh fallback is enabled; disable after migration window');
}

// ─── Helmet — security headers ───────────────────────────────────────────────
// Sets X-Frame-Options, X-Content-Type-Options, HSTS,
// Referrer-Policy, and Permissions-Policy.
const BACKEND_URL  = process.env.BACKEND_URL  || `http://localhost:${PORT}`;
const DEFAULT_DEV_FRONTEND_URLS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
].join(',');
const FRONTEND_URL = process.env.FRONTEND_URL || (isProd ? '' : DEFAULT_DEV_FRONTEND_URLS);

// CSP is disabled — this is an API-only server that never renders HTML.
// A backend CSP header would conflict with the nginx CSP on the frontend
// (browsers apply both; the stricter one wins, silently breaking SSE or photo uploads).
// CSP is managed exclusively in frontend/nginx.conf.
app.use(helmet({
  // HSTS: production only, assumes HTTPS termination upstream
  hsts: isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
  // CSP disabled — backend serves JSON only, never renders HTML.
  // CSP is managed in frontend/nginx.conf.
  contentSecurityPolicy: false,
}));

// ─── Rate limiting ────────────────────────────────────────────────────────────
// Redis-backed store for rate limiters — enforces limits globally across all instances.
// Without it each instance keeps its own counter, multiplying the effective limit.
// Falls back to in-memory if Redis is not configured (single instance or dev).
function makeRedisStore(prefix) {
  const redis = getRedis();
  if (!redis) return {};
  return {
    store: new RedisStore({
      sendCommand: (...args) => redis.call(...args),
      prefix: `rz:rl:${prefix}:`,
    }),
  };
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много запросов. Попробуйте позже.' },
  ...makeRedisStore('auth'),
});
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  ...makeRedisStore('global'),
});
const clientLogsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много client logs. Подождите.' },
  ...makeRedisStore('client-logs'),
});
// Separate rate limit for file uploads (20/min) — prevents a single authenticated
// user from exhausting disk space and bandwidth via the global 200 req/min allowance.
const uploadLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много загрузок. Подождите.' },
  ...makeRedisStore('upload'),
});

// ─── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = FRONTEND_URL.split(',').map(s => s.trim()).filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) {
      cb(null, true);
    } else {
      cb(new Error('CORS: not allowed'));
    }
  },
  credentials: true,
}));

// ─── Body / cookie parsing ────────────────────────────────────────────────────
// Global JSON body limit is 64 kb — upload.js uses express.raw and doesn't need this higher.
// All text routes (chat, requests, users, etc.) never need bodies larger than 64 kb,
// so a generous limit would only enable DoS via the Node.js JSON parser.
app.use(express.json({ limit: '64kb' }));
app.use(cookieParser());

// ─── Correlation ID ───────────────────────────────────────────────────────────
app.use((req, res, next) => {
  const incoming = req.headers['x-request-id'];
  const requestId = (typeof incoming === 'string' && incoming.trim()) || randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
});

// ─── CSRF protection (double-submit cookie) ───────────────────────────────────
const { setCsrfCookie, verifyCsrf } = require('./middleware/csrf');
app.use('/api/', setCsrfCookie);  // issue token on any GET to /api/
app.use('/api/', verifyCsrf);     // verify token on POST/PATCH/DELETE

app.use(pinoHttp({
  logger,
  customLogLevel: (_req, res) => res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
  serializers: {
    req(req) { return { method: req.method, url: req.url, uid: req.raw?.user?.uid, requestId: req.raw?.requestId }; },
    res(res) { return { statusCode: res.statusCode }; },
  },
  // record request latency for P95/P99 percentile tracking
  customSuccessMessage(_req, res, responseTime) {
    appMetrics.recordLatency(responseTime);
    return `${res.statusCode}`;
  },
  customErrorMessage(_req, res, err, responseTime) {
    appMetrics.recordLatency(responseTime);
    return err.message;
  },
}));
app.use('/api/',     globalLimiter);

// NOTE: chatLimiter is applied inside routes/chat.js on POST /messages
// (covers both /api/chat and /api/v1/chat)

// ─── Protected uploads ────────────────────────────────────────────────────────
// /uploads require authentication — unauthenticated requests receive 401.
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '../uploads'));

app.get('/uploads/:filename', requireAuth, (req, res) => {
  const filename = path.basename(req.params.filename);
  const filepath = path.join(UPLOAD_DIR, filename);

  if (!filepath.startsWith(UPLOAD_DIR + path.sep) && filepath !== UPLOAD_DIR) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Force download (attachment) to prevent inline rendering of HTML/SVG even if
  // magic-byte validation is bypassed. nosniff blocks browser MIME-sniffing.
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // private: files belong to a specific authenticated user
  res.setHeader('Cache-Control', 'private, max-age=3600');

  res.sendFile(filepath, (err) => {
    if (err) {
      if (err.code === 'ENOENT') return res.status(404).json({ error: 'Not found' });
      return res.status(500).json({ error: 'File error' });
    }
  });
});

// ─── Routes ───────────────────────────────────────────────────────────────────
// Versioned routes — breaking changes can be introduced under /api/v2/
app.use('/api/v1/auth', authLimiter, authRouter); // authLimiter applied to both /v1 and legacy /api prefixes
app.use('/api/v1/requests',    requestsRouter);
app.use('/api/v1/users',       usersRouter);
app.use('/api/v1/chat',        chatRouter);

// ─── GET /api/v1/events — canonical SSE endpoint ──────────────────────────────
// Semantic rename from /api/chat/stream. The old path remains available via the
// deprecated /api/chat alias below for backward-compat during migration.
const sseEventsLimiter = rateLimit({ windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false, ...makeRedisStore('sse') });
app.get('/api/v1/events', requireAuth, sseEventsLimiter, (req, res) => {
  const { uid, role } = req.user;
  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write(': connected\n\n');
  sse.addClient(uid, res, role);
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25_000);
  req.on('close', () => { clearInterval(ping); sse.removeClient(uid, res); });
});
app.use('/api/v1/perms',       permsRouter);
app.use('/api/v1/templates',   templatesRouter);
app.use('/api/v1/blacklist',   blacklistRouter);
app.use('/api/v1/visit-logs',  visitLogsRouter);
app.use('/api/v1/upload',      uploadLimiter, uploadRouter);
// client error reporting — no auth required (captures errors that occur before login), separate limiter
app.use('/api/v1/client-logs', clientLogsLimiter, clientLogsRouter);
app.use('/api/client-logs',    clientLogsLimiter, clientLogsRouter);

// Backward-compatible aliases for pre-v1 clients — include Deprecation/Sunset headers.
// Remove once the frontend has fully migrated to /v1/ routes.
app.use('/api/auth',        deprecate, authLimiter,   authRouter);
app.use('/api/requests',    deprecate, requestsRouter);
app.use('/api/users',       deprecate, usersRouter);
app.use('/api/chat',        deprecate, chatRouter);
app.use('/api/perms',       deprecate, permsRouter);
app.use('/api/templates',   deprecate, templatesRouter);
app.use('/api/blacklist',   deprecate, blacklistRouter);
app.use('/api/visit-logs',  deprecate, visitLogsRouter);
app.use('/api/upload',      deprecate, uploadLimiter, uploadRouter);

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ ok: true, ts: new Date() }));

// Detailed healthcheck including DB connectivity — authenticated users only.
app.get('/api/health/detailed', requireAuth, async (_req, res) => {
  try {
    const { rows } = await db.query('SELECT NOW() AS ts');
    res.json({ ok: true, db: 'up', dbTs: rows[0].ts, serverTs: new Date() });
  } catch (err) {
    logger.error({ err }, '[health] db check failed');
    res.status(503).json({ ok: false, db: 'down', error: err.message });
  }
});

// Runtime metrics endpoint for monitoring (Prometheus/Grafana) — admin only.
const { clients: sseClients } = sse;
app.get('/api/metrics', requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const activeSSE = [...sseClients.values()].reduce((s, set) => s + set.size, 0);
  res.json({
    uptime:               process.uptime(),
    memory:               process.memoryUsage(),
    activeSSEConnections: activeSSE,
    dbPool: {
      total:   db.pool.totalCount,
      idle:    db.pool.idleCount,
      waiting: db.pool.waitingCount,
    },
    nodeVersion: process.version,
    timestamp:   new Date().toISOString(),
    appMetrics:  appMetrics.getSnapshot(),
  });
});

// ─── Prometheus text metrics (admin only) ─────────────────────────────────────
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
    // request latency percentiles
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

// ─── 404 ──────────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// ─── Error handler ────────────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  logger.error({ err, requestId: req?.requestId }, '[error] %s', err.message || err);
  const isProdRuntime = process.env.NODE_ENV === 'production';
  const safeErrorMessage = isProdRuntime ? 'Internal server error' : (err.message || 'Internal server error');
  res.status(err.status || 500).json({ error: safeErrorMessage });
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function start() {
  try {
    const server = app.listen(PORT, () => logger.info(`[server] :${PORT} ready (prod=${isProd})`));

    // Redis pub/sub for horizontal SSE scaling — when REDIS_URL is set, broadcasts
    // propagate through Redis so every instance receives events.
    const sseRedis = require('./sse-redis');
    if (process.env.REDIS_URL) {
      sseRedis.init();
      logger.info('[server] Redis SSE pub/sub enabled');
    }

    const SHUTDOWN_TIMEOUT = 10_000;
    let shuttingDown = false;

    async function gracefulShutdown(signal) {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info(`[server] ${signal}: graceful shutdown started`);

      // 0. Close Redis (shared singleton + SSE pub/sub)
      sseRedis.shutdown();
      const { closeRedis } = require('./lib/redisClient');
      await closeRedis().catch(() => {});

      // 1. Tell SSE clients to reconnect after 2 s
      const { clients } = require('./sse');
      if (clients) {
        for (const set of clients.values()) {
          for (const { res } of set) {
            try { res.write('retry: 2000\n\n'); res.end(); } catch { /* already closed */ }
          }
        }
      }

      // 2. Stop accepting new connections
      server.close(() => {
        logger.info('[server] HTTP server closed');
        // 3. Close the DB pool
        db.pool.end(() => {
          logger.info('[server] DB pool closed');
          process.exit(0);
        });
      });

      // 4. Force exit if graceful shutdown exceeds the timeout
      setTimeout(() => {
        logger.warn('[server] graceful shutdown timeout, forcing exit');
        process.exit(1);
      }, SHUTDOWN_TIMEOUT);
    }

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

    // Hourly cleanup of expired token_revocations — prevents unbounded table growth.
    // Every logout inserts a row; every auth check queries this table, so size directly
    // affects query performance.
    const cleanupJob = setInterval(async () => {
      try {
        const { rowCount } = await db.query(
          'DELETE FROM token_revocations WHERE expires_at < NOW()'
        );
        if (rowCount > 0) logger.info(`[cleanup] removed ${rowCount} expired token revocations`);
      } catch (err) {
        logger.error({ err }, '[cleanup] token_revocations failed');
      }
    }, 60 * 60 * 1000); // every hour
    cleanupJob.unref();

    // Background job (every 5 min) that expires overdue requests and activates scheduled ones.
    // The backend is the single source of truth for request statuses — the frontend may
    // show optimistic state, but the database is authoritative.
    const expirationJob = setInterval(async () => {
      try {
        // 1. Expire single-use passes (once) older than 24 h and passes with a past valid_until
        const { rowCount: expired } = await db.query(`
          UPDATE requests
          SET status = 'expired', updated_at = NOW()
          WHERE status IN ('pending', 'approved')
            AND deleted_at IS NULL
            AND (
              (pass_duration = 'once'
               AND created_at < NOW() - INTERVAL '24 hours')
              OR
              (valid_until IS NOT NULL AND valid_until < NOW())
            )
        `);

        // 2. Activate scheduled requests whose scheduled_for time has arrived
        const { rowCount: activated } = await db.query(`
          UPDATE requests
          SET status = 'pending', scheduled_for = NULL, updated_at = NOW()
          WHERE status = 'scheduled'
            AND scheduled_for <= NOW()
            AND deleted_at IS NULL
        `);

        if (expired > 0)   logger.info(`[expiration] expired ${expired} requests`);
        if (activated > 0) logger.info(`[expiration] activated ${activated} scheduled requests`);
      } catch (err) {
        logger.error({ err }, '[expiration] request status update failed');
      }
    }, 5 * 60 * 1000); // every 5 minutes
    expirationJob.unref(); // don't keep the process alive on shutdown

  } catch (err) {
    logger.fatal({ err }, '[fatal] startup failed');
    process.exit(1);
  }
}

start();
