'use strict';
require('dotenv').config();

const express      = require('express');
const cors         = require('cors');
const path         = require('path');
const helmet       = require('helmet');           // FIX [SEC-5]: security headers (CSP, X-Frame-Options и др.)
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
// FIX [AUDIT]: trust proxy должен быть явно управляем окружением.
// По умолчанию доверяем 1 proxy hop только в production (типично nginx → backend).
// В non-prod default=false, чтобы не принимать spoofed X-Forwarded-* при прямом доступе.
const trustProxyHops = process.env.TRUST_PROXY_HOPS;
const trustProxyValue = trustProxyHops != null
  ? Number.parseInt(trustProxyHops, 10)
  : (isProd ? 1 : false);
app.set('trust proxy', Number.isInteger(trustProxyValue) && trustProxyValue >= 0 ? trustProxyValue : false);

// ─── FIX [SEC-4]: Production guard ───────────────────────────────────────────
// Если в production не задан FRONTEND_URL — стартуем с ошибкой,
// чтобы не допустить деплой с открытым CORS (*).
if (isProd && !process.env.FRONTEND_URL) {
  logger.fatal('FRONTEND_URL must be set in production (cannot use wildcard CORS in prod)');
  process.exit(1);
}
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
  logger.fatal('JWT_SECRET must be set and at least 16 characters long');
  process.exit(1);
}
// FIX [AUDIT-3 #1]: DATABASE_URL обязателен — без него Pool создаётся,
// но любой SQL-запрос падает с runtime error без понятного сообщения.
if (!process.env.DATABASE_URL) {
  logger.fatal('DATABASE_URL must be set');
  process.exit(1);
}
if (process.env.REFRESH_LEGACY_FALLBACK_ENABLED === '0') {
  logger.info('[auth] legacy refresh fallback disabled (REFRESH_LEGACY_FALLBACK_ENABLED=0)');
} else {
  logger.warn('[auth] legacy refresh fallback is enabled; disable after migration window');
}

// ─── FIX [SEC-5]: Helmet — security headers ──────────────────────────────────
// Устанавливает: X-Frame-Options, X-Content-Type-Options, HSTS,
// Referrer-Policy, Permissions-Policy и Content-Security-Policy.
const BACKEND_URL  = process.env.BACKEND_URL  || `http://localhost:${PORT}`;
const DEFAULT_DEV_FRONTEND_URLS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
].join(',');
const FRONTEND_URL = process.env.FRONTEND_URL || (isProd ? '' : DEFAULT_DEV_FRONTEND_URLS);

// FIX [AUDIT-3 #14]: Убираем CSP из helmet на backend — он API-only сервер,
// не отдаёт HTML. CSP на /api/* бессмысленен для JSON-ответов и конфликтует
// с CSP nginx на фронте (браузер применяет оба — более строгий побеждает,
// что ломает SSE или загрузку фото без очевидной причины).
// Единственный источник CSP — nginx.conf (frontend).
app.use(helmet({
  // HSTS: только в production и только если есть HTTPS
  hsts: isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
  // CSP отключён — backend отдаёт только JSON, HTML не рендерится.
  // CSP управляется в frontend/nginx.conf.
  contentSecurityPolicy: false,
}));

// ─── Rate limiting ────────────────────────────────────────────────────────────
// FIX [SEC-1]: Redis store для rate limiters — корректная работа в multi-instance деплое.
// Без Redis store каждый инстанс имеет свой счётчик: 3 инстанса × 10 запросов = 30 попыток.
// С Redis store счётчики разделяются между всеми инстансами — лимит соблюдается глобально.
// Fallback на in-memory если Redis не настроен (одиночный инстанс или dev-среда).
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
// FIX [AUDIT]: отдельный лимит для загрузки файлов — 20 фото/мин.
// Без него авторизованный пользователь загружает 200 файлов × 10MB = 2GB/мин на диск,
// исчерпывая дисковое пространство и пропускную способность сети.
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
// FIX [AUDIT]: глобальный лимит снижен с 10mb до 64kb.
// 10mb был нужен только для upload.js — но он использует express.raw, а не express.json.
// Все текстовые роуты (chat, requests, users и т.д.) не нуждаются в телах > 64kb.
// Без этого любой аутентифицированный пользователь мог отправить 10MB JSON-тело
// на любой эндпоинт — создавая DoS-нагрузку на парсер Node.js.
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

// ─── FIX [AUDIT-6 #3]: CSRF protection (double-submit cookie) ────────────────
const { setCsrfCookie, verifyCsrf } = require('./middleware/csrf');
app.use('/api/', setCsrfCookie);  // выдаём токен при любом GET на /api/
app.use('/api/', verifyCsrf);     // проверяем на POST/PATCH/DELETE

app.use(pinoHttp({
  logger,
  customLogLevel: (_req, res) => res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
  serializers: {
    req(req) { return { method: req.method, url: req.url, uid: req.raw?.user?.uid, requestId: req.raw?.requestId }; },
    res(res) { return { statusCode: res.statusCode }; },
  },
  // DO-03: record request latency for P95 tracking
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

// NOTE: chatLimiter применяется внутри routes/chat.js на POST /messages
// (покрывает оба пути: /api/chat и /api/v1/chat)

// ─── Protected uploads ────────────────────────────────────────────────────────
// FIX [SEC-1]: /uploads защищены аутентификацией — без токена 401.
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '../uploads'));

app.get('/uploads/:filename', requireAuth, (req, res) => {
  const filename = path.basename(req.params.filename);
  const filepath = path.join(UPLOAD_DIR, filename);

  if (!filepath.startsWith(UPLOAD_DIR + path.sep) && filepath !== UPLOAD_DIR) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // SEC: Content-Disposition: attachment — браузер скачивает файл, а не рендерит.
  // Предотвращает inline-рендеринг HTML/SVG файлов с JS даже при обходе magic-byte валидации.
  // X-Content-Type-Options: nosniff — запрещает MIME-sniffing браузером.
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Cache-Control: private — файлы принадлежат конкретному пользователю
  res.setHeader('Cache-Control', 'private, max-age=3600');

  res.sendFile(filepath, (err) => {
    if (err) {
      if (err.code === 'ENOENT') return res.status(404).json({ error: 'Not found' });
      return res.status(500).json({ error: 'File error' });
    }
  });
});

// ─── Routes ───────────────────────────────────────────────────────────────────
// Versioned routes — ломающие изменения возможны через /api/v2/
app.use('/api/v1/auth', authLimiter, authRouter); // КРИТ-3: authLimiter применён к обоим префиксам
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
// FIX [AUDIT-6 #4]: client error reporting — no auth (errors before login), отдельный limiter
app.use('/api/v1/client-logs', clientLogsLimiter, clientLogsRouter);
app.use('/api/client-logs',    clientLogsLimiter, clientLogsRouter);

// FIX [AUDIT-3 #11]: Backward-compatible aliases — добавляем Deprecation/Sunset заголовки.
// Rate limiter на /api/auth теперь также покрывает /api/v1/auth через явный middleware.
// Удалим алиасы после миграции фронта на /v1/.
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

// FIX [DEVOPS-4]: детальный healthcheck (только для авторизованных)
app.get('/api/health/detailed', requireAuth, async (_req, res) => {
  try {
    const { rows } = await db.query('SELECT NOW() AS ts');
    res.json({ ok: true, db: 'up', dbTs: rows[0].ts, serverTs: new Date() });
  } catch (err) {
    logger.error({ err }, '[health] db check failed');
    res.status(503).json({ ok: false, db: 'down', error: err.message });
  }
});

// FIX [DO4]: ЖЕЛАТЕЛЬНО — метрики для мониторинга (Prometheus/Grafana)
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
    // DO-03: request latency percentiles
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

    // FIX [AUDIT-6 #2]: Redis pub/sub для горизонтального масштабирования SSE.
    // Если REDIS_URL задан — broadcast идёт через Redis → все инстансы получают события.
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

      // 0. Закрываем Redis (shared singleton + SSE pub/sub)
      sseRedis.shutdown();
      const { closeRedis } = require('./lib/redisClient');
      await closeRedis().catch(() => {});

      // 1. Подсказываем SSE клиентам переподключиться через 2с
      const { clients } = require('./sse');
      if (clients) {
        for (const set of clients.values()) {
          for (const { res } of set) {
            try { res.write('retry: 2000\n\n'); res.end(); } catch { /* already closed */ }
          }
        }
      }

      // 2. Перестаём принимать новые соединения
      server.close(() => {
        logger.info('[server] HTTP server closed');
        // 3. Закрываем пул БД
        db.pool.end(() => {
          logger.info('[server] DB pool closed');
          process.exit(0);
        });
      });

      // 4. Таймаут: если не успели за 10с — принудительный выход
      setTimeout(() => {
        logger.warn('[server] graceful shutdown timeout, forcing exit');
        process.exit(1);
      }, SHUTDOWN_TIMEOUT);
    }

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

    // FIX [AUDIT-3 #3]: Очистка истёкших записей token_revocations.
    // Без этого таблица растёт бесконечно — каждый logout добавляет запись.
    // Каждый запрос делает SELECT по этой таблице → деградация производительности.
    const cleanupJob = setInterval(async () => {
      try {
        const { rowCount } = await db.query(
          'DELETE FROM token_revocations WHERE expires_at < NOW()'
        );
        if (rowCount > 0) logger.info(`[cleanup] removed ${rowCount} expired token revocations`);
      } catch (err) {
        logger.error({ err }, '[cleanup] token_revocations failed');
      }
    }, 60 * 60 * 1000); // каждый час
    cleanupJob.unref();

    // FIX [ARCH]: Серверная экспирация и активация заявок — каждые 5 минут.
    //
    // ПРОБЛЕМА: ранее статусы 'expired' и активация 'scheduled → pending'
    // вычислялись ТОЛЬКО на фронте (useScheduledActivation). Это означало:
    //   - при прямых запросах к API охрана видела неактуальный статус
    //   - заявки не истекали когда клиент offline
    //   - другие сервисы/интеграции не получали корректный статус
    //
    // РЕШЕНИЕ: backend — единственный источник истины для статусов.
    // Фронт может показывать оптимистичное состояние, но БД — авторитет.
    const expirationJob = setInterval(async () => {
      try {
        // 1. Истекают разовые пропуски (once) через 24ч после создания
        //    и временные с явным valid_until в прошлом
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

        // 2. Активируются запланированные заявки
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
    }, 5 * 60 * 1000); // каждые 5 минут
    expirationJob.unref(); // не блокируем завершение процесса

  } catch (err) {
    logger.fatal({ err }, '[fatal] startup failed');
    process.exit(1);
  }
}

start();
