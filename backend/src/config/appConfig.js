'use strict';

const logger = require('../logger');

function validateConfig(env, prod) {
  const errors = [];

  // FIX [SEC]: минимальная длина JWT_SECRET увеличена с 16 до 32 символов.
  // 16 символов = 128 бит — недостаточно для HMAC-SHA256 (рекомендуется 256 бит).
  // Генерировать: openssl rand -hex 32
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) {
    errors.push('JWT_SECRET must be at least 32 characters (256 bits). Generate with: openssl rand -hex 32');
  }

  if (!env.DATABASE_URL) {
    errors.push('DATABASE_URL must be set');
  }

  // Platform database is required for multi-tenant operations
  if (prod && !env.PLATFORM_DB_URL) {
    errors.push('PLATFORM_DB_URL must be set in production for multi-tenant registry');
  }

  // SEC [AUDIT #3]: Platform JWT secret обязателен в production и должен
  // отличаться от JWT_SECRET.  Если секреты совпадают, резидентский токен
  // пройдёт jwt.verify на /platform/api/v1/* (один ключ, HS256).  В качестве
  // второго барьера есть aud='platform' claim, но ключи обязаны быть разные —
  // компрометация одного не должна давать доступ к другому кольцу.
  if (prod && !env.PLATFORM_JWT_SECRET) {
    errors.push('PLATFORM_JWT_SECRET must be set in production. Generate with: openssl rand -hex 32');
  }
  if (env.PLATFORM_JWT_SECRET && env.PLATFORM_JWT_SECRET.length < 32) {
    errors.push('PLATFORM_JWT_SECRET must be at least 32 characters. Generate with: openssl rand -hex 32');
  }
  if (env.PLATFORM_JWT_SECRET && env.JWT_SECRET && env.PLATFORM_JWT_SECRET === env.JWT_SECRET) {
    errors.push('PLATFORM_JWT_SECRET must differ from JWT_SECRET. Regenerate one with: openssl rand -hex 32');
  }

  if (prod && !env.FRONTEND_URL) {
    errors.push('FRONTEND_URL must be set in production (cannot use wildcard CORS in prod)');
  }

  // FIX: UPLOAD_SIGNING_SECRET обязателен в production — uploadSecurity.js выбрасывает без него.
  // Добавлено ПЕРЕД process.exit() чтобы ошибка попала в список и сервер не запустился.
  if (prod && !env.UPLOAD_SIGNING_SECRET) {
    errors.push('UPLOAD_SIGNING_SECRET is required in production. Generate: openssl rand -hex 32');
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

  if (env.REFRESH_LEGACY_FALLBACK_ENABLED === '1') {
    logger.warn('[auth] legacy refresh fallback enabled (REFRESH_LEGACY_FALLBACK_ENABLED=1); disable after migration window');
  } else {
    logger.info(`[auth] legacy refresh fallback disabled (REFRESH_LEGACY_FALLBACK_ENABLED=${env.REFRESH_LEGACY_FALLBACK_ENABLED ?? 'unset'})`);
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
