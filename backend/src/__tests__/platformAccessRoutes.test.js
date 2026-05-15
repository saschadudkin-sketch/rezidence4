'use strict';

const express = require('express');
const supertest = require('supertest');

jest.mock('../logger', () => require('../__mocks__/logger'));

const { createRouter } = require('../routes/platform/access');

const FIXED_NOW = new Date('2026-04-23T10:15:00.000Z');

function passAuth(_req, _res, next) {
  next();
}

function buildApp(deps = {}) {
  const app = express();
  app.use('/platform/api/v1/access', createRouter({
    now: () => FIXED_NOW,
    ...deps,
  }));
  app.use((err, _req, res, _next) => {
    res.status(500).json({ ok: false, error: String(err && err.message || err) });
  });
  return app;
}

function makePlatformDb(rows) {
  return {
    query: jest.fn().mockResolvedValue({ rows }),
  };
}

const PROPERTIES = [
  { id: 'p-1', slug: 'alpha', name: 'Alpha ЖК', is_active: true, plan: 'core_access' },
  { id: 'p-2', slug: 'beta', name: 'Beta ЖК', is_active: false, plan: 'core_access' },
  { id: 'p-3', slug: 'gamma', name: 'Gamma ЖК', is_active: true, plan: null },
];

describe('platform access routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('requires platform auth by default', async () => {
    const res = await supertest(buildApp({
      getPlatformDb: () => makePlatformDb(PROPERTIES),
    })).get('/platform/api/v1/access/overview');

    expect(res.status).toBe(401);
  });

  test('GET /overview returns non-tenant aggregate counters', async () => {
    const db = makePlatformDb(PROPERTIES);
    const res = await supertest(buildApp({
      platformAuth: passAuth,
      getPlatformDb: () => db,
    })).get('/platform/api/v1/access/overview');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      overview: {
        generated_at: FIXED_NOW.toISOString(),
        properties_total: 3,
        properties_active: 2,
        properties_inactive: 1,
        plans: {
          core_access: 1,
          unknown: 1,
        },
      },
    });
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('FROM properties'));
  });

  test('GET /property-health exposes platform registry health only', async () => {
    const res = await supertest(buildApp({
      platformAuth: passAuth,
      getPlatformDb: () => makePlatformDb(PROPERTIES),
    })).get('/platform/api/v1/access/property-health');

    expect(res.status).toBe(200);
    expect(res.body.properties).toEqual([
      {
        id: 'p-1',
        slug: 'alpha',
        name: 'Alpha ЖК',
        is_active: true,
        health: 'active',
        plan: 'core_access',
      },
      {
        id: 'p-2',
        slug: 'beta',
        name: 'Beta ЖК',
        is_active: false,
        health: 'inactive',
        plan: 'core_access',
      },
      {
        id: 'p-3',
        slug: 'gamma',
        name: 'Gamma ЖК',
        is_active: true,
        health: 'active',
        plan: null,
      },
    ]);
  });

  test('GET /incidents is an explicit safe placeholder until aggregation exists', async () => {
    const res = await supertest(buildApp({
      platformAuth: passAuth,
      getPlatformDb: () => makePlatformDb(PROPERTIES),
    })).get('/platform/api/v1/access/incidents');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      generated_at: FIXED_NOW.toISOString(),
      incidents: [],
      properties_total: 3,
      note: expect.stringContaining('per-property v1 APIs'),
    });
  });
});
