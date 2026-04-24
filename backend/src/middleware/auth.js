'use strict';
const jwt    = require('jsonwebtoken');
const db     = require('../db');
const logger = require('../logger');
const { getRedis } = require('../lib/redisClient'); // shared singleton — одно соединение на весь процесс
const USER_ACTIVE_CACHE_TTL_SECONDS = 30;
const USER_ACTIVE_FALLBACK_TTL_MS = 5000;
const USER_ACTIVE_FALLBACK_MAX_ENTRIES = 5000;
const REDIS_WARN_THROTTLE_MS = 30_000;
const userActiveFallbackCache = new Map();
const redisWarnAtByScope = new Map();

function getUserActiveCacheKey(uid) {
  return `user_active:${uid}`;
}

function compactUserActiveFallbackCache(nowTs) {
  for (const [uid, entry] of userActiveFallbackCache.entries()) {
    if (entry.expiresAt <= nowTs) {
      userActiveFallbackCache.delete(uid);
    }
  }
  while (userActiveFallbackCache.size > USER_ACTIVE_FALLBACK_MAX_ENTRIES) {
    const oldestUid = userActiveFallbackCache.keys().next().value;
    if (!oldestUid) break;
    userActiveFallbackCache.delete(oldestUid);
  }
}

function setUserActiveFallback(uid, value, nowTs) {
  userActiveFallbackCache.set(uid, {
    value,
    expiresAt: nowTs + USER_ACTIVE_FALLBACK_TTL_MS,
  });
  compactUserActiveFallbackCache(nowTs);
}

function warnRedisThrottled(scope, payload, message) {
  const now = Date.now();
  const lastWarnAt = redisWarnAtByScope.get(scope) || 0;
  if (now - lastWarnAt < REDIS_WARN_THROTTLE_MS) return;
  redisWarnAtByScope.set(scope, now);
  logger.warn(payload, message);
}

async function isTokenRevoked(jti) {
  const _redis = getRedis();
  // ── Redis path ──
  if (_redis) {
    try {
      const val = await _redis.get(`revoked:${jti}`);
      return val === '1';
    } catch (err) {
      warnRedisThrottled('revoked-read', { err, jti }, '[auth] redis check failed, falling back to DB');
      // Не бросаем — падаем на DB
    }
  }
  // ── DB fallback ──
  const { rows } = await db.query(
    'SELECT 1 FROM token_revocations WHERE jti=$1', [jti]
  );
  return rows.length > 0;
}

async function isUserActive(uid) {
  const now = Date.now();
  const fallbackCached = userActiveFallbackCache.get(uid);
  if (fallbackCached && fallbackCached.expiresAt > now) {
    return fallbackCached.value;
  }
  if (fallbackCached && fallbackCached.expiresAt <= now) {
    userActiveFallbackCache.delete(uid);
  }

  const _redis = getRedis();
  const cacheKey = getUserActiveCacheKey(uid);

  if (_redis) {
    try {
      const cached = await _redis.get(cacheKey);
      if (cached !== null) {
        const value = cached === '1';
        setUserActiveFallback(uid, value, now);
        return value;
      }
    } catch (err) {
      warnRedisThrottled('user-active-read', { err, uid }, '[auth] user active cache read failed, falling back to DB');
    }
  }

  const { rows } = await db.query(
    'SELECT 1 FROM users WHERE uid=$1 AND deleted_at IS NULL',
    [uid],
  );
  const isActive = rows.length > 0;
  setUserActiveFallback(uid, isActive, now);

  if (_redis) {
    try {
      await _redis.setex(cacheKey, USER_ACTIVE_CACHE_TTL_SECONDS, isActive ? '1' : '0');
    } catch (err) {
      warnRedisThrottled('user-active-write', { err, uid }, '[auth] user active cache write failed');
    }
  }

  return isActive;
}

async function invalidateUserActiveCache(uid) {
  if (!uid) return;
  userActiveFallbackCache.delete(uid);
  const _redis = getRedis();
  if (!_redis) return;
  try {
    await _redis.del(getUserActiveCacheKey(uid));
  } catch (err) {
    warnRedisThrottled('user-active-del', { err, uid }, '[auth] user active cache invalidate failed');
  }
}

/**
 * Записать jti как отозванный.
 * Вызывается из routes/auth.js при logout.
 * ttlSeconds = оставшееся время жизни JWT (exp - now).
 */
async function markTokenRevoked(jti, expUnixSec) {
  const ttl    = Math.max(1, expUnixSec - Math.floor(Date.now() / 1000));
  const _redis = getRedis();
  if (_redis) {
    try {
      await _redis.setex(`revoked:${jti}`, ttl, '1');
    } catch (err) {
      warnRedisThrottled('revoked-write', { err, jti }, '[auth] redis write failed — token stored only in DB');
    }
  }
  // Всегда пишем в DB как источник истины при рестарте Redis
  await db.query(
    `INSERT INTO token_revocations(jti, expires_at)
     VALUES($1, to_timestamp($2)) ON CONFLICT DO NOTHING`,
    [jti, expUnixSec],
  );
}

module.exports = async function requireAuth(req, res, next) {
  let token = req.cookies?.token || null;

  if (!token) {
    const header = req.headers.authorization || '';
    token = header.startsWith('Bearer ') ? header.slice(7) : null;
  }

  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });

    // FIX [PERF]: проверка через Redis-кеш (O(1)) вместо DB-запроса на каждый request
    if (payload.jti) {
      const revoked = await isTokenRevoked(payload.jti);
      if (revoked) return res.status(401).json({ error: 'Token revoked' });
    }

    // Проверка активного пользователя может быть выключена только явным флагом
    // (например, в отдельных unit-тестах роутов, где не мокается users lookup).
    // По умолчанию (включая test) проверка включена.
    const shouldCheckActiveUser = process.env.AUTH_SKIP_ACTIVE_CHECK !== '1';
    if (shouldCheckActiveUser) {
      const activeUser = await isUserActive(payload.uid);
      if (!activeUser) {
        return res.status(401).json({ error: 'User not found or deleted' });
      }
    }

    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

module.exports.markTokenRevoked = markTokenRevoked;
module.exports.invalidateUserActiveCache = invalidateUserActiveCache;
if (process.env.NODE_ENV === 'test') {
  module.exports.__clearUserActiveFallbackCache = () => userActiveFallbackCache.clear();
  module.exports.__clearRedisWarnThrottle = () => redisWarnAtByScope.clear();
}
