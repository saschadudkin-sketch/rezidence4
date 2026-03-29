'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const KEYLEN = 64;
const VERSION = 'v1';
const COST = { N: 16384, r: 8, p: 1 };
// 128 * N * r — рекомендованная верхняя оценка памяти для scrypt.
const MAXMEM = 256 * COST.N * COST.r;

function scryptAsync(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEYLEN, { ...COST, maxmem: MAXMEM }, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(derivedKey.toString('hex'));
    });
  });
}

async function hash(value) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await scryptAsync(String(value), salt);
  return `scrypt$${VERSION}$${salt}$${derived}`;
}

async function compare(value, encoded) {
  try {
    if (!encoded || typeof encoded !== 'string') return false;
    // backward-compat: OTP hashes from pre-scrypt versions ($2b$ / $2a$ / $2y$)
    if (encoded.startsWith('$2')) {
      return bcrypt.compare(String(value), encoded);
    }
    const parts = encoded.split('$');
    if (parts[0] !== 'scrypt') return false;
    if (parts.length !== 3 && parts.length !== 4) return false;

    // backward-compat: scrypt$<salt>$<hash>
    const [ , vOrSalt, maybeSalt, maybeHash ] = parts;
    const salt = parts.length === 3 ? vOrSalt : maybeSalt;
    const expected = parts.length === 3 ? maybeSalt : maybeHash;
    if (parts.length === 4 && vOrSalt !== VERSION) return false;
    if (!salt || !expected) return false;
    if (!/^[a-f0-9]+$/i.test(expected)) return false;
    // timingSafeEqual требует одинаковую длину буферов.
    if (expected.length !== KEYLEN * 2) return false;

    const derived = await scryptAsync(String(value), salt);
    const actualBuf = Buffer.from(derived, 'hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    if (actualBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(actualBuf, expectedBuf);
  } catch (_) {
    return false;
  }
}

module.exports = { hash, compare };
