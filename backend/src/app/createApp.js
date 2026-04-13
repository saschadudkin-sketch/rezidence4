'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const pinoHttp = require('pino-http');
const { randomUUID } = require('crypto');
const logger = require('../logger');
const appMetrics = require('../metrics');
const { setCsrfCookie, verifyCsrf } = require('../middleware/csrf');
const { createRateLimiters } = require('./rateLimiters');
const { registerProtectedUploads } = require('./registerProtectedUploads');
const { registerApiRoutes } = require('./registerApiRoutes');
const { registerObservabilityRoutes } = require('./registerObservabilityRoutes');

function createApp({ config, db }) {
  const app = express();
  const rateLimiters = createRateLimiters();
  const allowedOrigins = config.frontendUrl.split(',').map((s) => s.trim()).filter(Boolean);
  const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads'));

  app.set('trust proxy', config.trustProxy);

  // FIX [SEC]: включён Content-Security-Policy.
  // Бэкенд раздаёт JSON (API) и изображения (/uploads/). HTML не раздаётся,
  // поэтому CSP ограничиваем до минимума — главное запретить framing и
  // установить безопасный default для гипотетических error-страниц.
  app.use(helmet({
    hsts: config.isProd ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        imgSrc:     ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'none'"],
      },
    },
  }));

  app.use(cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error('CORS: not allowed'));
    },
    credentials: true,
  }));

  app.use(express.json({ limit: '64kb' }));
  app.use(cookieParser());
  app.use((req, res, next) => {
    const incoming = req.headers['x-request-id'];
    const requestId = (typeof incoming === 'string' && incoming.trim()) || randomUUID();
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
  });

  app.use('/api/', setCsrfCookie);
  app.use('/api/', verifyCsrf);
  app.use(pinoHttp({
    logger,
    customLogLevel: (_req, res) => res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
    serializers: {
      req(req) { return { method: req.method, url: req.url, uid: req.raw?.user?.uid, requestId: req.raw?.requestId }; },
      res(res) { return { statusCode: res.statusCode }; },
    },
    customSuccessMessage(_req, res, responseTime) {
      appMetrics.recordLatency(responseTime);
      return `${res.statusCode}`;
    },
    customErrorMessage(_req, res, err, responseTime) {
      appMetrics.recordLatency(responseTime);
      return err.message;
    },
  }));

  app.use('/api/', rateLimiters.globalLimiter);

  registerProtectedUploads(app, { uploadDir });
  registerApiRoutes(app, { rateLimiters });
  registerObservabilityRoutes(app, { db });

  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    // SEC: в production не логируем полный stack trace — он раскрывает пути файлов
    // и версии фреймворков. Для алертов достаточно кода ошибки и requestId.
    if (config.isProd) {
      logger.error(
        { errorCode: err.code, status: err.status, requestId: req?.requestId },
        '[error] %s',
        err.message || 'Internal server error',
      );
    } else {
      logger.error({ err, requestId: req?.requestId }, '[error] %s', err.message || err);
    }
    const safeErrorMessage = config.isProd ? 'Internal server error' : (err.message || 'Internal server error');
    res.status(err.status || 500).json({ error: safeErrorMessage });
  });

  return app;
}

module.exports = { createApp };
