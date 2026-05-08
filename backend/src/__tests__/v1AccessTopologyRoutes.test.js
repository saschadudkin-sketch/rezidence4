'use strict';

const { describe, test, expect, beforeEach } = require('@jest/globals');
const express = require('express');
const supertest = require('supertest');

jest.mock('../db', () => ({
  query: jest.fn(),
}));
jest.mock('../logger', () => require('../__mocks__/logger'));

let mockCurrentUser = null;
jest.mock('../middleware/auth', () => (req, res, next) => {
  if (!mockCurrentUser) return res.status(401).json({ error: 'auth not set' });
  req.user = mockCurrentUser;
  next();
});

const db = require('../db');
const accessTopologyRouter = require('../v1/routes/accessTopology');

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const UUID_C = '33333333-3333-4333-8333-333333333333';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', accessTopologyRouter);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    res.status(500).json({ error: String(err && err.message || err) });
  });
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = null;
  db.query.mockResolvedValue({ rows: [] });
});

describe('access topology routes', () => {
  test('POST /api/v1/access-zones creates a checkpoint zone for the scoped property', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'admin', property_id: UUID_A };
    db.query.mockResolvedValueOnce({
      rows: [{
        id: UUID_B,
        property_id: UUID_A,
        name: 'КПП 1',
        zone_type: 'checkpoint',
        is_active: true,
        sort_order: 0,
        metadata: {},
      }],
    });

    const res = await supertest(buildApp())
      .post('/api/v1/access-zones')
      .send({
        property_id: UUID_A,
        name: 'КПП 1',
        zone_type: 'checkpoint',
        metadata: { lanes: 2 },
      });

    expect(res.status).toBe(201);
    expect(res.body.zone.name).toBe('КПП 1');
    const insert = db.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO access_zones'));
    expect(insert).toBeDefined();
    expect(insert[1][0]).toBe(UUID_A);
    expect(insert[1][6]).toBe(JSON.stringify({ lanes: 2 }));
  });

  test('POST /api/v1/access-zones rejects cross-property admin tokens', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'admin', property_id: UUID_B };

    const res = await supertest(buildApp())
      .post('/api/v1/access-zones')
      .send({ property_id: UUID_A, name: 'КПП 1', zone_type: 'checkpoint' });

    expect(res.status).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('GET /api/v1/access-points lists staff-readable points by property', async () => {
    mockCurrentUser = { uid: 'security-1', role: 'security', property_id: UUID_A };
    db.query.mockResolvedValueOnce({
      rows: [{
        id: UUID_C,
        property_id: UUID_A,
        zone_id: UUID_B,
        name: 'Шлагбаум КПП 1',
        point_type: 'barrier',
        is_active: true,
      }],
    });

    const res = await supertest(buildApp())
      .get(`/api/v1/access-points?property_id=${UUID_A}&is_active=true`);

    expect(res.status).toBe(200);
    expect(res.body.points).toHaveLength(1);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('FROM access_points');
    expect(sql).toContain('property_id = $1');
    expect(params[0]).toBe(UUID_A);
  });

  test('POST /api/v1/access-points rejects missing zone in same property', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'admin', property_id: UUID_A };
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await supertest(buildApp())
      .post('/api/v1/access-points')
      .send({
        property_id: UUID_A,
        zone_id: UUID_B,
        name: 'Шлагбаум КПП 1',
        point_type: 'barrier',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/zone_id/);
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  test('PATCH /api/v1/access-points/:id uses row ownership before update', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'admin', property_id: UUID_A };
    db.query
      .mockResolvedValueOnce({ rows: [{ property_id: UUID_A }] })
      .mockResolvedValueOnce({
        rows: [{
          id: UUID_C,
          property_id: UUID_A,
          zone_id: UUID_B,
          name: 'КПП въезд',
          point_type: 'checkpoint',
        }],
      });

    const res = await supertest(buildApp())
      .patch(`/api/v1/access-points/${UUID_C}`)
      .send({ name: 'КПП въезд' });

    expect(res.status).toBe(200);
    expect(db.query.mock.calls[0][0]).toContain('SELECT property_id FROM access_points');
    expect(db.query.mock.calls[1][0]).toContain('UPDATE access_points');
  });
});
