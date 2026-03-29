'use strict';
const jwt    = require('jsonwebtoken');
const db     = require('../db');
const logger = require('../logger');
const { getRedis } = require('../lib/redisClient'); // shared singleton — одно соединение на весь процесс

async function isTokenRevoked(jti) {
  const _redis = getRedis();
  // ── Redis path ──
  if (_redis) {
    try {
      const val = await _redis.get(`revoked:${jti}`);
      return val === '1';
    } catch (err) {
      logger.warn({ err, jti }, '[auth] redis check failed, falling back to DB');
      // Не бросаем — падаем на DB
    }
  }
  // ── DB fallback ──
  const { rows } = await db.query(
    'SELECT 1 FROM token_revocations WHERE jti=$1', [jti]
  );
  return rows.length > 0;
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
      logger.warn({ err, jti }, '[auth] redis write failed — token stored only in DB');
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
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    // FIX [PERF]: проверка через Redis-кеш (O(1)) вместо DB-запроса на каждый request
    if (payload.jti) {
      const revoked = await isTokenRevoked(payload.jti);
      if (revoked) return res.status(401).json({ error: 'Token revoked' });
    }

    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

module.exports.markTokenRevoked = markTokenRevoked;
