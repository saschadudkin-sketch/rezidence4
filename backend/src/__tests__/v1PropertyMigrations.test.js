'use strict';

/**
 * Phase 2 (D-lite) — property-DB migration SQL-shape tests.
 *
 * These run against a Postgres-free mock client.  The point is to catch
 * accidental edits to the migration contract (dropping a CHECK, changing a
 * column type, losing an index) — the real schema is verified by the
 * integration suite.  If any of these tests fails, the migration file in
 * `backend/src/v1/migrations/` has drifted from its spec.
 */

const { describe, test, expect, beforeEach } = require('@jest/globals');
const {
  V1_PROPERTY_MIGRATIONS,
  LATEST_V1_PROPERTY_MIGRATION_ID,
} = require('../v1/migrations');

function byId(id) {
  const m = V1_PROPERTY_MIGRATIONS.find((x) => x.id === id);
  if (!m) throw new Error(`migration ${id} not found`);
  return m;
}

describe('v1 property migrations — registry invariants', () => {
  test('exports a non-empty ordered array', () => {
    expect(Array.isArray(V1_PROPERTY_MIGRATIONS)).toBe(true);
    expect(V1_PROPERTY_MIGRATIONS.length).toBe(7);
  });

  test('every id is prefixed v1_ so it never collides with legacy', () => {
    for (const m of V1_PROPERTY_MIGRATIONS) {
      expect(m.id.startsWith('v1_')).toBe(true);
    }
  });

  test('ids are unique', () => {
    const ids = V1_PROPERTY_MIGRATIONS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('every migration exposes an async up(client)', () => {
    for (const m of V1_PROPERTY_MIGRATIONS) {
      expect(typeof m.up).toBe('function');
    }
  });

  test('LATEST_V1_PROPERTY_MIGRATION_ID points at the last item', () => {
    expect(LATEST_V1_PROPERTY_MIGRATION_ID).toBe(
      V1_PROPERTY_MIGRATIONS[V1_PROPERTY_MIGRATIONS.length - 1].id,
    );
  });
});

describe('v1_001_buildings', () => {
  let client;
  beforeEach(() => { client = { query: jest.fn().mockResolvedValue({ rows: [] }) }; });

  test('creates buildings table with property_id + name NOT NULL and code nullable', async () => {
    await byId('v1_001_buildings').up(client);
    const sqls = client.query.mock.calls.map((c) => c[0]);

    const tbl = sqls.find((s) => s.includes('CREATE TABLE IF NOT EXISTS buildings'));
    expect(tbl).toBeDefined();
    expect(tbl).toContain('property_id  UUID NOT NULL');
    expect(tbl).toContain('name         VARCHAR(100) NOT NULL');
    expect(tbl).toMatch(/code\s+VARCHAR\(50\),/);
  });

  test('partial UNIQUE on (property_id, code) WHERE code IS NOT NULL', async () => {
    await byId('v1_001_buildings').up(client);
    const sqls = client.query.mock.calls.map((c) => c[0]);
    const idx = sqls.find((s) => s.includes('uq_buildings_property_code'));
    expect(idx).toBeDefined();
    expect(idx).toContain('WHERE code IS NOT NULL');
  });
});

describe('v1_002_entrances', () => {
  let client;
  beforeEach(() => { client = { query: jest.fn().mockResolvedValue({ rows: [] }) }; });

  test('FK on building_id is ON DELETE RESTRICT', async () => {
    await byId('v1_002_entrances').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS entrances'));
    expect(tbl).toBeDefined();
    expect(tbl).toContain('REFERENCES buildings(id) ON DELETE RESTRICT');
  });

  test('partial UNIQUE on (building_id, code) WHERE code IS NOT NULL', async () => {
    await byId('v1_002_entrances').up(client);
    const idx = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('uq_entrances_building_code'));
    expect(idx).toBeDefined();
    expect(idx).toContain('WHERE code IS NOT NULL');
  });
});

describe('v1_003_units', () => {
  let client;
  beforeEach(() => { client = { query: jest.fn().mockResolvedValue({ rows: [] }) }; });

  test('unit_type CHECK enum matches spec exactly', async () => {
    await byId('v1_003_units').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS units'));
    expect(tbl).toContain(
      "CHECK (unit_type IN ('apartment','townhouse','house','commercial','utility'))",
    );
  });

  test('denormalises property_id and building_id alongside entrance_id FK', async () => {
    await byId('v1_003_units').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS units'));
    expect(tbl).toContain('property_id  UUID NOT NULL');
    expect(tbl).toContain('building_id  UUID NOT NULL REFERENCES buildings(id) ON DELETE RESTRICT');
    expect(tbl).toContain('entrance_id  UUID NOT NULL REFERENCES entrances(id) ON DELETE RESTRICT');
  });

  test('UNIQUE (property_id, building_id, entrance_id, unit_number)', async () => {
    await byId('v1_003_units').up(client);
    const idx = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('uq_units_identity'));
    expect(idx).toBeDefined();
    expect(idx).toContain('(property_id, building_id, entrance_id, unit_number)');
  });
});

describe('v1_004_residents', () => {
  let client;
  beforeEach(() => { client = { query: jest.fn().mockResolvedValue({ rows: [] }) }; });

  test('external_uid is UNIQUE but nullable', async () => {
    await byId('v1_004_residents').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS residents'));
    expect(tbl).toContain('external_uid      TEXT UNIQUE');
    // Ensure we did NOT make it NOT NULL
    expect(tbl).not.toMatch(/external_uid\s+TEXT UNIQUE NOT NULL/);
  });

  test('unit_id FK is ON DELETE RESTRICT', async () => {
    await byId('v1_004_residents').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS residents'));
    expect(tbl).toContain('REFERENCES units(id) ON DELETE RESTRICT');
  });

  test('resident_type CHECK enum matches spec', async () => {
    await byId('v1_004_residents').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS residents'));
    expect(tbl).toContain("CHECK (resident_type IN ('owner','tenant','family_member'))");
  });

  test('consent fields exist but are nullable', async () => {
    await byId('v1_004_residents').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS residents'));
    expect(tbl).toMatch(/consent_given_at\s+TIMESTAMPTZ,/);
    expect(tbl).toMatch(/consent_version\s+VARCHAR\(20\),/);
  });

  test('phone is intentionally NOT UNIQUE (spec §2)', async () => {
    await byId('v1_004_residents').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS residents'));
    expect(tbl).not.toMatch(/phone\s+TEXT\s+NOT\s+NULL\s+UNIQUE/);
  });
});

describe('v1_005_staff_users', () => {
  let client;
  beforeEach(() => { client = { query: jest.fn().mockResolvedValue({ rows: [] }) }; });

  test('role CHECK enum is exactly the four operational roles', async () => {
    await byId('v1_005_staff_users').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS staff_users'));
    expect(tbl).toContain("CHECK (role IN ('security','concierge','technician','property_admin'))");
  });

  test('specialization is NULL or one of four values', async () => {
    await byId('v1_005_staff_users').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS staff_users'));
    expect(tbl).toContain(
      "CHECK (specialization IS NULL\n                                         OR specialization IN ('plumbing','electric','cleaning','general'))",
    );
  });

  test('capability flag columns exist with defaults', async () => {
    await byId('v1_005_staff_users').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS staff_users'));
    expect(tbl).toContain('can_view_resident_phone   BOOLEAN NOT NULL DEFAULT false');
    expect(tbl).toContain('can_assign_requests       BOOLEAN NOT NULL DEFAULT false');
  });

  test('UNIQUE (property_id, LOWER(email)) is case-insensitive', async () => {
    await byId('v1_005_staff_users').up(client);
    const idx = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('uq_staff_users_property_email'));
    expect(idx).toBeDefined();
    expect(idx).toContain('LOWER(email)');
  });
});

describe('v1_006_contractor_companies', () => {
  let client;
  beforeEach(() => { client = { query: jest.fn().mockResolvedValue({ rows: [] }) }; });

  test('status CHECK enum matches spec', async () => {
    await byId('v1_006_contractor_companies').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS contractor_companies'));
    expect(tbl).toContain("CHECK (status IN ('active','suspended','terminated'))");
  });

  test('UNIQUE (property_id, LOWER(name)) is case-insensitive', async () => {
    await byId('v1_006_contractor_companies').up(client);
    const idx = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('uq_contractor_companies_property_name'));
    expect(idx).toBeDefined();
    expect(idx).toContain('LOWER(name)');
  });
});

describe('v1_007_contractor_users', () => {
  let client;
  beforeEach(() => { client = { query: jest.fn().mockResolvedValue({ rows: [] }) }; });

  test('FK on contractor_company_id is RESTRICT', async () => {
    await byId('v1_007_contractor_users').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS contractor_users'));
    expect(tbl).toContain('REFERENCES contractor_companies(id) ON DELETE RESTRICT');
  });

  test('access_expires_at partial index covers only active + non-null expiries', async () => {
    await byId('v1_007_contractor_users').up(client);
    const idx = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('idx_contractor_users_expiry'));
    expect(idx).toBeDefined();
    expect(idx).toContain('WHERE is_active = true AND access_expires_at IS NOT NULL');
  });
});
