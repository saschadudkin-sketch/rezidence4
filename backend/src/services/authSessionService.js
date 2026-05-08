'use strict';

const requireAuth = require('../middleware/auth');

const REFRESH_COOKIE_PATH = '/api';

function clearAuthCookies(res) {
  const baseOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
  };

  res.clearCookie('token', baseOptions);
  res.clearCookie('refreshToken', {
    ...baseOptions,
    path: REFRESH_COOKIE_PATH,
  });

  // Compatibility cleanup for historical cookie names used before the current
  // access/refresh split.
  res.clearCookie('rezi_at', { path: '/' });
  res.clearCookie('rezi_rt', { path: '/' });
}

async function deleteRefreshTokensForUser(queryDb, uid, { ignoreMissingTable = true } = {}) {
  if (!queryDb || typeof queryDb.query !== 'function') {
    throw new Error('queryDb with .query(sql, params) is required');
  }
  if (!uid) return;

  try {
    await queryDb.query(
      `DELETE FROM refresh_tokens WHERE uid=$1`,
      [uid],
    );
  } catch (err) {
    if (ignoreMissingTable && err?.code === '42P01') return;
    throw err;
  }
}

async function invalidateUserSessionCache(uid) {
  await requireAuth.invalidateUserActiveCache(uid);
}

async function revokeUserSessions(queryDb, uid, options) {
  await deleteRefreshTokensForUser(queryDb, uid, options);
  await invalidateUserSessionCache(uid);
}

module.exports = {
  REFRESH_COOKIE_PATH,
  clearAuthCookies,
  deleteRefreshTokensForUser,
  invalidateUserSessionCache,
  revokeUserSessions,
};
