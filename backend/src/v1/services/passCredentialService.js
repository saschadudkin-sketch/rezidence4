'use strict';

const crypto = require('crypto');

const PIN_RE = /^\d{4,8}$/;
const PIN_DIGITS = 6;

function credentialSecret() {
  return process.env.PASS_CREDENTIAL_SECRET
    || process.env.JWT_SECRET
    || 'domhub-dev-pass-credential-secret';
}

function credentialKey() {
  return crypto.createHash('sha256').update(credentialSecret()).digest();
}

function normalizePin(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const normalized = String(value).replace(/[\s-]/g, '');
  return PIN_RE.test(normalized) ? normalized : null;
}

function generatePin() {
  const max = 10 ** PIN_DIGITS;
  return String(crypto.randomInt(0, max)).padStart(PIN_DIGITS, '0');
}

function hashPin(pin) {
  const normalized = normalizePin(pin);
  if (!normalized) return null;
  return crypto
    .createHmac('sha256', credentialSecret())
    .update(`pin:${normalized}`)
    .digest('hex');
}

function credentialFingerprint(hash) {
  return typeof hash === 'string' ? hash.slice(0, 16) : null;
}

function encryptCredentialSecret(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', credentialKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return {
    credential_ciphertext: ciphertext.toString('base64'),
    credential_iv: iv.toString('base64'),
    credential_tag: cipher.getAuthTag().toString('base64'),
  };
}

function decryptCredentialSecret(row) {
  if (!row?.credential_ciphertext || !row?.credential_iv || !row?.credential_tag) return null;
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    credentialKey(),
    Buffer.from(row.credential_iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(row.credential_tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(row.credential_ciphertext, 'base64')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

module.exports = {
  PIN_RE,
  credentialFingerprint,
  decryptCredentialSecret,
  encryptCredentialSecret,
  generatePin,
  hashPin,
  normalizePin,
};
