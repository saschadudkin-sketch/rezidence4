'use strict';

const { describe, test, expect, beforeEach } = require('@jest/globals');
const express = require('express');
const supertest = require('supertest');

jest.mock('../logger', () => require('../__mocks__/logger'));

let mockCurrentUser = null;
jest.mock('../middleware/auth', () => (req, res, next) => {
  if (!mockCurrentUser) return res.status(401).json({ error: 'unauth' });
  req.user = mockCurrentUser;
  next();
});

const mockPool = { query: jest.fn() };
jest.mock('../db', () => ({
  pool: mockPool,
}));

jest.mock('../v1/services/operationsDashboard', () => ({
  parsePeriod: jest.fn((raw) => {
    const key = raw || '7d';
    if (!['24h', '7d', '30d'].includes(key)) throw new Error('bad period');
    return { key, hours: key === '24h' ? 24 : key === '30d' ? 720 : 168 };
  }),
  getOperationsDashboard: jest.fn(async (_db, opts) => ({
    generated_at: '2026-05-10T00:00:00.000Z',
    property_id: opts.propertyId,
    period: { key: opts.period, hours: opts.period === '24h' ? 24 : 168 },
    requests: {},
    access: {},
    incidents: {},
    notifications: {},
  })),
}));

const dashboardService = require('../v1/services/operationsDashboard');
const operationsDashboardRouter = require('../v1/routes/operationsDashboard');

function buildApp({ property = null } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (property) req.property = property;
    next();
  });
  app.use('/api/v1/admin/operations-dashboard', operationsDashboardRouter);
  return app;
}

beforeEach(() => {
  mockCurrentUser = null;
  mockPool.query.mockReset();
  dashboardService.parsePeriod.mockClear();
  dashboardService.getOperationsDashboard.mockClear();
});

const ADMIN = {
  uid: 'admin-1',
  role: 'admin',
  property_id: 'prop-from-user',
};

describe('GET /api/v1/admin/operations-dashboard', () => {
  test('401 when not authenticated', async () => {
    const res = await supertest(buildApp()).get('/api/v1/admin/operations-dashboard');
    expect(res.status).toBe(401);
  });

  test('403 for non-admin staff', async () => {
    mockCurrentUser = { uid: 'sec-1', role: 'security', property_id: 'p1' };
    const res = await supertest(buildApp()).get('/api/v1/admin/operations-dashboard');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Admin only' });
  });

  test('400 on unsupported period', async () => {
    mockCurrentUser = ADMIN;
    const res = await supertest(buildApp())
      .get('/api/v1/admin/operations-dashboard?period=90d');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/period/);
    expect(dashboardService.getOperationsDashboard).not.toHaveBeenCalled();
  });

  test('400 when property context is missing', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'admin' };
    const res = await supertest(buildApp()).get('/api/v1/admin/operations-dashboard');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/property_id required/);
  });

  test('200 returns dashboard snapshot and prefers req.property.id', async () => {
    mockCurrentUser = ADMIN;
    const res = await supertest(buildApp({ property: { id: 'prop-from-mw' } }))
      .get('/api/v1/admin/operations-dashboard?period=24h');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.dashboard.property_id).toBe('prop-from-mw');
    expect(dashboardService.getOperationsDashboard).toHaveBeenCalledWith(
      mockPool,
      { propertyId: 'prop-from-mw', period: '24h' },
    );
  });
});
