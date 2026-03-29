'use strict';
/**
 * middleware/idempotency.js
 *
 * При REDIS_URL — кеш через Redis (кластер-safe).
 * Без Redis — in-memory Map (single-instance fallback).
 *
 * ИЗМЕНЕНИЕ: заменён приватный `new Redis()` на shared getRedis() singleton.
 * Было два независимых ioredis-клиента (здесь + auth.js) → теперь один.
 */
const { getRedis } = require('../lib/redisClient');

const TTL_SECONDS = 86400; // 24 часа

// ─── In-memory fallback ───────────────────────────────────────────────────────
const memCache = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of memCache) {
    if (now - v.createdAt > TTL_SECONDS * 1000) memCache.delete(k);
  }
}, 3_600_000).unref();

// ─── Middleware ───────────────────────────────────────────────────────────────

async function idempotency(req, res, next) {
  const key = req.headers['idempotency-key'];
  if (!key) return next();

  if (typeof key !== 'string' || key.length > 256) {
    return res.status(400).json({ error: 'Idempotency-Key must be a string ≤ 256 chars' });
  }

  const cacheKey = `idem:${key}`;
  const redis    = getRedis(); // shared singleton — одно соединение на весь процесс

  try {
    if (redis) {
      const cached = await redis.get(cacheKey);
      if (cached) {
        const { status, body } = JSON.parse(cached);
        return res.status(status).json(body);
      }
    } else {
      const cached = memCache.get(cacheKey);
      if (cached) return res.status(cached.status).json(cached.body);
    }
  } catch { /* cache miss — proceed */ }

  const originalJson = res.json.bind(res);
  res.json = (body) => {
    const entry = { status: res.statusCode, body };
    if (redis) {
      redis.setex(cacheKey, TTL_SECONDS, JSON.stringify(entry)).catch(() => {});
    } else {
      memCache.set(cacheKey, { ...entry, createdAt: Date.now() });
    }
    return originalJson(body);
  };

  next();
}

module.exports = idempotency;
