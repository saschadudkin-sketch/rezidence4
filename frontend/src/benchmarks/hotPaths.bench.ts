/**
 * T-05: Vitest performance benchmarks for hot-path functions.
 *
 * Run with: npx vitest bench
 *
 * Hot paths under test:
 *   - validatePassByRules   — called on every QR scan
 *   - normalizePhone        — called in blacklist checks and login
 *   - normalizeCarPlate     — called in blacklist checks
 *   - genId                 — called on every new pass/request creation
 */

import { bench, describe } from 'vitest';
import { validatePassByRules } from '../domain/passValidation';
import { normalizePhone, findByPhone } from '../utils/phoneUtils';
import { genId } from '../utils/idUtils';

// ─── fixtures ────────────────────────────────────────────────────────────────

const BLACKLIST = Array.from({ length: 200 }, (_, i) => ({
  userId: `user-${i}`,
  phone: `+7 916 ${String(i).padStart(3, '0')}-00-00`,
  carPlate: `А${String(i).padStart(3, '0')}АА77`,
}));

const PASS_ALLOWED = {
  userId: 'user-9999',
  visitorPhone: '+7 999 999-99-99',
  carPlate: 'О999ОО77',
  validUntil: new Date(Date.now() + 86_400_000).toISOString(),
};

const PASS_BLACKLISTED = {
  userId: 'user-100',
  visitorPhone: '+7 916 100-00-00',
  carPlate: 'А100АА77',
  validUntil: new Date(Date.now() + 86_400_000).toISOString(),
};

const PHONE_DB: Record<string, unknown> = Object.fromEntries(
  Array.from({ length: 500 }, (_, i) => [`7916${String(i).padStart(7, '0')}`, { uid: `u${i}` }]),
);

// ─── benchmarks ──────────────────────────────────────────────────────────────

describe('validatePassByRules — hot path (QR scan)', () => {
  bench('allowed pass, 200-entry blacklist', () => {
    validatePassByRules(PASS_ALLOWED, { blacklist: BLACKLIST });
  });

  bench('blacklisted pass (worst-case linear scan)', () => {
    validatePassByRules(PASS_BLACKLISTED, { blacklist: BLACKLIST });
  });

  bench('null pass (early return)', () => {
    validatePassByRules(null, { blacklist: BLACKLIST });
  });
});

describe('normalizePhone — called on every blacklist entry comparison', () => {
  bench('Russian mobile 8-prefix format', () => {
    normalizePhone('8-916-123-45-67');
  });

  bench('International +7 format', () => {
    normalizePhone('+7 (916) 123-45-67');
  });

  bench('10-digit bare format', () => {
    normalizePhone('9161234567');
  });
});

describe('findByPhone — login lookup', () => {
  bench('existing user lookup (500-entry db)', () => {
    findByPhone('79160000123', PHONE_DB);
  });

  bench('missing user lookup (500-entry db)', () => {
    findByPhone('70000000000', PHONE_DB);
  });
});

describe('genId — pass/request creation', () => {
  bench('generate ID with prefix', () => {
    genId('req-');
  });

  bench('generate ID no prefix', () => {
    genId();
  });
});
