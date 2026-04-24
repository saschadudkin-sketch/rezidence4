'use strict';

const jwt = require('jsonwebtoken');
const { getPlatformDb } = require('../db');
const logger = require('../logger');

/**
 * JWT middleware for platform superadmin routes.
 * Reads Bearer token from Authorization header, verifies with PLATFORM_JWT_SECRET.
 * Attaches req.platformAdmin = { id, email, name } on success.
 * Updates platform_admins.last_login_at in a fire-and-forget manner.
 */
async function platformAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Authorization header with Bearer token required' },
    });
  }

  let payload;
  try {
    // SEC [AUDIT #2]: алгоритм закреплён HS256 — без pinning jsonwebtoken по
    // умолчанию принимает любой `alg` из заголовка токена (включая `none` и
    // RS256→HS256 confusion если PLATFORM_JWT_SECRET когда-либо окажется
    // pub-key'ом). Это параллельный баг к auth.js:155, который уже pin'ит.
    payload = jwt.verify(token, process.env.PLATFORM_JWT_SECRET, { algorithms: ['HS256'] });
  } catch (err) {
    logger.warn({ err }, '[platformAuth] token verification failed');
    return res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' },
    });
  }

  // SEC [AUDIT #3]: явный audience-дискриминатор — даже если PLATFORM_JWT_SECRET
  // случайно окажется равным JWT_SECRET (см. config/appConfig.js guard), токен
  // резидента не пройдёт, потому что в нём aud != 'platform'.
  if (payload.aud !== 'platform') {
    logger.warn({ aud: payload.aud, id: payload.id }, '[platformAuth] wrong audience');
    return res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Token not scoped for platform' },
    });
  }

  const { id, email, name } = payload;
  if (!id || !email) {
    return res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Malformed token payload' },
    });
  }

  req.platformAdmin = { id, email, name };

  // Fire-and-forget: update last_login_at (non-blocking)
  getPlatformDb()
    .query('UPDATE platform_admins SET last_login_at = NOW() WHERE id = $1', [id])
    .catch((err) => logger.warn({ err, id }, '[platformAuth] failed to update last_login_at'));

  next();
}

module.exports = platformAuth;
