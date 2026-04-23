'use strict';

/**
 * Phase 5 — POST /platform/api/v1/notifications/outbox/retry endpoint tests.
 * Spec: notifications-outbox-spec.md §4.5 (superadmin cross-tenant retry).
 *
 * Scope:
 *   • auth: 401 without bearer (real platformAuth in place).
 *   • 400 when property_slug missing OR validation bubbles.
 *   • 404 when property inactive or unknown.
 *   • 503 when platform registry down OR getPropertyPool throws OR
 *     tenant query rejects.
 *   • 200 happy path — response echoes property_slug + revived[].
 */

const { describe, test, expect, beforeEach } = require('@jest/globals');
const express = require('express');
const supertest = require('supertest');

jest.mock('../logger', () => require('../__mocks__/logger'));

const { createRouter } = require('../routes/platform/outboxRetry');

function buildApp(deps) {
  const app = express();
  app.use(express.json());
  app.use('/platform/api/v1/notifications/outbox/retry', createRouter(deps));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    res.status(500).json({ error: String(err && err.message || err) });
  });
  return app;
}

function passAuth(_req, _res, next) { next(); }

beforeEach(() => { jest.clearAllMocks(); });

// ══════════════════════════════════════════════════════════════════════════════
// auth
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /platform/api/v1/notifications/outbox/retry — auth', () => {
  test('401 without bearer token', async () => {
    const app = buildApp({
      getPlatformDb: () => ({ query: jest.fn() }),
      getPropertyPool: jest.fn(),
      resolvePropertyBySlug: jest.fn(),
      resurrectOutboxRows: jest.fn(),
      // platformAuth deliberately NOT passed — use real middleware.
    });
    const res = await supertest(app)
      .post('/platform/api/v1/notifications/outbox/retry')
      .send({ property_slug: 'alpha', status: 'dead' });
    expect(res.status).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// validation
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /platform/api/v1/notifications/outbox/retry — validation', () => {
  test('400 when property_slug missing', async () => {
    const app = buildApp({
      platformAuth: passAuth,
      getPlatformDb: () => ({ query: jest.fn() }),
      getPropertyPool: jest.fn(),
      resolvePropertyBySlug: jest.fn(),
      resurrectOutboxRows: jest.fn(),
    });
    const res = await supertest(app)
      .post('/platform/api/v1/notifications/outbox/retry')
      .send({ status: 'dead' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/property_slug/);
  });

  test('400 when property_slug is empty string', async () => {
    const app = buildApp({
      platformAuth: passAuth,
      getPlatformDb: () => ({ query: jest.fn() }),
      getPropertyPool: jest.fn(),
      resolvePropertyBySlug: jest.fn(),
      resurrectOutboxRows: jest.fn(),
    });
    const res = await supertest(app)
      .post('/platform/api/v1/notifications/outbox/retry')
      .send({ property_slug: '   ', status: 'dead' });
    expect(res.status).toBe(400);
  });

  test('400 when resurrectOutboxRows throws TypeError (validation error)', async () => {
    const app = buildApp({
      platformAuth: passAuth,
      getPlatformDb: () => ({ query: jest.fn() }),
      resolvePropertyBySlug: async () => ({ id: 'p1', slug: 'alpha', db_connection_url: 'x' }),
      getPropertyPool: () => ({ query: jest.fn() }),
      resurrectOutboxRows: jest.fn().mockImplementation(() => {
        throw new TypeError('ids and status are mutually exclusive');
      }),
    });
    const res = await supertest(app)
      .post('/platform/api/v1/notifications/outbox/retry')
      .send({ property_slug: 'alpha', ids: ['a'], status: 'dead' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/mutually exclusive/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 404 unknown/inactive property
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /platform/api/v1/notifications/outbox/retry — property not found', () => {
  test('404 when resolvePropertyBySlug returns null', async () => {
    const app = buildApp({
      platformAuth: passAuth,
      getPlatformDb: () => ({ query: jest.fn() }),
      resolvePropertyBySlug: async () => null,
      getPropertyPool: jest.fn(),
      resurrectOutboxRows: jest.fn(),
    });
    const res = await supertest(app)
      .post('/platform/api/v1/notifications/outbox/retry')
      .send({ property_slug: 'ghost', status: 'dead' });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found|inactive/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 503 infrastructure errors
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /platform/api/v1/notifications/outbox/retry — 503 infra errors', () => {
  test('503 when platform registry reject', async () => {
    const app = buildApp({
      platformAuth: passAuth,
      getPlatformDb: () => ({ query: jest.fn() }),
      resolvePropertyBySlug: async () => { throw new Error('platform db down'); },
      getPropertyPool: jest.fn(),
      resurrectOutboxRows: jest.fn(),
    });
    const res = await supertest(app)
      .post('/platform/api/v1/notifications/outbox/retry')
      .send({ property_slug: 'alpha', status: 'dead' });
    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/platform db down/);
  });

  test('503 when getPropertyPool throws', async () => {
    const app = buildApp({
      platformAuth: passAuth,
      getPlatformDb: () => ({ query: jest.fn() }),
      resolvePropertyBySlug: async () => ({ id: 'p1', slug: 'alpha', db_connection_url: null }),
      getPropertyPool: () => { throw new Error('missing db_connection_url'); },
      resurrectOutboxRows: jest.fn(),
    });
    const res = await supertest(app)
      .post('/platform/api/v1/notifications/outbox/retry')
      .send({ property_slug: 'alpha', status: 'dead' });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/missing db_connection_url/);
  });

  test('503 when resurrectOutboxRows rejects with non-TypeError', async () => {
    const app = buildApp({
      platformAuth: passAuth,
      getPlatformDb: () => ({ query: jest.fn() }),
      resolvePropertyBySlug: async () => ({ id: 'p1', slug: 'alpha', db_connection_url: 'x' }),
      getPropertyPool: () => ({ query: jest.fn() }),
      resurrectOutboxRows: async () => { throw new Error('connection terminated'); },
    });
    const res = await supertest(app)
      .post('/platform/api/v1/notifications/outbox/retry')
      .send({ property_slug: 'alpha', status: 'dead' });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/connection terminated/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 200 happy path
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /platform/api/v1/notifications/outbox/retry — happy path', () => {
  test('200 echoes property_slug + revived + revivedIds', async () => {
    const resurrect = jest.fn().mockResolvedValue({
      revived: 5, revivedIds: ['a', 'b', 'c', 'd', 'e'],
    });
    const property = { id: 'p1', slug: 'alpha', db_connection_url: 'x' };
    const tenantPool = { query: jest.fn() };
    const getPool = jest.fn(() => tenantPool);

    const app = buildApp({
      platformAuth: passAuth,
      getPlatformDb: () => ({ query: jest.fn() }),
      resolvePropertyBySlug: async () => property,
      getPropertyPool: getPool,
      resurrectOutboxRows: resurrect,
    });
    const res = await supertest(app)
      .post('/platform/api/v1/notifications/outbox/retry')
      .send({ property_slug: 'alpha', status: 'dead', limit: 50 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      property_slug: 'alpha',
      revived: 5,
      revivedIds: ['a', 'b', 'c', 'd', 'e'],
    });
    // resurrect called with the tenant pool (not platform pool) and body params.
    expect(resurrect).toHaveBeenCalledTimes(1);
    expect(resurrect.mock.calls[0][0]).toBe(tenantPool);
    expect(resurrect.mock.calls[0][1]).toEqual({
      ids: undefined, status: 'dead', limit: 50,
    });
    // getPropertyPool called with the resolved property object.
    expect(getPool).toHaveBeenCalledWith(property);
  });

  test('trims whitespace from property_slug before lookup', async () => {
    const resolveBySlug = jest.fn(async () => ({ id: 'p1', slug: 'bravo', db_connection_url: 'x' }));
    const app = buildApp({
      platformAuth: passAuth,
      getPlatformDb: () => ({ query: jest.fn() }),
      resolvePropertyBySlug: resolveBySlug,
      getPropertyPool: () => ({ query: jest.fn() }),
      resurrectOutboxRows: async () => ({ revived: 0, revivedIds: [] }),
    });
    await supertest(app)
      .post('/platform/api/v1/notifications/outbox/retry')
      .send({ property_slug: '  bravo  ', status: 'dead' });
    // Second arg to resolvePropertyBySlug must be the trimmed slug.
    expect(resolveBySlug.mock.calls[0][1]).toBe('bravo');
  });
});
