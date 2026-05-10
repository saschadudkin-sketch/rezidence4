'use strict';

const express = require('express');
const supertest = require('supertest');

jest.mock('../db', () => ({
  query: jest.fn(),
}));
jest.mock('../logger', () => require('../__mocks__/logger'));
jest.mock('../middleware/idempotency', () => (_req, _res, next) => next());

let mockCurrentUser = null;
jest.mock('../middleware/auth', () => (req, res, next) => {
  if (!mockCurrentUser) return res.status(401).json({ error: 'auth not set' });
  req.user = mockCurrentUser;
  next();
});

const db = require('../db');
const vehiclesRouter = require('../v1/routes/vehicles');

const UUID_PROPERTY_A = '11111111-1111-4111-8111-111111111111';
const UUID_PROPERTY_B = '22222222-2222-4222-8222-222222222222';
const UUID_VEHICLE = '33333333-3333-4333-8333-333333333333';
const UUID_RESIDENT = '44444444-4444-4444-8444-444444444444';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/vehicles', vehiclesRouter);
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

describe('v1 vehicles route resource-scope checks', () => {
  test('scoped admin cannot whitelist vehicle from another property', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'admin', property_id: UUID_PROPERTY_A };
    db.query.mockResolvedValueOnce({ rows: [{ property_id: UUID_PROPERTY_B }] });

    const res = await supertest(buildApp())
      .post(`/api/v1/vehicles/${UUID_VEHICLE}/whitelist`)
      .send({ reason: 'known resident' });

    expect(res.status).toBe(403);
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  test('security can blacklist only within its property scope', async () => {
    mockCurrentUser = { uid: 'security-1', role: 'security', property_id: UUID_PROPERTY_A };
    db.query
      .mockResolvedValueOnce({ rows: [{ property_id: UUID_PROPERTY_A }] })
      .mockResolvedValueOnce({ rows: [{
        id: UUID_VEHICLE,
        property_id: UUID_PROPERTY_A,
        is_whitelisted: false,
        is_blacklisted: true,
      }] });

    const res = await supertest(buildApp())
      .post(`/api/v1/vehicles/${UUID_VEHICLE}/blacklist`)
      .send({ reason: 'manual guard decision' });

    expect(res.status).toBe(200);
    expect(res.body.vehicle.is_blacklisted).toBe(true);
    const updateCall = db.query.mock.calls.find(([sql]) => String(sql).includes('UPDATE vehicles'));
    expect(updateCall).toBeDefined();
  });

  test('resident can list only their own vehicles for vehicle-access requests', async () => {
    mockCurrentUser = { uid: 'resident-1', role: 'owner', property_id: UUID_PROPERTY_A };
    db.query.mockImplementation((sql) => {
      if (String(sql).includes('FROM residents')) {
        return Promise.resolve({ rows: [{ id: UUID_RESIDENT }] });
      }
      if (String(sql).includes('FROM vehicles')) {
        return Promise.resolve({
          rows: [{
            id: UUID_VEHICLE,
            property_id: UUID_PROPERTY_A,
            owner_type: 'resident',
            owner_resident_id: UUID_RESIDENT,
            plate_number: 'A001AA77',
          }],
        });
      }
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const res = await supertest(buildApp())
      .get(`/api/v1/vehicles?property_id=${UUID_PROPERTY_A}&owner_resident_id=${UUID_RESIDENT}`);

    expect(res.status).toBe(200);
    expect(res.body.vehicles).toHaveLength(1);
    const vehicleCall = db.query.mock.calls.find(([sql]) => String(sql).includes('FROM vehicles'));
    expect(vehicleCall[0]).toContain('owner_resident_id');
    expect(vehicleCall[1]).toEqual([UUID_PROPERTY_A, UUID_RESIDENT, 50, 0]);
  });
});
