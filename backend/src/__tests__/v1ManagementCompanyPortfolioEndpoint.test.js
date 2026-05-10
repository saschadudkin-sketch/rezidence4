'use strict';

const {
  describe, test, expect, beforeEach, jest: jestApi,
} = require('@jest/globals');
const express = require('express');
const supertest = require('supertest');

jest.mock('../logger', () => require('../__mocks__/logger'));

let mockCurrentUser = null;
jest.mock('../middleware/auth', () => (req, res, next) => {
  if (!mockCurrentUser) return res.status(401).json({ error: 'unauth' });
  req.user = mockCurrentUser;
  next();
});

const mockPlatformDb = { query: jestApi.fn() };

const { createRouter } = require('../v1/routes/managementCompanyPortfolio');

function buildApp({
  property = { id: 'prop-1', management_company_id: 'mc-1' },
  getPortfolio = jestApi.fn(async (opts) => ({
    management_company_id: opts.managementCompanyId,
    period: { key: opts.period.key, hours: opts.period.hours },
    filters: {
      property_slugs: opts.propertySlugs,
      include_inactive: opts.includeInactive,
    },
    rollup: { properties_total: 1 },
    properties: [],
    errors: [],
  })),
} = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (property) req.property = property;
    next();
  });
  app.use('/api/v1/management-company/portfolio', createRouter({
    getPlatformDb: () => mockPlatformDb,
    getPortfolio,
  }));
  return { app, getPortfolio };
}

beforeEach(() => {
  mockCurrentUser = null;
  mockPlatformDb.query.mockReset();
});

describe('GET /api/v1/management-company/portfolio', () => {
  test('401 when not authenticated', async () => {
    const { app } = buildApp();
    const res = await supertest(app).get('/api/v1/management-company/portfolio');
    expect(res.status).toBe(401);
  });

  test('403 for property admin because portfolio is company-level', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'property_admin' };
    const { app, getPortfolio } = buildApp();
    const res = await supertest(app).get('/api/v1/management-company/portfolio');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Management company admin only' });
    expect(getPortfolio).not.toHaveBeenCalled();
  });

  test('400 on unsupported period and invalid slug filter', async () => {
    mockCurrentUser = { uid: 'mc-1', role: 'management_company_admin' };
    const { app, getPortfolio } = buildApp();

    const badPeriod = await supertest(app)
      .get('/api/v1/management-company/portfolio?period=90d');
    expect(badPeriod.status).toBe(400);
    expect(badPeriod.body.error).toMatch(/unsupported period/);

    const badSlug = await supertest(app)
      .get('/api/v1/management-company/portfolio?property_slug=Bad_Slug');
    expect(badSlug.status).toBe(400);
    expect(badSlug.body.code).toBe('INVALID_PROPERTY_SLUG');
    expect(getPortfolio).not.toHaveBeenCalled();
  });

  test('400 when current property is not assigned to a management company', async () => {
    mockCurrentUser = { uid: 'mc-1', role: 'management_company_admin' };
    const { app, getPortfolio } = buildApp({ property: { id: 'prop-1' } });
    const res = await supertest(app).get('/api/v1/management-company/portfolio');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MANAGEMENT_COMPANY_REQUIRED');
    expect(getPortfolio).not.toHaveBeenCalled();
  });

  test('200 resolves company scope from req.property and passes filters to service', async () => {
    mockCurrentUser = { uid: 'mc-1', role: 'management_company_admin' };
    const { app, getPortfolio } = buildApp();

    const res = await supertest(app)
      .get('/api/v1/management-company/portfolio?period=24h&property_slug=alpha,beta&include_inactive=true');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.portfolio).toMatchObject({
      management_company_id: 'mc-1',
      period: { key: '24h', hours: 24 },
      filters: {
        property_slugs: ['alpha', 'beta'],
        include_inactive: true,
      },
    });
    expect(getPortfolio).toHaveBeenCalledWith({
      platformDb: mockPlatformDb,
      managementCompanyId: 'mc-1',
      period: { key: '24h', hours: 24, interval: '24 hours' },
      propertySlugs: ['alpha', 'beta'],
      includeInactive: true,
    });
  });

  test('passes service scope errors through without turning them into 503', async () => {
    mockCurrentUser = { uid: 'mc-1', role: 'management_company_admin' };
    const err = new Error('property_slug filter contains a property outside this portfolio or inactive');
    err.statusCode = 403;
    err.code = 'PROPERTY_FILTER_OUTSIDE_PORTFOLIO';
    err.details = { property_slugs: ['other'] };
    const { app } = buildApp({
      getPortfolio: jestApi.fn(async () => { throw err; }),
    });

    const res = await supertest(app).get('/api/v1/management-company/portfolio?property_slug=other');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      ok: false,
      code: 'PROPERTY_FILTER_OUTSIDE_PORTFOLIO',
      error: 'property_slug filter contains a property outside this portfolio or inactive',
      details: { property_slugs: ['other'] },
    });
  });
});
