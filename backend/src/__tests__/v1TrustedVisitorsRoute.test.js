'use strict';

const express = require('express');
const supertest = require('supertest');

jest.mock('../db', () => ({
  query: jest.fn(),
  pool: { connect: jest.fn() },
}));
jest.mock('../logger', () => require('../__mocks__/logger'));

let mockCurrentUser = null;
jest.mock('../middleware/auth', () => (req, res, next) => {
  if (!mockCurrentUser) return res.status(401).json({ error: 'auth not set' });
  req.user = mockCurrentUser;
  next();
});

const db = require('../db');
const trustedVisitorsRouter = require('../v1/routes/trustedVisitors');

const UUID_PROPERTY = '11111111-1111-4111-8111-111111111111';
const UUID_RESIDENT = '33333333-3333-4333-8333-333333333333';
const UUID_VISITOR = '44444444-4444-4444-8444-444444444444';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/trusted-visitors', trustedVisitorsRouter);
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

describe('v1 trustedVisitors route auth and ownership', () => {
  test('requires authentication', async () => {
    const res = await supertest(buildApp())
      .get('/api/v1/trusted-visitors')
      .query({ property_id: UUID_PROPERTY });

    expect(res.status).toBe(401);
  });

  test('lists only current resident owned trusted visitors', async () => {
    mockCurrentUser = { uid: 'legacy-resident-1', role: 'owner' };
    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM residents') && sql.includes('external_uid')) {
        return Promise.resolve({ rows: [{ id: UUID_RESIDENT }] });
      }
      if (sql.includes('FROM trusted_visitors')) {
        return Promise.resolve({
          rows: [{
            id: UUID_VISITOR,
            property_id: UUID_PROPERTY,
            resident_id: UUID_RESIDENT,
            name: 'Mom',
            phone: null,
            visitor_type: 'relative',
            default_vehicle_plate: null,
            default_instructions: null,
            allowed_zone_id: null,
            allowed_point_id: null,
            is_active: true,
            last_used_at: null,
            created_at: '2026-05-05T08:00:00.000Z',
            updated_at: '2026-05-05T08:00:00.000Z',
          }],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await supertest(buildApp())
      .get('/api/v1/trusted-visitors')
      .query({ property_id: UUID_PROPERTY });

    expect(res.status).toBe(200);
    expect(res.body.trusted_visitors).toHaveLength(1);
    const listCall = db.query.mock.calls.find(([sql]) => sql.includes('FROM trusted_visitors'));
    expect(listCall[1]).toEqual([UUID_PROPERTY, UUID_RESIDENT]);
  });

  test('staff user without resident mapping cannot create resident trusted visitor', async () => {
    mockCurrentUser = { uid: 'legacy-security-1', role: 'security' };
    db.query.mockResolvedValue({ rows: [] });

    const res = await supertest(buildApp())
      .post('/api/v1/trusted-visitors')
      .send({
        property_id: UUID_PROPERTY,
        name: 'Guest',
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Resident identity is not mapped to v1');
  });
});
