'use strict';

const express = require('express');
const request = require('supertest');
const { registerObservabilityRoutes } = require('../app/registerObservabilityRoutes');

jest.mock('../middleware/auth', () => {
  const fn = (_req, _res, next) => next();
  return fn;
});

jest.mock('../logger', () => ({
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
}));

jest.mock('../metrics', () => ({
  getSnapshot: () => ({
    authRefreshRequests: 0,
    authRefreshSuccess: 0,
    authRefreshFailed: 0,
    authRefreshLegacyFallbackUsed: 0,
    latency: { p50: 0, p95: 0, p99: 0, sampleCount: 0 },
  }),
}));

jest.mock('../sse', () => ({
  clients: new Map(),
}));

const mockGetRedis = jest.fn(() => null);

jest.mock('../lib/redisClient', () => ({
  getRedis: () => mockGetRedis(),
}));

function buildApp(dbOverrides = {}) {
  const app = express();
  registerObservabilityRoutes(app, {
    db: {
      query: jest.fn().mockResolvedValue({ rows: [{ ts: new Date().toISOString() }] }),
      pool: { totalCount: 0, idleCount: 0, waitingCount: 0 },
      ...dbOverrides,
    },
  });
  return app;
}

beforeEach(() => {
  mockGetRedis.mockReset();
  mockGetRedis.mockReturnValue(null);
});

describe('GET /api/docs/openapi.json', () => {
  test('serves machine-readable OpenAPI spec', async () => {
    const app = buildApp();

    const res = await request(app).get('/api/docs/openapi.json');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.openapi).toBe('3.0.3');
    expect(res.body.paths['/api/v1/requests']).toBeDefined();
  });
});

describe('GET /api/health', () => {
  test('returns stable health payload', async () => {
    const app = buildApp();

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.ts).toBe('string');
  });
});

describe('GET /health', () => {
  test('returns ok when database is up and redis is unconfigured', async () => {
    const res = await request(buildApp()).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.checks).toMatchObject({
      db: 'ok',
      redis: 'unconfigured',
    });
  });

  test('returns ok when configured redis responds to ping', async () => {
    mockGetRedis.mockReturnValue({ ping: jest.fn().mockResolvedValue('PONG') });

    const res = await request(buildApp()).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.checks).toMatchObject({
      db: 'ok',
      redis: 'ok',
    });
  });

  test('returns 503 when configured redis ping fails', async () => {
    mockGetRedis.mockReturnValue({ ping: jest.fn().mockRejectedValue(new Error('redis down')) });

    const res = await request(buildApp()).get('/health');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('error');
    expect(res.body.checks).toMatchObject({
      db: 'ok',
      redis: 'error',
    });
  });
});
