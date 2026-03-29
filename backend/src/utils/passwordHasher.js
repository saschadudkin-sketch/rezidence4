'use strict';

const crypto = require('crypto');

const KEYLEN = 64;

function scryptAsync(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEYLEN, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(derivedKey.toString('hex'));
    });
  });
}

async function hash(value) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await scryptAsync(String(value), salt);
  return `scrypt$${salt}$${derived}`;
}

async function compare(value, encoded) {
  if (!encoded || typeof encoded !== 'string') return false;
  const parts = encoded.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, expected] = parts;
  const derived = await scryptAsync(String(value), salt);
  return crypto.timingSafeEqual(Buffer.from(derived, 'hex'), Buffer.from(expected, 'hex'));
}

module.exports = { hash, compare };
