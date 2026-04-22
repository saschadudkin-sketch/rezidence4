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
    payload = jwt.verify(token, process.env.PLATFORM_JWT_SECRET);
  } catch (err) {
    logger.warn({ err }, '[platformAuth] token verification failed');
    return res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' },
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
