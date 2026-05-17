'use strict';

const express = require('express');
const supertest = require('supertest');

jest.mock('../db', () => ({
  query: jest.fn(),
  pool: { connect: jest.fn() },
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
const accessIncidentsRouter = require('../v1/routes/accessIncidents');

const UUID_PROPERTY = '11111111-1111-4111-8111-111111111111';
const UUID_INCIDENT = '22222222-2222-4222-8222-222222222222';
const UUID_OVERRIDE = '33333333-3333-4333-8333-333333333333';
const UUID_PASS = '44444444-4444-4444-8444-444444444444';
const UUID_STAFF = '55555555-5555-4555-8555-555555555555';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', accessIncidentsRouter);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    res.status(500).json({ error: String(err && err.message || err) });
  });
  return app;
}

function overrideRow(overrides = {}) {
  return {
    id: UUID_OVERRIDE,
    property_id: UUID_PROPERTY,
    incident_id: UUID_INCIDENT,
    pass_id: UUID_PASS,
    performed_by_staff_id: UUID_STAFF,
    override_type: 'manual_admit',
    reason: 'manual gate decision',
    created_at: '2026-05-05T10:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = null;
  db.query.mockResolvedValue({ rows: [] });
  db.pool.connect.mockReset();
});

describe('v1 access incidents/overrides route — Phase 1.4 audit', () => {
  test('standalone override creates append-only override row and tenant-scoped audit trail', async () => {
    mockCurrentUser = { uid: 'legacy-security-1', role: 'security' };
    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: UUID_STAFF }] });
      if (sql.includes('INSERT INTO access_overrides')) return Promise.resolve({ rows: [overrideRow()] });
      if (sql.includes('INSERT INTO property_audit_log')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const res = await supertest(buildApp())
      .post('/api/v1/access-overrides')
      .send({
        property_id: UUID_PROPERTY,
        incident_id: UUID_INCIDENT,
        pass_id: UUID_PASS,
        override_type: 'manual_admit',
        reason: 'manual gate decision',
      });

    expect(res.status).toBe(201);
    expect(res.body.override.id).toBe(UUID_OVERRIDE);

    const overrideCall = db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO access_overrides'));
    expect(overrideCall[1]).toEqual([
      UUID_PROPERTY, UUID_INCIDENT, UUID_PASS, UUID_STAFF,
      'manual_admit', 'manual gate decision',
    ]);

    const auditCall = db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO property_audit_log'));
    expect(auditCall[0]).toContain('property_id');
    expect(auditCall[0]).toContain('actor_type');
    expect(auditCall[1][0]).toBe(UUID_PROPERTY);
    expect(auditCall[1][1]).toBe('legacy-security-1');
    expect(auditCall[1][2]).toBe('security');
    expect(auditCall[1][3]).toBe('access_override');
    expect(auditCall[1][4]).toBe(UUID_OVERRIDE);
    expect(auditCall[1][5]).toBe('override.created');
    expect(auditCall[1][6]).toBe('access_override');
    expect(auditCall[1][7]).toBe(UUID_OVERRIDE);
  });

  test('audit write failure is logged but does not break override creation', async () => {
    mockCurrentUser = { uid: 'legacy-security-1', role: 'security' };
    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: UUID_STAFF }] });
      if (sql.includes('INSERT INTO access_overrides')) return Promise.resolve({ rows: [overrideRow()] });
      if (sql.includes('INSERT INTO property_audit_log')) return Promise.reject(new Error('audit down'));
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const res = await supertest(buildApp())
      .post('/api/v1/access-overrides')
      .send({
        property_id: UUID_PROPERTY,
        incident_id: UUID_INCIDENT,
        override_type: 'manual_admit',
        reason: 'manual gate decision',
      });

    expect(res.status).toBe(201);
    expect(res.body.override.id).toBe(UUID_OVERRIDE);
  });

  test('route source keeps overrides append-only: no update or delete endpoints', () => {
    const stack = accessIncidentsRouter.stack
      .filter((layer) => layer.route)
      .map((layer) => ({
        path: layer.route.path,
        methods: Object.keys(layer.route.methods),
      }));

    const overrideMutations = stack.filter((route) => String(route.path).startsWith('/access-overrides'));
    expect(overrideMutations).toEqual(expect.arrayContaining([
      { path: '/access-overrides', methods: ['get'] },
      { path: '/access-overrides/:id', methods: ['get'] },
      { path: '/access-overrides', methods: ['post'] },
    ]));
    expect(overrideMutations.some((route) => route.methods.includes('patch'))).toBe(false);
    expect(overrideMutations.some((route) => route.methods.includes('put'))).toBe(false);
    expect(overrideMutations.some((route) => route.methods.includes('delete'))).toBe(false);
  });

  test('manual incident creation accepts verify-flow incident types exposed to clients', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'admin', property_id: UUID_PROPERTY };
    db.query.mockImplementation((sql) => {
      const s = String(sql);
      if (s.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: UUID_STAFF }] });
      if (s.includes('INSERT INTO access_incidents')) {
        return Promise.resolve({
          rows: [{
            id: UUID_INCIDENT,
            property_id: UUID_PROPERTY,
            incident_type: 'invalid_plate',
            severity: 'low',
            status: 'open',
            title: 'Invalid plate',
            description: null,
            created_by_staff_id: UUID_STAFF,
            assigned_to_staff_id: null,
            resolved_at: null,
            created_at: '2026-05-05T10:00:00.000Z',
          }],
        });
      }
      if (s.includes('INSERT INTO property_audit_log')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const res = await supertest(buildApp())
      .post('/api/v1/access-incidents')
      .send({
        property_id: UUID_PROPERTY,
        incident_type: 'invalid_plate',
        severity: 'low',
        title: 'Invalid plate',
      });

    expect(res.status).toBe(201);
    expect(res.body.incident.incident_type).toBe('invalid_plate');
  });

  test('admin can reopen resolved incident with reason and scoped audit', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'admin', property_id: UUID_PROPERTY };
    db.query.mockImplementation((sql) => {
      const s = String(sql);
      if (s.includes('SELECT property_id FROM access_incidents')) {
        return Promise.resolve({ rows: [{ property_id: UUID_PROPERTY }] });
      }
      if (s.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: UUID_STAFF }] });
      if (s.includes('FROM access_incidents') && s.includes('status')) {
        return Promise.resolve({ rows: [{ property_id: UUID_PROPERTY, status: 'resolved' }] });
      }
      if (s.includes('UPDATE access_incidents')) {
        return Promise.resolve({
          rows: [{
            id: UUID_INCIDENT,
            property_id: UUID_PROPERTY,
            status: 'investigating',
            assigned_to_staff_id: UUID_STAFF,
          }],
        });
      }
      if (s.includes('INSERT INTO property_audit_log')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const res = await supertest(buildApp())
      .post(`/api/v1/access-incidents/${UUID_INCIDENT}/reopen`)
      .send({ reason: 'wrongly closed' });

    expect(res.status).toBe(200);
    expect(res.body.incident.status).toBe('investigating');
    const auditCall = db.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO property_audit_log'));
    expect(auditCall[1][0]).toBe(UUID_PROPERTY);
    expect(auditCall[1][5]).toBe('incident.reopened');
  });

  test('non-admin cannot reopen resolved incident', async () => {
    mockCurrentUser = { uid: 'security-1', role: 'security', property_id: UUID_PROPERTY };
    db.query.mockImplementation((sql) => {
      if (String(sql).includes('SELECT property_id FROM access_incidents')) {
        return Promise.resolve({ rows: [{ property_id: UUID_PROPERTY }] });
      }
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const res = await supertest(buildApp())
      .post(`/api/v1/access-incidents/${UUID_INCIDENT}/reopen`)
      .send({ reason: 'wrongly closed' });

    expect(res.status).toBe(403);
  });
});
