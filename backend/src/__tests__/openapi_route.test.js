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

jest.mock('../lib/redisClient', () => ({
  getRedis: () => null,
}));

describe('GET /api/docs/openapi.json', () => {
  test('serves machine-readable OpenAPI spec', async () => {
    const app = express();
    registerObservabilityRoutes(app, {
      db: {
        query: jest.fn().mockResolvedValue({ rows: [{ ts: new Date().toISOString() }] }),
        pool: { totalCount: 0, idleCount: 0, waitingCount: 0 },
      },
    });

    const res = await request(app).get('/api/docs/openapi.json');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.openapi).toBe('3.0.3');
    expect(res.body.paths['/api/v1/requests']).toBeDefined();
  });
});

describe('GET /api/health', () => {
  test('returns stable health payload', async () => {
    const app = express();
    registerObservabilityRoutes(app, {
      db: {
        query: jest.fn().mockResolvedValue({ rows: [{ ts: new Date().toISOString() }] }),
        pool: { totalCount: 0, idleCount: 0, waitingCount: 0 },
      },
    });

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.ts).toBe('string');
  });
});
