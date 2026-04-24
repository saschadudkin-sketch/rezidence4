'use strict';

const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const { getRedis } = require('../lib/redisClient');

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

function createRateLimiters() {
  const { ipKeyGenerator } = rateLimit;

  return {
    authLimiter: rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 10,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Слишком много запросов. Попробуйте позже.' },
      ...makeRedisStore('auth'),
    }),
    globalLimiter: rateLimit({
      windowMs: 60 * 1000,
      max: 200,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req) => req.user?.uid || ipKeyGenerator(req),
      ...makeRedisStore('global'),
    }),
    clientLogsLimiter: rateLimit({
      windowMs: 60 * 1000,
      max: 20,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Слишком много client logs. Подождите.' },
      ...makeRedisStore('client-logs'),
    }),
    uploadLimiter: rateLimit({
      windowMs: 60_000,
      max: 20,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Слишком много загрузок. Подождите.' },
      ...makeRedisStore('upload'),
    }),
    sseEventsLimiter: rateLimit({
      windowMs: 60_000,
      max: 10,
      standardHeaders: true,
      legacyHeaders: false,
      ...makeRedisStore('sse'),
    }),
    // SEC [AUDIT #8]: строже чем обычный authLimiter — superadmin attempts
    // value-of-compromise выше, бот-перебор паролей недопустим.
    platformAuthLimiter: rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 5,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many login attempts. Try again later.' } },
      ...makeRedisStore('platform-auth'),
    }),
    // SEC [AUDIT #8]: общий лимитер на /platform/* отличный от /api/* —
    // без него /platform/api/v1/properties|admins|stats|audit-log|outbox/*
    // не имели никаких rate-лимитов.  Украденный superadmin token позволял
    // неограниченное enumeration всех tenant'ов и audit-логов.
    platformGlobalLimiter: rateLimit({
      windowMs: 60 * 1000,
      max: 100,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req) => req.platformAdmin?.id || ipKeyGenerator(req),
      message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests. Try again later.' } },
      ...makeRedisStore('platform-global'),
    }),
    // Phase 2: public QR pass lookup — 30 req/min per IP, no auth
    publicPassLimiter: rateLimit({
      windowMs: 60_000,
      max: 30,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests. Try again later.' } },
      ...makeRedisStore('public-pass'),
    }),
  };
}

module.exports = {
  createRateLimiters,
};
