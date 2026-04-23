'use strict';

/**
 * Phase 5 — /platform/api/v1/notifications/outbox/health unit tests.
 * Spec: notifications-outbox-spec.md §4.5 (platform-wide dashboard).
 *
 * Scope:
 *   • auth: 401 without bearer, 200 with valid platformAdmin (mocked via DI).
 *   • happy path: iterates properties, aggregates rollup correctly.
 *   • isolation: one bad tenant doesn't break the response; goes into
 *     errors_count + tenants[i].error.
 *   • 503 only when platform registry itself fails (listActiveProperties reject).
 *   • feature_enabled reflects NOTIFICATIONS_OUTBOX_ENABLED env var.
 */

const { describe, test, expect, beforeEach, afterEach } = require('@jest/globals');
const express = require('express');
const supertest = require('supertest');

jest.mock('../logger', () => require('../__mocks__/logger'));

const { createRouter } = require('../routes/platform/outboxHealth');

const ORIGINAL_FLAG = process.env.NOTIFICATIONS_OUTBOX_ENABLED;

function buildApp(deps) {
  const app = express();
  app.use(express.json());
  app.use('/platform/api/v1/notifications/outbox/health', createRouter(deps));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    res.status(500).json({ error: String(err && err.message || err) });
  });
  return app;
}

// DI-мок: platformAuth pass-through — отделяем «JWT-гейт работает» от
// «ручка аггрегирует по tenants корректно».  auth-путь проверен в
// отдельном test-suite для platformAuth middleware.
function passAuth(_req, _res, next) { next(); }

// Helper — собираем готовую строку, как возвращает aggregate SELECT.
function healthyRow(overrides = {}) {
  return {
    pending: '0',
    in_flight: '0',
    failed: '0',
    dead: '0',
    sent_last_24h: '0',
    stuck_in_flight: '0',
    oldest_pending_age_seconds: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  if (ORIGINAL_FLAG === undefined) {
    delete process.env.NOTIFICATIONS_OUTBOX_ENABLED;
  } else {
    process.env.NOTIFICATIONS_OUTBOX_ENABLED = ORIGINAL_FLAG;
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// auth (real platformAuth wiring — 401 without token)
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /platform/api/v1/notifications/outbox/health — auth', () => {
  test('401 without bearer token (real platformAuth)', async () => {
    // По умолчанию — реальный platformAuth без мока.  JWT_SECRET не задан /
    // токена нет → 401.  Это smoke-тест, что гейт вообще включён.
    const app = express();
    app.use(express.json());
    app.use(
      '/platform/api/v1/notifications/outbox/health',
      createRouter({
        getPlatformDb: () => ({ query: jest.fn() }),
        getPropertyPool: () => ({ query: jest.fn() }),
        listActiveProperties: async () => [],
      }),
    );
    const res = await supertest(app).get('/platform/api/v1/notifications/outbox/health');
    expect(res.status).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// happy path
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /platform/api/v1/notifications/outbox/health — aggregation', () => {
  test('returns rollup + per-tenant snapshots for 2 properties', async () => {
    const properties = [
      { id: 'p1', slug: 'alpha', db_connection_url: 'x' },
      { id: 'p2', slug: 'bravo', db_connection_url: 'y' },
    ];

    const queryAlpha = jest.fn().mockResolvedValue({
      rows: [healthyRow({ pending: '10', dead: '2', oldest_pending_age_seconds: '100' })],
    });
    const queryBravo = jest.fn().mockResolvedValue({
      rows: [healthyRow({ pending: '5', in_flight: '1', oldest_pending_age_seconds: '300' })],
    });

    const poolBySlug = {
      alpha: { query: queryAlpha },
      bravo: { query: queryBravo },
    };

    const app = buildApp({
      getPlatformDb: () => ({ query: jest.fn() }),
      listActiveProperties: async () => properties,
      getPropertyPool: (p) => poolBySlug[p.slug],
      platformAuth: passAuth,
    });

    const res = await supertest(app).get('/platform/api/v1/notifications/outbox/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.tenants_total).toBe(2);
    expect(res.body.errors_count).toBe(0);

    // Per-tenant snapshots present with slug + counts.
    const bySlug = Object.fromEntries(res.body.tenants.map((t) => [t.slug, t]));
    expect(bySlug.alpha.counts.pending).toBe(10);
    expect(bySlug.alpha.counts.dead).toBe(2);
    expect(bySlug.alpha.oldest_pending_age_seconds).toBe(100);
    expect(bySlug.bravo.counts.pending).toBe(5);
    expect(bySlug.bravo.oldest_pending_age_seconds).toBe(300);

    // Rollup: sums for counts, MAX for age.
    expect(res.body.rollup).toEqual({
      counts: { pending: 15, in_flight: 1, failed: 0, dead: 2, sent_last_24h: 0 },
      stuck_in_flight: 0,
      oldest_pending_age_seconds: 300, // MAX across tenants
    });
    expect(typeof res.body.ts).toBe('string');
  });

  test('empty properties list → rollup zeros and null age', async () => {
    const app = buildApp({
      getPlatformDb: () => ({ query: jest.fn() }),
      listActiveProperties: async () => [],
      getPropertyPool: jest.fn(),
      platformAuth: passAuth,
    });
    const res = await supertest(app).get('/platform/api/v1/notifications/outbox/health');
    expect(res.status).toBe(200);
    expect(res.body.tenants_total).toBe(0);
    expect(res.body.errors_count).toBe(0);
    expect(res.body.tenants).toEqual([]);
    expect(res.body.rollup.oldest_pending_age_seconds).toBeNull();
  });

  test('feature_enabled reflects NOTIFICATIONS_OUTBOX_ENABLED env var', async () => {
    process.env.NOTIFICATIONS_OUTBOX_ENABLED = 'true';
    const app = buildApp({
      getPlatformDb: () => ({ query: jest.fn() }),
      listActiveProperties: async () => [],
      getPropertyPool: jest.fn(),
      platformAuth: passAuth,
    });
    const res = await supertest(app).get('/platform/api/v1/notifications/outbox/health');
    expect(res.body.feature_enabled).toBe(true);

    delete process.env.NOTIFICATIONS_OUTBOX_ENABLED;
    const app2 = buildApp({
      getPlatformDb: () => ({ query: jest.fn() }),
      listActiveProperties: async () => [],
      getPropertyPool: jest.fn(),
      platformAuth: passAuth,
    });
    const res2 = await supertest(app2).get('/platform/api/v1/notifications/outbox/health');
    expect(res2.body.feature_enabled).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// partial-failure isolation
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /platform/api/v1/notifications/outbox/health — isolation', () => {
  test('one bad tenant does not break the response', async () => {
    const properties = [
      { id: 'p1', slug: 'healthy', db_connection_url: 'x' },
      { id: 'p2', slug: 'broken',  db_connection_url: 'y' },
      { id: 'p3', slug: 'alsofine', db_connection_url: 'z' },
    ];
    const poolBySlug = {
      healthy: { query: jest.fn().mockResolvedValue({
        rows: [healthyRow({ pending: '3' })],
      }) },
      broken: { query: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) },
      alsofine: { query: jest.fn().mockResolvedValue({
        rows: [healthyRow({ pending: '7' })],
      }) },
    };

    const app = buildApp({
      getPlatformDb: () => ({ query: jest.fn() }),
      listActiveProperties: async () => properties,
      getPropertyPool: (p) => poolBySlug[p.slug],
      platformAuth: passAuth,
    });

    const res = await supertest(app).get('/platform/api/v1/notifications/outbox/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.tenants_total).toBe(3);
    expect(res.body.errors_count).toBe(1);

    const bySlug = Object.fromEntries(res.body.tenants.map((t) => [t.slug, t]));
    expect(bySlug.healthy.counts.pending).toBe(3);
    expect(bySlug.alsofine.counts.pending).toBe(7);
    expect(bySlug.broken.error).toMatch(/ECONNREFUSED/);
    expect(bySlug.broken.counts).toBeUndefined();

    // Rollup excludes the broken tenant.
    expect(res.body.rollup.counts.pending).toBe(10); // 3 + 7, not +0 for broken
  });

  test('getPropertyPool throwing synchronously is treated as tenant error', async () => {
    const properties = [
      { id: 'p1', slug: 'ok',   db_connection_url: 'x' },
      { id: 'p2', slug: 'fail', db_connection_url: null /* bad URL */ },
    ];
    const app = buildApp({
      getPlatformDb: () => ({ query: jest.fn() }),
      listActiveProperties: async () => properties,
      getPropertyPool: (p) => {
        if (p.slug === 'fail') throw new Error('missing db_connection_url');
        return { query: jest.fn().mockResolvedValue({ rows: [healthyRow()] }) };
      },
      platformAuth: passAuth,
    });
    const res = await supertest(app).get('/platform/api/v1/notifications/outbox/health');
    expect(res.status).toBe(200);
    expect(res.body.errors_count).toBe(1);
    const broken = res.body.tenants.find((t) => t.slug === 'fail');
    expect(broken.error).toMatch(/missing db_connection_url/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// platform-registry failure → 503
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /platform/api/v1/notifications/outbox/health — platform registry down', () => {
  test('503 ok:false when listActiveProperties rejects', async () => {
    const app = buildApp({
      getPlatformDb: () => ({ query: jest.fn() }),
      listActiveProperties: async () => { throw new Error('platform DB unavailable'); },
      getPropertyPool: jest.fn(),
      platformAuth: passAuth,
    });
    const res = await supertest(app).get('/platform/api/v1/notifications/outbox/health');
    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/platform DB unavailable/);
  });
});
