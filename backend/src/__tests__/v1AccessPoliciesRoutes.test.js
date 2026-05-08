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
const accessPoliciesRouter = require('../v1/routes/accessPolicies');

const UUID_PROPERTY = '11111111-1111-4111-8111-111111111111';
const UUID_OTHER_PROPERTY = '22222222-2222-4222-8222-222222222222';
const UUID_POLICY = '33333333-3333-4333-8333-333333333333';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', accessPoliciesRouter);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    res.status(500).json({ error: String(err && err.message || err) });
  });
  return app;
}

function makePolicy(overrides = {}) {
  return {
    id: UUID_POLICY,
    property_id: UUID_PROPERTY,
    name: 'Guest QR',
    subject_type: 'guest',
    subject_role: null,
    zone_id: null,
    point_id: null,
    access_method: 'qr',
    approval_mode: 'auto',
    effect: 'allow',
    priority: 100,
    schedule_json: null,
    duration_minutes: null,
    is_recurring: false,
    is_active: true,
    created_by: null,
    metadata: {},
    created_at: '2026-05-05T08:00:00.000Z',
    updated_at: '2026-05-05T08:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = null;
  db.query.mockResolvedValue({ rows: [] });
});

describe('access policy routes', () => {
  test('GET /api/v1/access-policy-templates returns DH-13 default catalog', async () => {
    mockCurrentUser = { uid: 'security-1', role: 'security', property_id: UUID_PROPERTY };

    const res = await supertest(buildApp())
      .get(`/api/v1/access-policy-templates?property_id=${UUID_PROPERTY}`);

    expect(res.status).toBe(200);
    expect(res.body.templates.map((template) => template.key)).toContain('resident_vehicle');
    expect(res.body.templates.map((template) => template.key)).toContain('emergency_access');
  });

  test('POST /api/v1/access-policies creates a property-scoped policy', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'admin', property_id: UUID_PROPERTY };
    db.query.mockResolvedValueOnce({ rows: [makePolicy()] });

    const res = await supertest(buildApp())
      .post('/api/v1/access-policies')
      .send({
        property_id: UUID_PROPERTY,
        name: 'Guest QR',
        subject_type: 'guest',
        access_method: 'qr',
        approval_mode: 'auto',
        effect: 'allow',
        metadata: { source: 'test' },
      });

    expect(res.status).toBe(201);
    expect(res.body.policy.name).toBe('Guest QR');
    const insert = db.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO access_policies'));
    expect(insert).toBeDefined();
    expect(insert[1][0]).toBe(UUID_PROPERTY);
    expect(insert[1][15]).toBe(JSON.stringify({ source: 'test' }));
  });

  test('POST /api/v1/access-policies rejects cross-property admin tokens', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'admin', property_id: UUID_OTHER_PROPERTY };

    const res = await supertest(buildApp())
      .post('/api/v1/access-policies')
      .send({
        property_id: UUID_PROPERTY,
        name: 'Guest QR',
        subject_type: 'guest',
        access_method: 'qr',
      });

    expect(res.status).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('GET /api/v1/access-policies lists staff-readable property policies', async () => {
    mockCurrentUser = { uid: 'security-1', role: 'security', property_id: UUID_PROPERTY };
    db.query.mockResolvedValueOnce({ rows: [makePolicy()] });

    const res = await supertest(buildApp())
      .get(`/api/v1/access-policies?property_id=${UUID_PROPERTY}&is_active=true`);

    expect(res.status).toBe(200);
    expect(res.body.policies).toHaveLength(1);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('FROM access_policies');
    expect(params[0]).toBe(UUID_PROPERTY);
  });

  test('POST /api/v1/access-policies/evaluate returns deterministic decision trace', async () => {
    mockCurrentUser = { uid: 'security-1', role: 'security', property_id: UUID_PROPERTY };
    db.query.mockResolvedValueOnce({
      rows: [makePolicy({ effect: 'deny', priority: 10 })],
    });

    const res = await supertest(buildApp())
      .post('/api/v1/access-policies/evaluate')
      .send({
        property_id: UUID_PROPERTY,
        subject_type: 'guest',
        access_method: 'qr',
        occurred_at: '2026-05-05T09:00:00.000Z',
      });

    expect(res.status).toBe(200);
    expect(res.body.decision.allowed).toBe(false);
    expect(res.body.decision.reason).toBe('policy_denied');
    expect(res.body.decision.trace[0]).toMatchObject({ result: 'matched' });
  });

  test('PATCH /api/v1/access-policies/:id uses row ownership before update', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'admin', property_id: UUID_PROPERTY };
    db.query
      .mockResolvedValueOnce({ rows: [makePolicy()] })
      .mockResolvedValueOnce({ rows: [makePolicy({ name: 'Guest QR Updated' })] });

    const res = await supertest(buildApp())
      .patch(`/api/v1/access-policies/${UUID_POLICY}`)
      .send({ name: 'Guest QR Updated' });

    expect(res.status).toBe(200);
    expect(db.query.mock.calls[0][0]).toContain('FROM access_policies WHERE id = $1');
    expect(db.query.mock.calls[1][0]).toContain('UPDATE access_policies');
    expect(res.body.policy.name).toBe('Guest QR Updated');
  });
});
