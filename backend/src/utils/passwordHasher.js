'use strict';

const crypto = require('crypto');

const KEYLEN = 64;
const VERSION = 'v1';
const COST = { N: 16384, r: 8, p: 1 };

function scryptAsync(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEYLEN, COST, (err, derivedKey) => {
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
  if (!encoded || typeof encoded !== 'string') return false;
  const parts = encoded.split('$');
  if (parts[0] !== 'scrypt') return false;
  if (parts.length !== 3 && parts.length !== 4) return false;
  // backward-compat: scrypt$<salt>$<hash>
  const [ , vOrSalt, maybeSalt, maybeHash ] = parts;
  const salt = parts.length === 3 ? vOrSalt : maybeSalt;
  const expected = parts.length === 3 ? maybeSalt : maybeHash;
  if (parts.length === 4 && vOrSalt !== VERSION) return false;
  const derived = await scryptAsync(String(value), salt);
  return crypto.timingSafeEqual(Buffer.from(derived, 'hex'), Buffer.from(expected, 'hex'));
}

module.exports = { hash, compare };
