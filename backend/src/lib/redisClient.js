'use strict';
/**
 * lib/redisClient.js — единственный Redis-клиент для всего приложения.
 *
 * ПРОБЛЕМА: middleware/auth.js и middleware/idempotency.js каждый создавали
 * свой ioredis-клиент. Два отдельных TCP-соединения к Redis при том что
 * ioredis по умолчанию открывает connection pool. При 200 RPM → лишние roundtrip.
 *
 * РЕШЕНИЕ: единственный lazy-singleton. Все модули импортируют getRedis() —
 * одно соединение, общий error-handler, общая observability.
 */
const logger = require('../logger');

let _client = null;

/**
 * Возвращает shared Redis-клиент или null если REDIS_URL не задан.
 * Lazy init — не создаёт соединение при импорте, только при первом вызове.
 */
function getRedis() {
  if (_client) return _client;
  if (!process.env.REDIS_URL) return null;

  try {
    const Redis = require('ioredis');
    _client = new Redis(process.env.REDIS_URL, {
      lazyConnect:           true,
      maxRetriesPerRequest:  2,
      enableReadyCheck:      false,
      // При обрыве не блокируем запросы бесконечно — 3с таймаут
      connectTimeout:        3000,
    });

    _client.on('error',   (err) => logger.warn({ err }, '[redis] connection error'));
    _client.on('connect', ()    => logger.info('[redis] connected'));
    _client.on('close',   ()    => logger.warn('[redis] connection closed'));

    return _client;
  } catch (err) {
    logger.warn({ err }, '[redis] ioredis not available — Redis features disabled');
    return null;
  }
}

/**
 * Закрыть соединение (graceful shutdown).
 */
async function closeRedis() {
  if (_client) {
    try { await _client.quit(); } catch { /* force close */ }
    _client = null;
  }
}

module.exports = { getRedis, closeRedis };
