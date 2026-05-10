'use strict';

jest.mock('../db', () => ({
  getPlatformDb: jest.fn(),
}));

jest.mock('../middleware/auth', () => (req, _res, next) => {
  req.user = { uid: 'admin-1', role: 'admin', property_slug: 'some-zk' };
  next();
});

jest.mock('../middleware/propertyDb', () => ({
  invalidatePropertyCache: jest.fn(),
}));

const express = require('express');
const supertest = require('supertest');
const { getPlatformDb } = require('../db');
const { invalidatePropertyCache } = require('../middleware/propertyDb');

function makeDb() {
  return { query: jest.fn() };
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.propertySlug = 'some-zk';
    next();
  });
  app.use('/api/v1/admin', require('../routes/adminSettings'));
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('admin feature flags package gates', () => {
  test('GET resolves stored flags through the current property package', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce({
      rows: [{
        id: 'p-1',
        slug: 'some-zk',
        plan: 'core_access',
        feature_flags: { packages: true, qr_pass: true },
      }],
    });
    getPlatformDb.mockReturnValue(db);

    const res = await supertest(buildApp()).get('/api/v1/admin/feature-flags');

    expect(res.status).toBe(200);
    expect(res.body.qr_pass).toBe(true);
    expect(res.body.packages).toBe(false);
  });

  test('PATCH rejects enabling a module outside the property package', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce({
      rows: [{ id: 'p-1', plan: 'core_access', feature_flags: {} }],
    });
    getPlatformDb.mockReturnValue(db);

    const res = await supertest(buildApp())
      .patch('/api/v1/admin/feature-flags')
      .send({ packages: true });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PACKAGE_GATE');
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(invalidatePropertyCache).not.toHaveBeenCalled();
  });

  test('PATCH allows enabling a module included in the property package', async () => {
    const db = makeDb();
    db.query
      .mockResolvedValueOnce({
        rows: [{ id: 'p-1', plan: 'operations', feature_flags: {} }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    getPlatformDb.mockReturnValue(db);

    const res = await supertest(buildApp())
      .patch('/api/v1/admin/feature-flags')
      .send({ packages: true });

    expect(res.status).toBe(200);
    expect(res.body.packages).toBe(true);
    expect(invalidatePropertyCache).toHaveBeenCalledWith('some-zk');

    const updateCall = db.query.mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('UPDATE properties SET feature_flags'),
    );
    expect(JSON.parse(updateCall[1][0])).toEqual({ packages: true });
  });
});
