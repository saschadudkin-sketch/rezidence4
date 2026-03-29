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
      const { event, data } = JSON.parse(raw);
      if (event === 'request_update') {
        sse.localBroadcastRequestUpdate(data);
      } else {
        sse.localBroadcastToAll(event, data);
      }
    } catch (e) {
      logger.warn({ err: e }, '[redis-sub] malformed message');
    }
  });

  sse.setRedisPublish((event, data) => {
    if (pub) {
      pub.publish(CHANNEL, JSON.stringify({ event, data })).catch(() => {});
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
