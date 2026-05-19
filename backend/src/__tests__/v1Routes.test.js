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
  req.user = { property_id: '11111111-1111-4111-8111-111111111111', ...mockCurrentUser };
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
const UUID_E = '55555555-5555-4555-8555-555555555555';
const UUID_F = '66666666-6666-4666-8666-666666666666';
const UUID_G = '77777777-7777-4777-8777-777777777777';
const UUID_H = '88888888-8888-4888-8888-888888888888';

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

  test('403 when admin token belongs to another property', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'admin', property_id: UUID_B };

    const res = await supertest(buildApp())
      .post('/api/v1/buildings')
      .send({ property_id: UUID_A, name: 'Корпус A' });

    expect(res.status).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
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

describe('GET /api/v1/units/import/template', () => {
  test('returns cottage-community CSV template with checkpoint columns', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'admin' };

    const res = await supertest(buildApp())
      .get('/api/v1/units/import/template?property_type=cottage_community');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text).toContain('sector_or_street,house_or_plot_number,unit_type');
    expect(res.text).toContain('vehicle_plates,checkpoint_name,checkpoint_type');
  });
});

describe('POST /api/v1/units/import', () => {
  test('imports cottage house, resident, vehicle, and planned checkpoint data', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'admin' };
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: UUID_B }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: UUID_C }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: UUID_D }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: UUID_E }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: UUID_F }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: UUID_G, name: 'КПП 1', zone_type: 'checkpoint' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: UUID_H, zone_id: UUID_G, name: 'КПП 1', point_type: 'checkpoint' }] });

    const res = await supertest(buildApp())
      .post('/api/v1/units/import')
      .send({
        property_id: UUID_A,
        property_type: 'cottage_community',
        rows: [{
          sector_or_street: 'Северная',
          house_or_plot_number: '14',
          unit_type: 'house',
          owner_full_name: 'Иванов Иван',
          phone: '+79991234567',
          resident_type: 'owner',
          vehicle_plates: 'А001АА77',
          checkpoint_name: 'КПП 1',
          checkpoint_type: 'checkpoint',
        }],
      });

    expect(res.status).toBe(201);
    expect(res.body.imported).toMatchObject({
      buildings: 1,
      entrances: 1,
      units: 1,
      residents: 1,
      vehicles: 1,
    });
    expect(res.body.planned_access_points).toEqual([
      { name: 'КПП 1', point_type: 'checkpoint', notes: null },
    ]);
    expect(res.body.access_topology).toEqual({
      zones: [{ id: UUID_G, name: 'КПП 1', zone_type: 'checkpoint', created: true }],
      points: [{
        id: UUID_H,
        zone_id: UUID_G,
        name: 'КПП 1',
        point_type: 'checkpoint',
        notes: null,
        created: true,
      }],
    });
    expect(res.body.readiness.ready).toBe(true);

    const unitInsert = db.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO units'));
    expect(unitInsert[1]).toEqual([UUID_A, UUID_B, UUID_C, '14', 'house', null]);

    const vehicleInsert = db.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO vehicles'));
    expect(vehicleInsert[1]).toEqual([
      UUID_A,
      UUID_E,
      'A001AA77',
      'Imported during property onboarding',
    ]);

    const zoneInsert = db.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO access_zones'));
    expect(zoneInsert[1]).toEqual([
      UUID_A,
      'КПП 1',
      null,
      1,
      JSON.stringify({ source: 'onboarding_import', planned_point_type: 'checkpoint' }),
    ]);

    const pointInsert = db.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO access_points'));
    expect(pointInsert[1]).toEqual([
      UUID_A,
      UUID_G,
      'КПП 1',
      'checkpoint',
      null,
      1,
      JSON.stringify({ source: 'onboarding_import' }),
    ]);
  });

  test('rejects invalid cottage unit_type before writing rows', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'admin' };

    const res = await supertest(buildApp())
      .post('/api/v1/units/import')
      .send({
        property_id: UUID_A,
        property_type: 'cottage_community',
        rows: [{
          sector_or_street: 'Северная',
          house_or_plot_number: '14',
          unit_type: 'apartment',
          owner_full_name: 'Иванов Иван',
          phone: '+79991234567',
        }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cottage unit_type/);
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/units/:id/deactivate', () => {
  test('409 when active residents remain on the unit', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'admin' };
    db.query
      .mockResolvedValueOnce({ rows: [{ property_id: UUID_A }] }) // row ownership lookup
      .mockResolvedValueOnce({ rows: [{ c: 2 }] }); // residents count

    const res = await supertest(buildApp())
      .post(`/api/v1/units/${UUID_D}/deactivate`);
    expect(res.status).toBe(409);
    expect(res.body.residents).toBe(2);
  });

  test('204 when no active residents', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'admin' };
    db.query
      .mockResolvedValueOnce({ rows: [{ property_id: UUID_A }] }) // row ownership lookup
      .mockResolvedValueOnce({ rows: [{ c: 0 }] })   // count
      .mockResolvedValueOnce({ rows: [{ id: UUID_D }] }); // update

    const res = await supertest(buildApp())
      .post(`/api/v1/units/${UUID_D}/deactivate`);
    expect(res.status).toBe(204);
  });

  test('403 when scoped admin deactivates unit from another property', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'admin', property_id: UUID_A };
    db.query.mockResolvedValueOnce({ rows: [{ property_id: UUID_B }] });

    const res = await supertest(buildApp())
      .post(`/api/v1/units/${UUID_D}/deactivate`);

    expect(res.status).toBe(403);
    expect(db.query).toHaveBeenCalledTimes(1);
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
    mockCurrentUser = { uid: 'a1', role: 'admin', property_id: UUID_B };
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

  test('staff UUID detail read is scoped by resident property', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin', property_id: UUID_B };
    db.query
      .mockResolvedValueOnce({ rows: [{ property_id: UUID_B }] })
      .mockResolvedValueOnce({ rows: [residentRow] });

    const res = await supertest(buildApp()).get(`/api/v1/residents/${UUID_A}`);
    expect(res.status).toBe(200);
    expect(db.query.mock.calls[0][0]).toContain('SELECT property_id FROM residents WHERE id = $1');
    expect(db.query.mock.calls[1][0]).toContain('WHERE id = $1 AND property_id = $2');
    expect(db.query.mock.calls[1][1]).toEqual([UUID_A, UUID_B]);
  });

  test('staff UUID detail rejects cross-property resident before full row read', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin', property_id: UUID_A };
    db.query.mockResolvedValueOnce({ rows: [{ property_id: UUID_B }] });

    const res = await supertest(buildApp()).get(`/api/v1/residents/${UUID_A}`);
    expect(res.status).toBe(403);
    expect(db.query).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/v1/residents', () => {
  test('400 on bad phone', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin', property_id: UUID_A };
    const res = await supertest(buildApp())
      .post('/api/v1/residents')
      .send({ property_id: UUID_A, unit_id: UUID_B, full_name: 'X', phone: 'abc' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/phone/);
  });

  test('400 when unit does not exist (pre-check)', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin', property_id: UUID_A };
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
    mockCurrentUser = { uid: 'a1', role: 'admin', property_id: UUID_A };
    db.query.mockResolvedValueOnce({ rows: [{ property_id: UUID_A, is_active: false }] });

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

describe('POST /api/v1/residents/:id/deactivate', () => {
  test('property admin can read offboarding report evidence', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin', property_id: UUID_A };
    db.query.mockImplementation((sql) => {
      if (sql.includes('COUNT(*) FILTER')) {
        return Promise.resolve({ rows: [{ offboarded_residents: 2, offboarded_last_30d: 1 }] });
      }
      if (sql.includes('FROM resident_lifecycle_events e')) {
        return Promise.resolve({
          rows: [{
            id: 'event-1',
            property_id: UUID_A,
            resident_id: UUID_B,
            actor_uid: 'a1',
            actor_role: 'admin',
            metadata: { reason: 'ownership transfer', offboarding: { revoked_passes: 1 } },
            created_at: '2026-05-11T08:00:00.000Z',
            full_name: 'Resident One',
            unit_id: UUID_C,
            is_active: false,
          }],
        });
      }
      if (sql.includes('FROM vehicles')) {
        return Promise.resolve({
          rows: [{ id: 'vehicle-1', plate_number: 'A001AA77', review_required: true }],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await supertest(buildApp())
      .get(`/api/v1/residents/offboarding-report?property_id=${UUID_A}&limit=10`);

    expect(res.status).toBe(200);
    expect(res.body.report.summary).toMatchObject({
      offboarded_residents: 2,
      vehicles_pending_review: 1,
    });
    expect(res.body.report.recent_offboardings[0]).toMatchObject({
      resident_name: 'Resident One',
      reason: 'ownership transfer',
    });
  });

  test('property admin offboards resident and returns cascade summary', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin', property_id: UUID_A };
    db.query.mockImplementation((sql) => {
      if (sql.includes('SELECT property_id FROM residents WHERE id = $1')) {
        return Promise.resolve({ rows: [{ property_id: UUID_A }] });
      }
      if (sql.includes('FROM residents') && sql.includes('external_uid')) {
        return Promise.resolve({
          rows: [{
            id: UUID_B,
            property_id: UUID_A,
            unit_id: UUID_C,
            external_uid: 'r1',
            is_active: true,
          }],
        });
      }
      if (sql.includes('FROM staff_users') && sql.includes('external_uid')) {
        return Promise.resolve({ rows: [{ id: UUID_D }] });
      }
      if (sql.includes('UPDATE residents')) {
        return Promise.resolve({ rows: [{ id: UUID_B, property_id: UUID_A, unit_id: UUID_C, is_active: false }] });
      }
      if (sql.includes('UPDATE role_scope_memberships')) {
        return Promise.resolve({ rows: [{ id: 'membership-1' }] });
      }
      if (sql.includes('UPDATE resident_unit_links')) {
        return Promise.resolve({ rows: [{ id: 'unit-link-1', unit_id: UUID_C }] });
      }
      if (sql.includes('UPDATE passes')) {
        return Promise.resolve({ rows: [{ id: 'pass-1' }] });
      }
      if (sql.includes('UPDATE access_requests')) {
        return Promise.resolve({ rows: [{ id: 'request-1' }] });
      }
      if (sql.includes('UPDATE vehicles')) {
        return Promise.resolve({ rows: [{ id: 'vehicle-1', review_required: true }] });
      }
      if (sql.includes('INSERT INTO resident_lifecycle_events')) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes('INSERT INTO property_audit_log')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await supertest(buildApp())
      .post(`/api/v1/residents/${UUID_B}/deactivate`)
      .send({ reason: 'ownership transfer' });

    expect(res.status).toBe(200);
    expect(res.body.offboarding.summary).toEqual({
      suspended_memberships: 1,
      revoked_passes: 1,
      deactivated_unit_links: 1,
      vehicles_marked_for_review: 1,
      cancelled_access_requests: 1,
      notification_preferences_disabled: 0,
      trusted_visitors_deactivated: 0,
    });
    const passUpdate = db.query.mock.calls.find(([sql]) => String(sql).includes('UPDATE passes'));
    expect(passUpdate[0]).toContain('p.subject_vehicle_id IN');
    expect(passUpdate[1][2]).toBe('resident offboarded: ownership transfer');

    const vehicleUpdate = db.query.mock.calls.find(([sql]) => String(sql).includes('UPDATE vehicles'));
    expect(vehicleUpdate[0]).toContain('review_required = true');
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

  test('403 when scoped admin creates staff for another property', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin', property_id: UUID_B };

    const res = await supertest(buildApp())
      .post('/api/v1/staff')
      .send({
        property_id: UUID_A, full_name: 'Guard', email: 'g@uk.ru', role: 'security',
      });

    expect(res.status).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
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
      // resolve resource property before full row read
      .mockResolvedValueOnce({ rows: [{ property_id: UUID_A }] })
      // read current row inside the resolved property
      .mockResolvedValueOnce({
        rows: [{
          id: UUID_A, property_id: UUID_A, full_name: 'Guard', phone: null, role: 'security',
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

  test('403 when scoped admin patches staff from another property', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin', property_id: UUID_A };
    db.query.mockResolvedValueOnce({
      rows: [{ property_id: UUID_B }],
    });

    const res = await supertest(buildApp())
      .patch(`/api/v1/staff/${UUID_D}`)
      .send({ role: 'concierge' });

    expect(res.status).toBe(403);
    expect(db.query).toHaveBeenCalledTimes(1);
  });
});

// ─── Contractors ─────────────────────────────────────────────────────────────

describe('POST /api/v1/contractor-users — company-status gate', () => {
  test('409 when company status is suspended', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin', property_id: UUID_B };
    db.query.mockResolvedValueOnce({ rows: [{ property_id: UUID_B, status: 'suspended' }] });

    const res = await supertest(buildApp())
      .post('/api/v1/contractor-users')
      .send({
        contractor_company_id: UUID_A, property_id: UUID_B, full_name: 'X',
      });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/suspended/);
  });

  test('400 when company does not exist', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin', property_id: UUID_B };
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await supertest(buildApp())
      .post('/api/v1/contractor-users')
      .send({
        contractor_company_id: UUID_A, property_id: UUID_B, full_name: 'X',
      });
    expect(res.status).toBe(400);
  });

  test('400 when access_expires_at is in the past', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin', property_id: UUID_B };
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
    mockCurrentUser = { uid: 'a1', role: 'admin', property_id: UUID_B };
    db.query
      .mockResolvedValueOnce({ rows: [{ property_id: UUID_B, status: 'active' }] })
      .mockResolvedValueOnce({ rows: [{ id: UUID_C, full_name: 'Worker', is_active: true }] });

    const res = await supertest(buildApp())
      .post('/api/v1/contractor-users')
      .send({
        contractor_company_id: UUID_A, property_id: UUID_B, full_name: 'Worker',
      });
    expect(res.status).toBe(201);
  });

  test('400 when company belongs to another property', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin', property_id: UUID_B };
    db.query.mockResolvedValueOnce({ rows: [{ property_id: UUID_A, status: 'active' }] });

    const res = await supertest(buildApp())
      .post('/api/v1/contractor-users')
      .send({
        contractor_company_id: UUID_A, property_id: UUID_B, full_name: 'Worker',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/does not belong/);
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
