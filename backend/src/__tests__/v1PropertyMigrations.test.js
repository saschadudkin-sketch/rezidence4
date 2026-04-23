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
    // 7 Фаза 2 + 8 Фаза 3 (Access-core) = 15
    expect(V1_PROPERTY_MIGRATIONS.length).toBe(15);
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

// =====================================================================
// Фаза 3 — Access-core (миграции 008–015)
// Spec: docs/product/specs/platform-v1/{vehicles,access-requests,passes,
//       visit-logs,access-incidents,qr-verification}-spec.md
// =====================================================================

describe('v1_008_vehicles', () => {
  let client;
  beforeEach(() => { client = { query: jest.fn().mockResolvedValue({ rows: [] }) }; });

  test('owner_type CHECK enum matches spec', async () => {
    await byId('v1_008_vehicles').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS vehicles'));
    expect(tbl).toContain("CHECK (owner_type IN ('resident','staff','contractor','guest'))");
  });

  test('owner_*_id exclusive CHECK is present (guest/resident/staff/contractor)', async () => {
    await byId('v1_008_vehicles').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS vehicles'));
    expect(tbl).toContain('CONSTRAINT vehicles_owner_exclusive CHECK');
    // Sanity: each owner_type branch appears in CHECK
    for (const t of ['guest', 'resident', 'staff', 'contractor']) {
      expect(tbl).toContain(`owner_type = '${t}'`);
    }
  });

  test('whitelist/blacklist mutual exclusion CHECK', async () => {
    await byId('v1_008_vehicles').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS vehicles'));
    expect(tbl).toContain('CONSTRAINT vehicles_flags_exclusive');
    expect(tbl).toMatch(/NOT \(is_whitelisted = true AND is_blacklisted = true\)/);
  });

  test('UNIQUE (property_id, plate_number) enforced', async () => {
    await byId('v1_008_vehicles').up(client);
    const idx = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('uq_vehicles_property_plate'));
    expect(idx).toBeDefined();
    expect(idx).toContain('(property_id, plate_number)');
  });
});

describe('v1_009_access_requests', () => {
  let client;
  beforeEach(() => { client = { query: jest.fn().mockResolvedValue({ rows: [] }) }; });

  test('request_type CHECK covers all six access-types', async () => {
    await byId('v1_009_access_requests').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS access_requests'));
    for (const t of [
      'guest_access', 'vehicle_access', 'contractor_access',
      'courier_access', 'service_access', 'temporary_resident_access',
    ]) {
      expect(tbl).toContain(`'${t}'`);
    }
  });

  test('status CHECK enum pinned (no legacy 14-value drift)', async () => {
    await byId('v1_009_access_requests').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS access_requests'));
    expect(tbl).toContain(
      "CHECK (status IN (\n                                          'new','pending_approval','approved','rejected','cancelled','expired'\n                                        ))",
    );
  });

  test('creator exclusivity CHECK', async () => {
    await byId('v1_009_access_requests').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS access_requests'));
    expect(tbl).toContain('CONSTRAINT access_requests_creator_exclusive');
  });

  test('time-window CHECK: ends_at > starts_at', async () => {
    await byId('v1_009_access_requests').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS access_requests'));
    expect(tbl).toContain('CONSTRAINT access_requests_window CHECK (ends_at > starts_at)');
  });

  test('vehicle_id FK is ON DELETE RESTRICT', async () => {
    await byId('v1_009_access_requests').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS access_requests'));
    expect(tbl).toContain('vehicle_id                      UUID REFERENCES vehicles(id) ON DELETE RESTRICT');
  });
});

describe('v1_010_access_approvals', () => {
  let client;
  beforeEach(() => { client = { query: jest.fn().mockResolvedValue({ rows: [] }) }; });

  test('CASCADE on access_request_id (approvals die with request)', async () => {
    await byId('v1_010_access_approvals').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS access_approvals'));
    expect(tbl).toContain('REFERENCES access_requests(id) ON DELETE CASCADE');
  });

  test('decision CHECK covers approved/rejected/escalated', async () => {
    await byId('v1_010_access_approvals').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS access_approvals'));
    expect(tbl).toContain("CHECK (decision IN ('approved','rejected','escalated'))");
  });

  test('approver_type consistency CHECK', async () => {
    await byId('v1_010_access_approvals').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS access_approvals'));
    expect(tbl).toContain('CONSTRAINT access_approvals_approver_consistent');
  });
});

describe('v1_011_passes', () => {
  let client;
  beforeEach(() => { client = { query: jest.fn().mockResolvedValue({ rows: [] }) }; });

  test('pass_type CHECK covers all 8 values', async () => {
    await byId('v1_011_passes').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS passes'));
    for (const t of ['guest', 'vehicle', 'resident', 'staff', 'contractor', 'courier', 'service', 'emergency']) {
      expect(tbl).toContain(`'${t}'`);
    }
  });

  test('status CHECK is active/used/expired/revoked/blocked', async () => {
    await byId('v1_011_passes').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS passes'));
    expect(tbl).toContain("CHECK (status IN ('active','used','expired','revoked','blocked'))");
  });

  test('subject exclusive CHECK covers all 5 subject_type branches', async () => {
    await byId('v1_011_passes').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS passes'));
    expect(tbl).toContain('CONSTRAINT passes_subject_exclusive');
    for (const t of ['resident', 'staff', 'contractor_user', 'vehicle', 'guest']) {
      expect(tbl).toContain(`subject_type = '${t}'`);
    }
  });

  test('revoke audit CHECK: status=revoked requires revoked_at + revoked_reason', async () => {
    await byId('v1_011_passes').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS passes'));
    expect(tbl).toContain('CONSTRAINT passes_revoke_audit');
    expect(tbl).toMatch(/status <>\s*'revoked' OR/);
  });

  test('time-window CHECK: valid_until > valid_from', async () => {
    await byId('v1_011_passes').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS passes'));
    expect(tbl).toContain('CONSTRAINT passes_window CHECK (valid_until > valid_from)');
  });

  test('access_request_id FK is SET NULL (pass survives request deletion)', async () => {
    await byId('v1_011_passes').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS passes'));
    expect(tbl).toContain('access_request_id               UUID REFERENCES access_requests(id) ON DELETE SET NULL');
  });
});

describe('v1_012_qr_passes_v2', () => {
  let client;
  beforeEach(() => { client = { query: jest.fn().mockResolvedValue({ rows: [] }) }; });

  test('pass_id is UNIQUE (one active QR per pass)', async () => {
    await byId('v1_012_qr_passes_v2').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS qr_passes_v2'));
    expect(tbl).toContain('pass_id         UUID NOT NULL UNIQUE REFERENCES passes(id) ON DELETE CASCADE');
  });

  test('token UNIQUE index exists', async () => {
    await byId('v1_012_qr_passes_v2').up(client);
    const idx = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('uq_qr_passes_v2_token'));
    expect(idx).toBeDefined();
  });

  test('render_version CHECK >= 1', async () => {
    await byId('v1_012_qr_passes_v2').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS qr_passes_v2'));
    expect(tbl).toContain('CONSTRAINT qr_passes_v2_render_positive CHECK (render_version >= 1)');
  });
});

describe('v1_013_visit_logs_v2', () => {
  let client;
  beforeEach(() => { client = { query: jest.fn().mockResolvedValue({ rows: [] }) }; });

  test('event_type CHECK covers all 7 values', async () => {
    await byId('v1_013_visit_logs_v2').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS visit_logs_v2'));
    for (const t of [
      'entry_allowed', 'entry_denied', 'exit_allowed', 'exit_denied',
      'manual_admit', 'manual_deny', 'override',
    ]) {
      expect(tbl).toContain(`'${t}'`);
    }
  });

  test('event_source CHECK: domhub/skud/guard_console/import', async () => {
    await byId('v1_013_visit_logs_v2').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS visit_logs_v2'));
    expect(tbl).toContain("CHECK (event_source IN ('domhub','skud','guard_console','import'))");
  });

  test('pass_id FK is ON DELETE SET NULL (visit_log survives pass deletion)', async () => {
    await byId('v1_013_visit_logs_v2').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS visit_logs_v2'));
    expect(tbl).toContain('pass_id                     UUID REFERENCES passes(id) ON DELETE SET NULL');
  });

  test('partial UNIQUE (event_source, provider_event_id) for webhook idempotency', async () => {
    await byId('v1_013_visit_logs_v2').up(client);
    const idx = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('uq_visit_logs_v2_provider_event'));
    expect(idx).toBeDefined();
    expect(idx).toContain('WHERE provider_event_id IS NOT NULL');
  });

  test('occurred_at DESC composite index for property-timeline queries', async () => {
    await byId('v1_013_visit_logs_v2').up(client);
    const idx = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('idx_visit_logs_v2_property_time'));
    expect(idx).toBeDefined();
    expect(idx).toContain('(property_id, occurred_at DESC)');
  });
});

describe('v1_014_access_incidents', () => {
  let client;
  beforeEach(() => { client = { query: jest.fn().mockResolvedValue({ rows: [] }) }; });

  test('incident_type CHECK covers all 8 values', async () => {
    await byId('v1_014_access_incidents').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS access_incidents'));
    for (const t of [
      'expired_pass_attempt', 'invalid_qr', 'blacklist_hit',
      'outside_time_window', 'unauthorized_vehicle', 'manual_override',
      'provider_conflict', 'suspicious_repeat_attempt',
    ]) {
      expect(tbl).toContain(`'${t}'`);
    }
  });

  test('severity CHECK: low/medium/high/critical, default medium', async () => {
    await byId('v1_014_access_incidents').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS access_incidents'));
    expect(tbl).toContain("severity                VARCHAR(20) NOT NULL DEFAULT 'medium'");
    expect(tbl).toContain("CHECK (severity IN ('low','medium','high','critical'))");
  });

  test('status CHECK: open/investigating/resolved/dismissed', async () => {
    await byId('v1_014_access_incidents').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS access_incidents'));
    expect(tbl).toContain("CHECK (status IN ('open','investigating','resolved','dismissed'))");
  });

  test('resolved audit CHECK: terminal status requires resolved_at', async () => {
    await byId('v1_014_access_incidents').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS access_incidents'));
    expect(tbl).toContain('CONSTRAINT access_incidents_resolved_audit');
  });

  test('idempotency partial UNIQUE on (related_visit_log_id, incident_type) for system-created', async () => {
    await byId('v1_014_access_incidents').up(client);
    const idx = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('uq_access_incidents_visit_log_type'));
    expect(idx).toBeDefined();
    expect(idx).toContain('related_visit_log_id IS NOT NULL AND created_by_staff_id IS NULL');
  });

  test('open-queue partial index ordered severity DESC, created_at DESC', async () => {
    await byId('v1_014_access_incidents').up(client);
    const idx = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('idx_access_incidents_open_queue'));
    expect(idx).toBeDefined();
    expect(idx).toContain('(property_id, severity DESC, created_at DESC)');
    expect(idx).toContain("WHERE status IN ('open','investigating')");
  });
});

describe('v1_015_access_overrides', () => {
  let client;
  beforeEach(() => { client = { query: jest.fn().mockResolvedValue({ rows: [] }) }; });

  test('override_type CHECK: manual_admit/deny + temporary_whitelist/block', async () => {
    await byId('v1_015_access_overrides').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS access_overrides'));
    for (const t of ['manual_admit', 'manual_deny', 'temporary_whitelist', 'temporary_block']) {
      expect(tbl).toContain(`'${t}'`);
    }
  });

  test('target required CHECK: incident_id OR pass_id', async () => {
    await byId('v1_015_access_overrides').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS access_overrides'));
    expect(tbl).toContain('CONSTRAINT access_overrides_target_required');
    expect(tbl).toContain('incident_id IS NOT NULL OR pass_id IS NOT NULL');
  });

  test('reason is NOT NULL (every override has justification)', async () => {
    await byId('v1_015_access_overrides').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS access_overrides'));
    expect(tbl).toContain('reason                  TEXT NOT NULL');
  });

  test('performed_by_staff_id is NOT NULL with ON DELETE RESTRICT (staff retention)', async () => {
    await byId('v1_015_access_overrides').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS access_overrides'));
    expect(tbl).toContain('performed_by_staff_id   UUID NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT');
  });

  test('per-staff audit index on (performed_by_staff_id, created_at DESC)', async () => {
    await byId('v1_015_access_overrides').up(client);
    const idx = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('idx_access_overrides_staff_time'));
    expect(idx).toBeDefined();
    expect(idx).toContain('(performed_by_staff_id, created_at DESC)');
  });
});
