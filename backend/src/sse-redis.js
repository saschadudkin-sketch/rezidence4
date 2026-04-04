/**
 * sse-redis.js — Redis pub/sub adapter для SSE.
 *
 * При REDIS_URL: все broadcast идут в Redis pub/sub → каждый инстанс
 * подписан на канал и рассылает своим локальным клиентам.
 * Без REDIS_URL: fallback на in-memory (single-instance).
 *
 * ИЗМЕНЕНИЕ: pub использует shared getRedis() singleton.
 * sub — отдельный клиент (обязательно: Redis pub/sub запрещает другие команды
 * в режиме subscribe, поэтому subscriber всегда отдельное соединение).
 */

'use strict';
const logger     = require('./logger');
const { getRedis } = require('./lib/redisClient'); // shared pub-клиент

const CHANNEL = 'rz:sse_events';
let sub = null; // subscriber — ВСЕГДА отдельный клиент (ограничение протокола Redis)

function init() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return;

  const Redis = require('ioredis');
  const sse   = require('./sse');

  // pub — shared singleton из lib/redisClient
  const pub = getRedis();

  // sub — отдельный клиент: в режиме SUBSCRIBE Redis запрещает любые другие команды
  sub = new Redis(redisUrl, { lazyConnect: true });
  sub.on('error', (err) => logger.error({ err }, '[redis-sub] error'));

  sub.subscribe(CHANNEL, (err) => {
    if (err) logger.error({ err }, '[redis] subscribe failed');
    else     logger.info('[redis] SSE pub/sub active');
  });

  sub.on('message', (_channel, raw) => {
    try {
      const { event, data, targetRoles } = JSON.parse(raw);
      if (targetRoles && Array.isArray(targetRoles)) {
        // Role-restricted broadcast (e.g. blacklist events)
        sse.localBroadcastToRoles(event, data, new Set(targetRoles));
      } else if (event === 'request_update') {
        sse.localBroadcastRequestUpdate(data);
      } else {
        sse.localBroadcastToAll(event, data);
      }
    } catch (e) {
      logger.warn({ err: e }, '[redis-sub] malformed message');
    }
  });

  // fn signature: (event, data, targetRoles?) — targetRoles is string[] or undefined
  sse.setRedisPublish((event, data, targetRoles) => {
    if (pub) {
      const msg = { event, data };
      if (targetRoles) msg.targetRoles = targetRoles;
      pub.publish(CHANNEL, JSON.stringify(msg)).catch(() => {});
    }
  });

  logger.info('[redis] pub/sub initialized for SSE broadcast');
}

function shutdown() {
  const sse = require('./sse');
  sse.setRedisPublish(null);
  if (sub) {
    try { sub.unsubscribe(); sub.disconnect(); } catch { /* ignore */ }
    sub = null;
  }
  // pub (shared singleton) закрывается через closeRedis() в index.js graceful shutdown
}

module.exports = { init, shutdown };
