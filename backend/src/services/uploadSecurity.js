'use strict';

const crypto = require('crypto');
const db = require('../db');

const SIGN_TTL_SECONDS = Math.max(30, parseInt(process.env.UPLOAD_SIGNED_URL_TTL_SECONDS || '300', 10));

// FIX [SEC]: отдельный секрет от JWT_SECRET — компрометация одного не компрометирует другой.
// В production UPLOAD_SIGNING_SECRET обязателен — фейл-фаст при запуске предотвращает
// использование небезопасного дефолта.
function getSecret() {
  const secret = process.env.UPLOAD_SIGNING_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('[uploadSecurity] UPLOAD_SIGNING_SECRET is required in production. Set it in your environment.');
    }
    return 'dev-upload-signing-secret-change-in-production';
  }
  return secret;
}

function normalizeSignedPropertySlug(value) {
  const slug = String(value || '').trim().toLowerCase();
  if (!slug) return null;
  return /^[a-z0-9-]{1,80}$/.test(slug) ? slug : null;
}

function signaturePayload(filename, expiresAt, propertySlug = null) {
  const slug = normalizeSignedPropertySlug(propertySlug);
  return slug ? `${filename}:${expiresAt}:${slug}` : `${filename}:${expiresAt}`;
}

function getSignedUploadPropertySlug(query) {
  return normalizeSignedPropertySlug(query?.propertySlug || query?.property_slug || query?.ps);
}

function signUploadAccess(filename, expiresAt, propertySlug = null) {
  const payload = signaturePayload(filename, expiresAt, propertySlug);
  return crypto
    .createHmac('sha256', getSecret())
    .update(payload)
    .digest('hex');
}

function createSignedUploadUrl(filename, baseUrl, options = {}) {
  const expiresAt = Math.floor(Date.now() / 1000) + SIGN_TTL_SECONDS;
  const propertySlug = normalizeSignedPropertySlug(options.propertySlug || options.property_slug);
  const sig = signUploadAccess(filename, expiresAt, propertySlug);
  const params = new URLSearchParams({ exp: String(expiresAt), sig });
  if (propertySlug) params.set('ps', propertySlug);
  return `${baseUrl.replace(/\/+$/, '')}/uploads/${encodeURIComponent(filename)}?${params.toString()}`;
}

function verifySignedUploadQuery(filename, query) {
  const exp = Number(query?.exp || 0);
  const sig = String(query?.sig || '');
  if (!exp || !sig) return false;
  if (exp < Math.floor(Date.now() / 1000)) return false;
  if (process.env.NODE_ENV === 'production' && !getSignedUploadPropertySlug(query)) return false;
  const expected = signUploadAccess(filename, exp, getSignedUploadPropertySlug(query));
  // FIX [BUG]: crypto.timingSafeEqual бросает RangeError если буферы разной длины.
  // Malformed sig (не 64 hex-символа) → unhandled throw → 500 вместо 403.
  // Проверяем длину заранее — это не timing leak, так как длина expected фиксирована (64).
  const sigBuf = Buffer.from(sig, 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expBuf);
}

async function registerUploadMetadata({ ownerUid, filename, mimeType, byteSize, queryDb = db }) {
  if (!ownerUid || !filename) return;
  await queryDb.query(
    `INSERT INTO upload_objects(owner_uid, filename, mime_type, byte_size)
     VALUES($1, $2, $3, $4)
     ON CONFLICT (filename)
     DO UPDATE SET owner_uid = EXCLUDED.owner_uid,
                   mime_type = EXCLUDED.mime_type,
                   byte_size = EXCLUDED.byte_size,
                   updated_at = NOW()`,
    [ownerUid, filename, mimeType || null, Number(byteSize || 0) || null],
  );
}

async function auditUploadAccess({ filename, uid, decision, reason, via, req, queryDb = db }) {
  await queryDb.query(
    `INSERT INTO upload_access_audit(filename, uid, decision, reason, access_via, ip, user_agent)
     VALUES($1, $2, $3, $4, $5, $6, $7)`,
    [
      filename,
      uid || null,
      decision,
      reason || null,
      via || null,
      req?.ip || null,
      String(req?.headers?.['user-agent'] || '').slice(0, 512) || null,
    ],
  );
}

module.exports = {
  SIGN_TTL_SECONDS,
  createSignedUploadUrl,
  verifySignedUploadQuery,
  getSignedUploadPropertySlug,
  registerUploadMetadata,
  auditUploadAccess,
};
