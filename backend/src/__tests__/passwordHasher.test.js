'use strict';

const bcrypt = require('bcryptjs');
const passwordHasher = require('../utils/passwordHasher');

describe('passwordHasher', () => {
  test('hash/compare round-trip', async () => {
    const encoded = await passwordHasher.hash('123456');
    await expect(passwordHasher.compare('123456', encoded)).resolves.toBe(true);
    await expect(passwordHasher.compare('000000', encoded)).resolves.toBe(false);
  });

  test('compare returns false for malformed payloads', async () => {
    await expect(passwordHasher.compare('123', null)).resolves.toBe(false);
    await expect(passwordHasher.compare('123', 'bcrypt$abc')).resolves.toBe(false);
    await expect(passwordHasher.compare('123', 'scrypt$v2$salt$deadbeef')).resolves.toBe(false);
    await expect(passwordHasher.compare('123', 'scrypt$v1$salt$zzzz')).resolves.toBe(false);
    await expect(passwordHasher.compare('123', 'scrypt$v1$salt$deadbeef')).resolves.toBe(false);
  });

  test('supports legacy format scrypt$<salt>$<hash>', async () => {
    const encoded = await passwordHasher.hash('654321');
    const [algo, version, salt, hash] = encoded.split('$');
    expect(algo).toBe('scrypt');
    expect(version).toBe('v1');
    const legacy = `scrypt$${salt}$${hash}`;
    await expect(passwordHasher.compare('654321', legacy)).resolves.toBe(true);
  });

  test('supports legacy bcrypt hashes from v3 deployment', async () => {
    const legacy = await bcrypt.hash('777888', 10);
    await expect(passwordHasher.compare('777888', legacy)).resolves.toBe(true);
    await expect(passwordHasher.compare('000000', legacy)).resolves.toBe(false);
  });
});
