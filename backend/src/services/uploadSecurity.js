'use strict';

const crypto = require('crypto');
const db = require('../db');

const SIGN_TTL_SECONDS = Math.max(30, parseInt(process.env.UPLOAD_SIGNED_URL_TTL_SECONDS || '300', 10));

function getSecret() {
  return process.env.UPLOAD_SIGNING_SECRET || process.env.JWT_SECRET || 'dev-upload-signing-secret';
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
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
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
