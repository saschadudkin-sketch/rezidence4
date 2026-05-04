'use strict';

/**
 * Phase 2 (D-lite) — v1 routes smoke tests.
 *
 * Scope:
 *   - RBAC shape: property_admin mutations / staff reads / resident-self
 *   - Validation for UUIDs, enums, phone, email
 *   - Business rules specific to Phase 2 (unit deactivate with active
 *     residents → 409, contractor_user in non-active company → 409)
 *   - Phone-visibility capability gate on residents
 *   - ROLE_CAPABILITY_DEFAULTS export shape
 *
 * We mock `../../db` and the auth middleware so tests do not depend on a
 * real database or JWT.  The auth middleware is stubbed per-test to set
 * req.user for the role under test.
 */

const { describe, test, expect, beforeEach } = require('@jest/globals');
const express = require('express');
const supertest = require('supertest');

jest.mock('../db', () => ({
  query: jest.fn(),
}));
jest.mock('../logger', () => require('../__mocks__/logger'));

// A mutable auth-user so each test can override req.user before its
// supertest() call.  Jest requires the module-scope variable read inside a
// jest.mock() factory to have a `mock*` prefix (hoisting guard).
// NB: we do NOT touch req.ip — in Express 5 it is a read-only getter.
let mockCurrentUser = null;
jest.mock('../middleware/auth', () => (req, _res, next) => {
  // eslint-disable-next-line no-undef
  if (!mockCurrentUser) return _res.status(401).json({ error: 'auth not set' });
  req.user = mockCurrentUser;
  next();
});

const db = require('../db');
const structureRouter   = require('../v1/routes/structure');
const residentsRouter   = require('../v1/routes/residents');
const staffRouter       = require('../v1/routes/staff');
const contractorsRouter = require('../v1/routes/contractors');

// Pull the exported defaults map to assert it didn't drift from spec.
const { ROLE_CAPABILITY_DEFAULTS } = require('../v1/routes/staff');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', structureRouter);
  app.use('/api/v1/residents', residentsRouter);
  app.use('/api/v1/staff', staffRouter);
  app.use('/api/v1', contractorsRouter);
  // Make route errors surface as 500 JSON so assertion failures stay
  // readable.  Without this the default Express HTML page masks the body.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    res.status(500).json({ error: String(err && err.message || err) });
  });
  return app;
}

// Convenience: valid v4-style UUID.
const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const UUID_C = '33333333-3333-4333-8333-333333333333';
const UUID_D = '44444444-4444-4444-8444-444444444444';

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = null;
  // Default: every INSERT/SELECT/UPDATE returns empty rows unless a test
  // mocks it explicitly.  The audit-log insert happens fire-and-forget and
  // falls through this default.
  db.query.mockResolvedValue({ rows: [] });
});

// ─── ROLE_CAPABILITY_DEFAULTS spec ──────────────────────────────────────────

describe('staff.js — ROLE_CAPABILITY_DEFAULTS', () => {
  test('matches staff-users-spec §3 defaults exactly', () => {
    expect(ROLE_CAPABILITY_DEFAULTS).toEqual({
      security:       { can_view_resident_phone: false, can_assign_requests: false },
      concierge:      { can_view_resident_phone: true,  can_assign_requests: true },
      technician:     { can_view_resident_phone: false, can_assign_requests: false },
      property_admin: { can_view_resident_phone: true,  can_assign_requests: true },
    });
  });

  test('is frozen so spec changes require an explicit edit', () => {
    expect(Object.isFrozen(ROLE_CAPABILITY_DEFAULTS)).toBe(true);
  });
});

// ─── Structure: buildings / entrances / units ───────────────────────────────

describe('POST /api/v1/buildings', () => {
  test('403 for non-admin staff', async () => {
    mockCurrentUser = { uid: 'u1', role: 'concierge' };
    const res = await supertest(buildApp())
      .post('/api/v1/buildings')
      .send({ property_id: UUID_A, name: 'Корпус A' });
    expect(res.status).toBe(403);
  });

  test('400 on non-UUID property_id', async () => {
    mockCurrentUser = { uid: 'u1', role: 'admin' };
    const res = await supertest(buildApp())
      .post('/api/v1/buildings')
      .send({ property_id: 'not-a-uuid', name: 'Корпус A' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/property_id/);
  });

  test('400 on empty name', async () => {
    mockCurrentUser = { uid: 'u1', role: 'admin' };
    const res = await supertest(buildApp())
      .post('/api/v1/buildings')
      .send({ property_id: UUID_A, name: '   ' });
    expect(res.status).toBe(400);
  });

  test('201 on valid payload and writes audit', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'admin' };
    db.query.mockImplementationOnce(() =>
      Promise.resolve({ rows: [{ id: UUID_B, property_id: UUID_A, code: 'b1', name: 'Корпус A', sort_order: 0, created_at: new Date() }] }),
    );
    const res = await supertest(buildApp())
      .post('/api/v1/buildings')
      .send({ property_id: UUID_A, name: 'Корпус A', code: 'b1' });

    expect(res.status).toBe(201);
    expect(res.body.building.name).toBe('Корпус A');

    const auditCall = db.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO property_audit_log'),
    );
    expect(auditCall).toBeDefined();
    expect(auditCall[1][2]).toBe('building.created'); // action
    expect(auditCall[1][3]).toBe('building'); // resource_type
  });

  test('409 on duplicate code (unique violation 23505)', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'admin' };
    const err = new Error('duplicate'); err.code = '23505';
    db.query.mockRejectedValueOnce(err);

    const res = await supertest(buildApp())
      .post('/api/v1/buildings')
      .send({ property_id: UUID_A, name: 'X', code: 'dup' });
    expect(res.status).toBe(409);
  });
});

describe('POST /api/v1/units — cross-check entrance belongs to building', () => {
  test('400 when entrance does not belong to the given building', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'admin' };
    // First query: entrance-belongs-to-building check returns no row.
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await supertest(buildApp())
      .post('/api/v1/units')
      .send({
        property_id: UUID_A, building_id: UUID_B, entrance_id: UUID_C,
        unit_number: '12А',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/entrance does not belong/);
  });

  test('201 when entrance belongs to the given building', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'admin' };
    db.query
      // entrance-belongs-to-building check
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      // INSERT returning the new row
      .mockResolvedValueOnce({ rows: [{
        id: UUID_D, property_id: UUID_A, building_id: UUID_B, entrance_id: UUID_C,
        unit_number: '12А', unit_type: 'apartment', floor: 3, is_active: true, created_at: new Date(),
      }] });

    const res = await supertest(buildApp())
      .post('/api/v1/units')
      .send({
        property_id: UUID_A, building_id: UUID_B, entrance_id: UUID_C,
        unit_number: '12А', floor: 3,
      });
    expect(res.status).toBe(201);
    expect(res.body.unit.unit_number).toBe('12А');
  });

  test('400 on invalid unit_type', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'admin' };
    const res = await supertest(buildApp())
      .post('/api/v1/units')
      .send({
        property_id: UUID_A, building_id: UUID_B, entrance_id: UUID_C,
        unit_number: '1', unit_type: 'castle',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unit_type/);
  });
});

describe('POST /api/v1/units/:id/deactivate', () => {
  test('409 when active residents remain on the unit', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'admin' };
    db.query.mockResolvedValueOnce({ rows: [{ c: 2 }] }); // residents count

    const res = await supertest(buildApp())
      .post(`/api/v1/units/${UUID_D}/deactivate`);
    expect(res.status).toBe(409);
    expect(res.body.residents).toBe(2);
  });

  test('204 when no active residents', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'admin' };
    db.query
      .mockResolvedValueOnce({ rows: [{ c: 0 }] })   // count
      .mockResolvedValueOnce({ rows: [{ id: UUID_D }] }); // update

    const res = await supertest(buildApp())
      .post(`/api/v1/units/${UUID_D}/deactivate`);
    expect(res.status).toBe(204);
  });
});

// ─── Residents ───────────────────────────────────────────────────────────────

describe('GET /api/v1/residents — phone-visibility gate', () => {
  const residentRow = {
    id: UUID_A, external_uid: null, property_id: UUID_B, unit_id: UUID_C,
    full_name: 'Иванов И.И.', phone: '+79991234567', email: null,
    role: 'resident', resident_type: 'owner', is_active: true,
    consent_given_at: null, consent_version: null,
    created_at: new Date(), updated_at: new Date(),
  };

  test('concierge sees phones', async () => {
    mockCurrentUser = { uid: 'c1', role: 'concierge' };
    db.query.mockResolvedValueOnce({ rows: [residentRow] });

    const res = await supertest(buildApp()).get('/api/v1/residents');
    expect(res.status).toBe(200);
    expect(res.body.residents[0].phone).toBe('+79991234567');
  });

  test('security does NOT see phones (null)', async () => {
    mockCurrentUser = { uid: 's1', role: 'security' };
    db.query.mockResolvedValueOnce({ rows: [residentRow] });

    const res = await supertest(buildApp()).get('/api/v1/residents');
    expect(res.status).toBe(200);
    expect(res.body.residents[0].phone).toBeNull();
  });

  test('admin sees phones', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin' };
    db.query.mockResolvedValueOnce({ rows: [residentRow] });

    const res = await supertest(buildApp()).get('/api/v1/residents');
    expect(res.status).toBe(200);
    expect(res.body.residents[0].phone).toBe('+79991234567');
  });

  test('resident role is not staff → 403', async () => {
    mockCurrentUser = { uid: 'r1', role: 'owner' };
    const res = await supertest(buildApp()).get('/api/v1/residents');
    expect(res.status).toBe(403);
  });

  test('resident can fetch own row by external_uid', async () => {
    mockCurrentUser = { uid: 'e2e-v1-resident', role: 'owner' };
    db.query.mockResolvedValueOnce({
      rows: [{ ...residentRow, external_uid: 'e2e-v1-resident' }],
    });

    const res = await supertest(buildApp()).get('/api/v1/residents/e2e-v1-resident');
    expect(res.status).toBe(200);
    expect(res.body.resident.external_uid).toBe('e2e-v1-resident');
    expect(res.body.resident.phone).toBe('+79991234567');
    expect(db.query.mock.calls[0][0]).toContain('WHERE external_uid = $1');
  });
});

describe('POST /api/v1/residents', () => {
  test('400 on bad phone', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin' };
    const res = await supertest(buildApp())
      .post('/api/v1/residents')
      .send({ property_id: UUID_A, unit_id: UUID_B, full_name: 'X', phone: 'abc' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/phone/);
  });

  test('400 when unit does not exist (pre-check)', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin' };
    db.query.mockResolvedValueOnce({ rows: [] }); // unit lookup

    const res = await supertest(buildApp())
      .post('/api/v1/residents')
      .send({
        property_id: UUID_A, unit_id: UUID_B, full_name: 'X',
        phone: '+79991234567',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unit_id does not exist/);
  });

  test('400 when unit is inactive', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin' };
    db.query.mockResolvedValueOnce({ rows: [{ is_active: false }] });

    const res = await supertest(buildApp())
      .post('/api/v1/residents')
      .send({
        property_id: UUID_A, unit_id: UUID_B, full_name: 'X',
        phone: '+79991234567',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/inactive unit/);
  });
});

describe('POST /api/v1/residents/:id/consent', () => {
  test('only the resident themselves may give consent', async () => {
    mockCurrentUser = { uid: 'r1', role: 'admin' };
    const res = await supertest(buildApp())
      .post(`/api/v1/residents/${UUID_A}/consent`)
      .send({ consent_version: '1.0' });
    expect(res.status).toBe(403);
  });

  test('self-consent updates row and writes audit', async () => {
    mockCurrentUser = { uid: UUID_A, role: 'owner' };
    db.query.mockResolvedValueOnce({
      rows: [{ id: UUID_A, consent_given_at: new Date(), consent_version: '1.0' }],
    });

    const res = await supertest(buildApp())
      .post(`/api/v1/residents/${UUID_A}/consent`)
      .send({ consent_version: '1.0' });

    expect(res.status).toBe(200);
    expect(res.body.resident.consent_version).toBe('1.0');
  });
});

// ─── Staff ───────────────────────────────────────────────────────────────────

describe('POST /api/v1/staff — capability defaults and override', () => {
  test('applies role defaults when caller omits capability flags', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin' };
    db.query.mockResolvedValueOnce({
      rows: [{ id: UUID_A, role: 'security', can_view_resident_phone: false, can_assign_requests: false }],
    });

    const res = await supertest(buildApp())
      .post('/api/v1/staff')
      .send({
        property_id: UUID_A, full_name: 'Guard', email: 'g@uk.ru', role: 'security',
      });
    expect(res.status).toBe(201);

    const insertCall = db.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO staff_users'),
    );
    expect(insertCall).toBeDefined();
    // positions 7 & 8 in the params array are the two capability flags.
    const params = insertCall[1];
    expect(params[6]).toBe(false); // can_view_resident_phone (security default)
    expect(params[7]).toBe(false); // can_assign_requests     (security default)
  });

  test('honours caller override even when it flips a default', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin' };
    db.query.mockResolvedValueOnce({
      rows: [{ id: UUID_A, role: 'security', can_view_resident_phone: true, can_assign_requests: false }],
    });

    const res = await supertest(buildApp())
      .post('/api/v1/staff')
      .send({
        property_id: UUID_A, full_name: 'Guard', email: 'g@uk.ru', role: 'security',
        can_view_resident_phone: true,
      });
    expect(res.status).toBe(201);

    const insertCall = db.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO staff_users'),
    );
    expect(insertCall[1][6]).toBe(true); // override stuck
  });

  test('400 on invalid role', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin' };
    const res = await supertest(buildApp())
      .post('/api/v1/staff')
      .send({
        property_id: UUID_A, full_name: 'X', email: 'x@uk.ru', role: 'sysadmin',
      });
    expect(res.status).toBe(400);
  });

  test('400 on bad email', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin' };
    const res = await supertest(buildApp())
      .post('/api/v1/staff')
      .send({
        property_id: UUID_A, full_name: 'X', email: 'not-email', role: 'security',
      });
    expect(res.status).toBe(400);
  });

  test('409 on duplicate email per property (23505)', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin' };
    const err = new Error('dup'); err.code = '23505';
    db.query.mockRejectedValueOnce(err);

    const res = await supertest(buildApp())
      .post('/api/v1/staff')
      .send({
        property_id: UUID_A, full_name: 'X', email: 'x@uk.ru', role: 'security',
      });
    expect(res.status).toBe(409);
  });
});

describe('PATCH /api/v1/staff/:id — audit before/after', () => {
  test('captures old → new snapshot for role change', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin' };
    db.query
      // read current row
      .mockResolvedValueOnce({
        rows: [{
          id: UUID_A, full_name: 'Guard', phone: null, role: 'security',
          specialization: null,
          can_view_resident_phone: false, can_assign_requests: false,
        }],
      })
      // update returning
      .mockResolvedValueOnce({
        rows: [{ id: UUID_A, role: 'concierge' }],
      });

    const res = await supertest(buildApp())
      .patch(`/api/v1/staff/${UUID_A}`)
      .send({ role: 'concierge' });
    expect(res.status).toBe(200);

    const auditCall = db.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO property_audit_log'),
    );
    expect(auditCall).toBeDefined();
    const changes = JSON.parse(auditCall[1][4]);
    expect(changes.role).toEqual({ from: 'security', to: 'concierge' });
  });
});

// ─── Contractors ─────────────────────────────────────────────────────────────

describe('POST /api/v1/contractor-users — company-status gate', () => {
  test('409 when company status is suspended', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin' };
    db.query.mockResolvedValueOnce({ rows: [{ status: 'suspended' }] });

    const res = await supertest(buildApp())
      .post('/api/v1/contractor-users')
      .send({
        contractor_company_id: UUID_A, property_id: UUID_B, full_name: 'X',
      });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/suspended/);
  });

  test('400 when company does not exist', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin' };
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await supertest(buildApp())
      .post('/api/v1/contractor-users')
      .send({
        contractor_company_id: UUID_A, property_id: UUID_B, full_name: 'X',
      });
    expect(res.status).toBe(400);
  });

  test('400 when access_expires_at is in the past', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin' };
    const res = await supertest(buildApp())
      .post('/api/v1/contractor-users')
      .send({
        contractor_company_id: UUID_A, property_id: UUID_B, full_name: 'X',
        access_expires_at: '2000-01-01T00:00:00.000Z',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/future/);
  });

  test('201 when company is active and payload is valid', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin' };
    db.query
      .mockResolvedValueOnce({ rows: [{ status: 'active' }] })
      .mockResolvedValueOnce({ rows: [{ id: UUID_C, full_name: 'Worker', is_active: true }] });

    const res = await supertest(buildApp())
      .post('/api/v1/contractor-users')
      .send({
        contractor_company_id: UUID_A, property_id: UUID_B, full_name: 'Worker',
      });
    expect(res.status).toBe(201);
  });
});

describe('POST /api/v1/contractor-companies', () => {
  test('400 on bad contact_email', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin' };
    const res = await supertest(buildApp())
      .post('/api/v1/contractor-companies')
      .send({ property_id: UUID_A, name: 'Cleaning Co', contact_email: 'bogus' });
    expect(res.status).toBe(400);
  });

  test('409 on duplicate name within property (23505)', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin' };
    const err = new Error('dup'); err.code = '23505';
    db.query.mockRejectedValueOnce(err);

    const res = await supertest(buildApp())
      .post('/api/v1/contractor-companies')
      .send({ property_id: UUID_A, name: 'Cleaning Co' });
    expect(res.status).toBe(409);
  });

  test('201 with active_users_count subquery visible in list SQL', async () => {
    mockCurrentUser = { uid: 'concierge-1', role: 'concierge' };
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await supertest(buildApp()).get('/api/v1/contractor-companies');
    expect(res.status).toBe(200);
    const sql = db.query.mock.calls[0][0];
    expect(sql).toContain('active_users_count');
  });
});
