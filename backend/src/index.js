'use strict';
require('dotenv').config();

const express      = require('express');
const cors         = require('cors');
const path         = require('path');
const helmet       = require('helmet');           // FIX [SEC-5]: security headers (CSP, X-Frame-Options и др.)
const cookieParser = require('cookie-parser');
const rateLimit    = require('express-rate-limit');
const pinoHttp     = require('pino-http');
const logger       = require('./logger');

const db              = require('./db');
const authRouter      = require('./routes/auth');
const requestsRouter  = require('./routes/requests');
const usersRouter     = require('./routes/users');
const chatRouter      = require('./routes/chat');
const permsRouter     = require('./routes/perms');
const templatesRouter = require('./routes/templates');
const blacklistRouter = require('./routes/blacklist');
const visitLogsRouter = require('./routes/visitLogs');
const uploadRouter    = require('./routes/upload');
const clientLogsRouter = require('./routes/clientLogs');
const requireAuth     = require('./middleware/auth');

const app  = express();

// FIX [AUDIT-3 #2]: КРИТИЧНО — trust proxy для корректного rate limiting за nginx.
// Без этого все запросы видны с IP docker bridge (172.17.0.x), rate limiter
// считает лимит на весь nginx, а не на отдельного клиента.
// '1' = доверяем одному hop (nginx → backend).
app.set('trust proxy', 1);

const PORT = process.env.PORT || 3001;
const isProd = process.env.NODE_ENV === 'production';

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

// ─── FIX [SEC-5]: Helmet — security headers ──────────────────────────────────
// Устанавливает: X-Frame-Options, X-Content-Type-Options, HSTS,
// Referrer-Policy, Permissions-Policy и Content-Security-Policy.
const BACKEND_URL  = process.env.BACKEND_URL  || `http://localhost:${PORT}`;
const FRONTEND_URL = process.env.FRONTEND_URL || '*';

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
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много запросов. Попробуйте позже.' },
});
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
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
});

// ─── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = FRONTEND_URL.split(',').map(s => s.trim());

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
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

// ─── FIX [AUDIT-6 #3]: CSRF protection (double-submit cookie) ────────────────
const { setCsrfCookie, verifyCsrf } = require('./middleware/csrf');
app.use('/api/', setCsrfCookie);  // выдаём токен при любом GET на /api/
app.use('/api/', verifyCsrf);     // проверяем на POST/PATCH/DELETE

app.use(pinoHttp({
  logger,
  customLogLevel: (_req, res) => res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
  serializers: {
    req(req) { return { method: req.method, url: req.url, uid: req.raw?.user?.uid }; },
    res(res) { return { statusCode: res.statusCode }; },
  },
}));
app.use('/api/auth', authLimiter);
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
app.use('/api/v1/perms',       permsRouter);
app.use('/api/v1/templates',   templatesRouter);
app.use('/api/v1/blacklist',   blacklistRouter);
app.use('/api/v1/visit-logs',  visitLogsRouter);
app.use('/api/v1/upload',      uploadLimiter, uploadRouter);
// FIX [AUDIT-6 #4]: client error reporting — no auth (errors before login), rate limited
app.use('/api/v1/client-logs', globalLimiter, clientLogsRouter);
app.use('/api/client-logs',    globalLimiter, clientLogsRouter);

// FIX [AUDIT-3 #11]: Backward-compatible aliases — добавляем Deprecation заголовок.
// Rate limiter на /api/auth теперь также покрывает /api/v1/auth через явный middleware.
// Удалим алиасы после миграции фронта на /v1/.
const deprecate = (req, res, next) => {
  res.setHeader('Deprecation', 'version="2026-09-01"');
  res.setHeader('Sunset', 'Sat, 01 Sep 2026 00:00:00 GMT');
  next();
};
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
const { clients: sseClients } = require('./sse');
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
  });
});

// ─── 404 ──────────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// ─── Error handler ────────────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  logger.error({ err }, '[error] %s', err.message || err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
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
    cleanupJob.unref(); // не блокируем завершение процесса

  } catch (err) {
    logger.fatal({ err }, '[fatal] startup failed');
    process.exit(1);
  }
}

start();
