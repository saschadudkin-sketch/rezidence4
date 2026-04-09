'use strict';

const logger = require('../logger');

function validateConfig(env, prod) {
  const errors = [];

  if (!env.JWT_SECRET || env.JWT_SECRET.length < 16) {
    errors.push('JWT_SECRET must be set and at least 16 characters long');
  }

  if (!env.DATABASE_URL) {
    errors.push('DATABASE_URL must be set');
  }

  if (prod && !env.FRONTEND_URL) {
    errors.push('FRONTEND_URL must be set in production (cannot use wildcard CORS in prod)');
  }

  if (errors.length) {
    for (const msg of errors) logger.fatal(msg);
    process.exit(1);
  }

  if (prod && !env.REDIS_URL && !env.REDIS_TLS_URL) {
    logger.warn('[config] REDIS_URL not set in production — rate limiting uses in-memory store (unsafe for multi-instance deployments)');
  }

  const hops = Number.parseInt(env.TRUST_PROXY_HOPS, 10);
  if (prod && !Number.isNaN(hops) && hops > 3) {
    logger.warn({ hops }, '[config] TRUST_PROXY_HOPS > 3 — verify your nginx topology. Each reverse proxy counts as one hop.');
  }
  if (prod && !env.TRUST_PROXY_HOPS) {
    logger.info('[config] TRUST_PROXY_HOPS not set — defaulting to 1 hop (nginx → backend). Set explicitly if topology differs.');
  }

  if (env.REFRESH_LEGACY_FALLBACK_ENABLED === '0') {
    logger.info('[auth] legacy refresh fallback disabled (REFRESH_LEGACY_FALLBACK_ENABLED=0)');
  } else {
    logger.warn('[auth] legacy refresh fallback is enabled; disable after migration window');
  }
}

function getAppConfig(env = process.env) {
  const port = env.PORT || 3001;
  const isProd = env.NODE_ENV === 'production';
  const trustProxyHops = env.TRUST_PROXY_HOPS;
  const trustProxyValue = trustProxyHops != null
    ? Number.parseInt(trustProxyHops, 10)
    : (isProd ? 1 : false);
  const defaultDevFrontendUrls = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ].join(',');

  return {
    port,
    isProd,
    backendUrl: env.BACKEND_URL || `http://localhost:${port}`,
    frontendUrl: env.FRONTEND_URL || (isProd ? '' : defaultDevFrontendUrls),
    trustProxy: Number.isInteger(trustProxyValue) && trustProxyValue >= 0 ? trustProxyValue : false,
  };
}

module.exports = {
  validateConfig,
  getAppConfig,
};
