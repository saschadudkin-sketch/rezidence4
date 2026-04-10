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

function signUploadAccess(filename, expiresAt) {
  const payload = `${filename}:${expiresAt}`;
  return crypto
    .createHmac('sha256', getSecret())
    .update(payload)
    .digest('hex');
}

function createSignedUploadUrl(filename, baseUrl) {
  const expiresAt = Math.floor(Date.now() / 1000) + SIGN_TTL_SECONDS;
  const sig = signUploadAccess(filename, expiresAt);
  return `${baseUrl.replace(/\/+$/, '')}/uploads/${encodeURIComponent(filename)}?exp=${expiresAt}&sig=${sig}`;
}

function verifySignedUploadQuery(filename, query) {
  const exp = Number(query?.exp || 0);
  const sig = String(query?.sig || '');
  if (!exp || !sig) return false;
  if (exp < Math.floor(Date.now() / 1000)) return false;
  const expected = signUploadAccess(filename, exp);
  // FIX [BUG]: crypto.timingSafeEqual бросает RangeError если буферы разной длины.
  // Malformed sig (не 64 hex-символа) → unhandled throw → 500 вместо 403.
  // Проверяем длину заранее — это не timing leak, так как длина expected фиксирована (64).
  const sigBuf = Buffer.from(sig, 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expBuf);
}

async function registerUploadMetadata({ ownerUid, filename, mimeType, byteSize }) {
  if (!ownerUid || !filename) return;
  await db.query(
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

async function auditUploadAccess({ filename, uid, decision, reason, via, req }) {
  await db.query(
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
  registerUploadMetadata,
  auditUploadAccess,
};
