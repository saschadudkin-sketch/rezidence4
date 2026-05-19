'use strict';

const express = require('express');
const supertest = require('supertest');

jest.mock('../logger', () => require('../__mocks__/logger'));
jest.mock('../lib/redisClient', () => ({
  getRedis: jest.fn(() => null),
}));

let mockCurrentUser = null;
jest.mock('../middleware/auth', () => (req, res, next) => {
  if (!mockCurrentUser) return res.status(401).json({ error: 'auth not set' });
  req.user = mockCurrentUser;
  next();
});

const analyticsRouter = require('../routes/analytics');

function buildApp(db = { query: jest.fn() }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.db = db;
    req.propertySlug = 'test-property';
    next();
  });
  app.use('/api/v1/analytics', analyticsRouter);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    res.status(500).json({ error: String(err && err.message || err) });
  });
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = { uid: 'admin-1', role: 'admin' };
});

describe('legacy v1 analytics route contract', () => {
  test('traffic rejects unsupported granularity instead of silently falling back', async () => {
    const db = { query: jest.fn() };

    const res = await supertest(buildApp(db))
      .get('/api/v1/analytics/traffic?granularity=week');

    expect(res.status).toBe(400);
    expect(res.body.error).toEqual({
      code: 'INVALID_GRANULARITY',
      message: 'granularity must be hour or day',
    });
    expect(db.query).not.toHaveBeenCalled();
  });

  test('SLA rejects inverted date ranges before querying', async () => {
    const db = { query: jest.fn() };

    const res = await supertest(buildApp(db))
      .get('/api/v1/analytics/sla?from=2026-05-20T00:00:00.000Z&to=2026-05-19T00:00:00.000Z');

    expect(res.status).toBe(400);
    expect(res.body.error).toEqual({
      code: 'INVALID_RANGE',
      message: 'from must be before or equal to to',
    });
    expect(db.query).not.toHaveBeenCalled();
  });
});
