'use strict';

// Тесты конфигурации.  collectConfigErrors — pure функция, поэтому
// тестируется без мока process.exit.

const { collectConfigErrors, getAppConfig } = require('../config/appConfig');

const VALID_BASE = {
  JWT_SECRET: 'a'.repeat(32),
  DATABASE_URL: 'postgres://u:p@db.example.com/app?sslmode=require',
};

const VALID_PROD = {
  ...VALID_BASE,
  NODE_ENV: 'production',
  PLATFORM_DB_URL: 'postgres://u:p@platform.example.com/registry?sslmode=require',
  PLATFORM_JWT_SECRET: 'b'.repeat(32),
  FRONTEND_URL: 'https://app.example.com',
  UPLOAD_SIGNING_SECRET: 'c'.repeat(32),
  PLATFORM_ALLOWED_HOSTNAME_SUFFIX: 'example.com',
};

describe('collectConfigErrors — base', () => {
  test('пустой env — JWT_SECRET и DATABASE_URL обязательны', () => {
    const errs = collectConfigErrors({}, false);
    expect(errs).toEqual(expect.arrayContaining([
      expect.stringMatching(/JWT_SECRET/),
      expect.stringMatching(/DATABASE_URL/),
    ]));
  });

  test('JWT_SECRET < 32 chars — error', () => {
    const errs = collectConfigErrors({ ...VALID_BASE, JWT_SECRET: 'short' }, false);
    expect(errs.some((m) => m.includes('JWT_SECRET'))).toBe(true);
  });

  test('valid base config — no errors (dev)', () => {
    const errs = collectConfigErrors(VALID_BASE, false);
    expect(errs).toEqual([]);
  });
});

describe('collectConfigErrors — production gates', () => {
  test('valid prod config — no errors', () => {
    const errs = collectConfigErrors(VALID_PROD, true);
    expect(errs).toEqual([]);
  });

  test('PLATFORM_JWT_SECRET == JWT_SECRET — error', () => {
    const errs = collectConfigErrors(
      { ...VALID_PROD, PLATFORM_JWT_SECRET: VALID_PROD.JWT_SECRET },
      true,
    );
    expect(errs.some((m) => m.includes('PLATFORM_JWT_SECRET must differ'))).toBe(true);
  });

  test('FRONTEND_URL отсутствует в prod — error', () => {
    const env = { ...VALID_PROD };
    delete env.FRONTEND_URL;
    const errs = collectConfigErrors(env, true);
    expect(errs.some((m) => m.includes('FRONTEND_URL'))).toBe(true);
  });

  test('tenant hostname allowlist отсутствует в prod — error', () => {
    const env = { ...VALID_PROD };
    delete env.PLATFORM_ALLOWED_HOSTNAME_SUFFIX;
    delete env.PLATFORM_ALLOWED_HOSTNAMES;
    const errs = collectConfigErrors(env, true);
    expect(errs.some((m) => m.includes('PLATFORM_ALLOWED_HOSTNAME_SUFFIX'))).toBe(true);
  });
});

describe('collectConfigErrors — SSL mode (AUDIT-SSL)', () => {
  test('prod без sslmode — error для DATABASE_URL', () => {
    const errs = collectConfigErrors(
      { ...VALID_PROD, DATABASE_URL: 'postgres://u:p@db.example.com/app' },
      true,
    );
    expect(errs.some((m) => /DATABASE_URL.*sslmode=require/.test(m))).toBe(true);
  });

  test('prod без sslmode — error для PLATFORM_DB_URL', () => {
    const errs = collectConfigErrors(
      { ...VALID_PROD, PLATFORM_DB_URL: 'postgres://u:p@platform.example.com/registry' },
      true,
    );
    expect(errs.some((m) => /PLATFORM_DB_URL.*sslmode=require/.test(m))).toBe(true);
  });

  test('prod sslmode=prefer — error (downgrade-friendly)', () => {
    const errs = collectConfigErrors(
      { ...VALID_PROD, DATABASE_URL: 'postgres://u:p@db.example.com/app?sslmode=prefer' },
      true,
    );
    expect(errs.some((m) => /DATABASE_URL.*sslmode=require/.test(m))).toBe(true);
  });

  test('prod sslmode=allow — error (downgrade-friendly)', () => {
    const errs = collectConfigErrors(
      { ...VALID_PROD, DATABASE_URL: 'postgres://u:p@db.example.com/app?sslmode=allow' },
      true,
    );
    expect(errs.some((m) => /DATABASE_URL.*sslmode=require/.test(m))).toBe(true);
  });

  test.each([
    ['?sslmode=require'],
    ['?sslmode=verify-ca'],
    ['?sslmode=verify-full'],
  ])('prod %s — accepted', (suffix) => {
    const errs = collectConfigErrors(
      { ...VALID_PROD, DATABASE_URL: `postgres://u:p@db.example.com/app${suffix}` },
      true,
    );
    expect(errs.filter((m) => /DATABASE_URL.*sslmode/.test(m))).toEqual([]);
  });

  test('PG_SSL_REQUIRED=0 — opt-out (без error)', () => {
    const errs = collectConfigErrors(
      { ...VALID_PROD, PG_SSL_REQUIRED: '0',
        DATABASE_URL: 'postgres://u:p@db.example.com/app' },
      true,
    );
    expect(errs.filter((m) => /sslmode/.test(m))).toEqual([]);
  });

  test('dev (prod=false) — sslmode не требуется', () => {
    const errs = collectConfigErrors(VALID_BASE, false);
    expect(errs.filter((m) => /sslmode/.test(m))).toEqual([]);
  });

  test('SSL gate проверяет оба URL независимо', () => {
    const errs = collectConfigErrors(
      {
        ...VALID_PROD,
        DATABASE_URL: 'postgres://u:p@a/x',
        PLATFORM_DB_URL: 'postgres://u:p@b/y',
      },
      true,
    );
    expect(errs.filter((m) => /sslmode/.test(m)).length).toBe(2);
  });
});

describe('getAppConfig', () => {
  test('default port 3001', () => {
    expect(getAppConfig({}).port).toBe(3001);
  });

  test('frontendUrl в prod пустой если не задан', () => {
    const cfg = getAppConfig({ NODE_ENV: 'production' });
    expect(cfg.frontendUrl).toBe('');
  });

  test('frontendUrl в dev — список локальных host', () => {
    const cfg = getAppConfig({});
    expect(cfg.frontendUrl).toContain('localhost:5173');
    expect(cfg.frontendUrl).toContain('localhost:3000');
  });

  test('trustProxy=1 в prod по дефолту', () => {
    const cfg = getAppConfig({ NODE_ENV: 'production' });
    expect(cfg.trustProxy).toBe(1);
  });

  test('TRUST_PROXY_HOPS=2 переопределяет default', () => {
    const cfg = getAppConfig({ NODE_ENV: 'production', TRUST_PROXY_HOPS: '2' });
    expect(cfg.trustProxy).toBe(2);
  });
});
