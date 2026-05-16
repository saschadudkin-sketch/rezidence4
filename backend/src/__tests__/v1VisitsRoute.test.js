'use strict';

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

jest.mock('../v1/services/visitService', () => ({
  VL_COLS: 'id, property_id, pass_id, access_point_id, event_type, event_source',
  createVisitLog: jest.fn(),
  isVisitServiceError: jest.fn(() => false),
  verifyVisit: jest.fn(),
}));

const db = require('../db');
const {
  createVisitLog,
  verifyVisit,
} = require('../v1/services/visitService');
const visitsRouter = require('../v1/routes/visits');

const UUID_PROPERTY = '11111111-1111-4111-8111-111111111111';
const UUID_POINT = '77777777-7777-4777-8777-777777777777';
const UUID_ZONE = '88888888-8888-4888-8888-888888888888';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/visits', visitsRouter);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    res.status(500).json({ error: String(err && err.message || err) });
  });
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = { uid: 'legacy-security-1', role: 'security' };
  db.query.mockResolvedValue({ rows: [] });
});

describe('v1 visits route access topology wiring', () => {
  test('verify rejects access_point_id that is not active for the property', async () => {
    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM access_points')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const res = await supertest(buildApp())
      .post('/api/v1/visits/verify')
      .send({
        property_id: UUID_PROPERTY,
        mode: 'qr',
        token: 'a'.repeat(32),
        access_point_id: UUID_POINT,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/access_point_id/);
    expect(verifyVisit).not.toHaveBeenCalled();
  });

  test('verify passes valid access_point_id into visit service', async () => {
    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM access_points')) {
        return Promise.resolve({ rows: [{ id: UUID_POINT, zone_id: UUID_ZONE }] });
      }
      throw new Error(`unexpected SQL: ${sql}`);
    });
    verifyVisit.mockResolvedValue({
      result: {
        verdict: { allowed: true, reason: null },
        visit_log_id: 'visit-1',
        incident_id: null,
      },
      pass: null,
    });

    const res = await supertest(buildApp())
      .post('/api/v1/visits/verify')
      .send({
        property_id: UUID_PROPERTY,
        mode: 'qr',
        token: 'a'.repeat(32),
        access_point_id: UUID_POINT,
      });

    expect(res.status).toBe(200);
    expect(verifyVisit).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ access_point_id: UUID_POINT, direction: 'entry' }),
    }));
  });

  test('verify accepts exit direction and returns it with the verdict', async () => {
    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM access_points')) {
        return Promise.resolve({ rows: [{ id: UUID_POINT, zone_id: UUID_ZONE }] });
      }
      throw new Error(`unexpected SQL: ${sql}`);
    });
    verifyVisit.mockResolvedValue({
      result: {
        verdict: { allowed: true, reason: null },
        visit_log_id: 'visit-1',
        incident_id: null,
      },
      pass: null,
    });

    const res = await supertest(buildApp())
      .post('/api/v1/visits/verify')
      .send({
        property_id: UUID_PROPERTY,
        mode: 'plate',
        plate: 'A001AA77',
        access_point_id: UUID_POINT,
        direction: 'exit',
      });

    expect(res.status).toBe(200);
    expect(res.body.direction).toBe('exit');
    expect(verifyVisit).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ direction: 'exit' }),
    }));
  });

  test('verify accepts PIN mode and forwards pin without treating it as QR token', async () => {
    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM access_points')) {
        return Promise.resolve({ rows: [{ id: UUID_POINT, zone_id: UUID_ZONE }] });
      }
      throw new Error(`unexpected SQL: ${sql}`);
    });
    verifyVisit.mockResolvedValue({
      result: {
        verdict: { allowed: true, reason: null },
        visit_log_id: 'visit-pin',
        incident_id: null,
      },
      pass: null,
    });

    const res = await supertest(buildApp())
      .post('/api/v1/visits/verify')
      .send({
        property_id: UUID_PROPERTY,
        mode: 'pin',
        pin: '123456',
        access_point_id: UUID_POINT,
      });

    expect(res.status).toBe(200);
    expect(verifyVisit).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ mode: 'pin', pin: '123456', token: null }),
    }));
  });

  test('verify rejects PIN mode without pin value', async () => {
    const res = await supertest(buildApp())
      .post('/api/v1/visits/verify')
      .send({
        property_id: UUID_PROPERTY,
        mode: 'pin',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/pin required/);
    expect(verifyVisit).not.toHaveBeenCalled();
  });

  test('direct visit insert rejects manual decisions before generic visit log write', async () => {
    const res = await supertest(buildApp())
      .post('/api/v1/visits')
      .send({
        property_id: UUID_PROPERTY,
        event_type: 'manual_admit',
        event_source: 'guard_console',
      });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/manual_admit\/manual_deny/);
    expect(createVisitLog).not.toHaveBeenCalled();
  });
});
