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
const passesRouter = require('../v1/routes/passes');

const UUID_PROPERTY = '11111111-1111-4111-8111-111111111111';
const UUID_RESIDENT = '22222222-2222-4222-8222-222222222222';
const UUID_PASS = '33333333-3333-4333-8333-333333333333';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/passes', passesRouter);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    res.status(500).json({ error: String(err && err.message || err) });
  });
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = { uid: 'admin-1', role: 'admin', property_id: UUID_PROPERTY };
  db.query.mockResolvedValue({ rows: [] });
});

describe('v1 passes route', () => {
  test('GET /api/v1/passes returns enriched property-scoped admin read model', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{
        id: UUID_PASS,
        property_id: UUID_PROPERTY,
        access_request_id: null,
        pass_type: 'guest',
        subject_type: 'guest',
        subject_resident_id: null,
        subject_staff_id: null,
        subject_contractor_user_id: null,
        subject_vehicle_id: null,
        zone_id: null,
        point_id: null,
        policy_id: null,
        valid_from: '2026-05-10T10:00:00.000Z',
        valid_until: '2026-05-10T12:00:00.000Z',
        status: 'active',
        approved_by_staff_id: null,
        revoked_at: null,
        revoked_by_staff_id: null,
        revoked_reason: null,
        created_at: '2026-05-01T10:00:00.000Z',
        visitor_name: 'Guest One',
        resident_name: 'Resident One',
        unit_number: '125',
        vehicle_plate: 'A001AA77',
        access_point_name: 'КПП 1',
        access_zone_name: 'Периметр',
        credential_types: ['pin', 'qr'],
        guard_notes: 'Проверить паспорт',
        guest_instructions: 'Показать QR',
      }],
    });

    const res = await supertest(buildApp())
      .get(`/api/v1/passes?property_id=${UUID_PROPERTY}&status=active&subject_resident_id=${UUID_RESIDENT}&q=Guest&limit=25`);

    expect(res.status).toBe(200);
    expect(res.body.passes[0]).toMatchObject({
      id: UUID_PASS,
      visitor_name: 'Guest One',
      resident_name: 'Resident One',
      unit_number: '125',
      vehicle_plate: 'A001AA77',
      credential_types: ['pin', 'qr'],
      guard_notes: 'Проверить паспорт',
    });
    expect(res.body.page).toEqual({ limit: 25, offset: 0, hasMore: false });

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('FROM passes p');
    expect(sql).toContain('LEFT JOIN access_requests ar');
    expect(sql).toContain('LEFT JOIN units u');
    expect(sql).toContain('LEFT JOIN residents r');
    expect(sql).toContain('FROM pass_credentials pc');
    expect(sql).toContain('pc.property_id = p.property_id');
    expect(sql).toContain('p.subject_resident_id');
    expect(sql).toContain('ILIKE');
    expect(params).toEqual([UUID_PROPERTY, 'active', UUID_RESIDENT, '%Guest%', 25, 0]);
  });

  test('GET /api/v1/passes rejects invalid status before querying', async () => {
    const res = await supertest(buildApp())
      .get(`/api/v1/passes?property_id=${UUID_PROPERTY}&status=pending`);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid status');
    expect(db.query).not.toHaveBeenCalled();
  });

  test.each([
    ['pass_type', 'invalid', 'Invalid pass_type'],
    ['subject_vehicle_id', 'not-a-uuid', 'Invalid subject_vehicle_id'],
    ['subject_resident_id', 'not-a-uuid', 'Invalid subject_resident_id'],
    ['access_request_id', 'not-a-uuid', 'Invalid access_request_id'],
  ])('GET /api/v1/passes rejects invalid %s before querying', async (param, value, error) => {
    const res = await supertest(buildApp())
      .get(`/api/v1/passes?property_id=${UUID_PROPERTY}&${param}=${value}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(error);
    expect(db.query).not.toHaveBeenCalled();
  });
});
