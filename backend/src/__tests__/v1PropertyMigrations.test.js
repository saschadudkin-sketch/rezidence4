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
    // 7 Фаза 2 + 8 Фаза 3 (Access-core) + 6 Фаза 5 (Content+Notifications)
    // + 1 Фаза 6 (notification_templates_v2) + 1 Фаза 0 bridge
    // + 1 access-request list indexes + 1 escalated status
    // + 1 DH-03 role/scope membership foundation
    // + 1 DH-06 access topology foundation + 1 DH-13/DH-14 policy layer
    // + 1 DH-22 service request core + 1 DH-23 attachments/updates
    // + 1 DH-24 assignment/SLA/escalation + 1 DH-27 technician workflow
    // + 1 DH-29 contractor workflow + 1 DH-41 SKUD framework
    // + 1 DH-43 video evidence baseline + 1 DH-43 VMS/NVR configs
    // + 1 DH-42 common Russia SKUD provider expansion
    // + 1 DH-44 ERP/1C exchange baseline
    // + 1 DH-45 analytics aggregation snapshots
    // + 1 DH-03/DH-08/DH-17..21 membership/review/lifecycle ledger
    // + 1 DH-60 sensitive review assignment/SLA operations
    // + 1 DH-55 resident offboarding cascade
    // + 1 DH-57 emergency dispatch mode = 43
    expect(V1_PROPERTY_MIGRATIONS.length).toBe(43);
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
      "CHECK (status IN (\n                                          'new','pending_approval','escalated','approved','rejected','cancelled','expired'\n                                        ))",
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

// =====================================================================
// Фаза 5 — Content + Notifications (миграции 016–021)
// Specs: docs/product/specs/platform-v1/{notifications-outbox,
//        notification-log-v2,documents-v2,packages-v2,announcements-v2}-spec.md
//        plus README §"Фаза 5 не покрытая спеками" for 021.
// =====================================================================

describe('v1_016_notifications_outbox', () => {
  let client;
  beforeEach(() => { client = { query: jest.fn().mockResolvedValue({ rows: [] }) }; });

  test('channel CHECK covers all 5 supported channels', async () => {
    await byId('v1_016_notifications_outbox').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS notifications_outbox'));
    for (const ch of ['web_push', 'sms', 'telegram', 'webhook', 'email']) {
      expect(tbl).toContain(`'${ch}'`);
    }
  });

  test('recipient_type CHECK covers all 5 types incl. vehicle + external', async () => {
    await byId('v1_016_notifications_outbox').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS notifications_outbox'));
    for (const t of ['resident', 'staff', 'contractor', 'vehicle', 'external']) {
      expect(tbl).toContain(`'${t}'`);
    }
  });

  test('status CHECK is pending/in_flight/sent/failed/dead with pending default', async () => {
    await byId('v1_016_notifications_outbox').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS notifications_outbox'));
    expect(tbl).toContain("status            VARCHAR(20) NOT NULL DEFAULT 'pending'");
    expect(tbl).toContain("CHECK (status IN (\n                              'pending','in_flight','sent','failed','dead'\n                            ))");
  });

  test('sent audit CHECK: status=sent requires sent_at', async () => {
    await byId('v1_016_notifications_outbox').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS notifications_outbox'));
    expect(tbl).toContain('CONSTRAINT notifications_outbox_sent_audit');
    expect(tbl).toMatch(/status <>\s*'sent' OR sent_at IS NOT NULL/);
  });

  test('attempt bookkeeping: nonneg attempts + positive max_attempts', async () => {
    await byId('v1_016_notifications_outbox').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS notifications_outbox'));
    expect(tbl).toContain('CONSTRAINT notifications_outbox_attempts_nonneg CHECK (attempt_count >= 0)');
    expect(tbl).toContain('CONSTRAINT notifications_outbox_max_positive    CHECK (max_attempts > 0)');
  });

  test('worker queue partial index: WHERE status IN (pending, failed)', async () => {
    await byId('v1_016_notifications_outbox').up(client);
    const idx = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('idx_notifications_outbox_worker_queue'));
    expect(idx).toBeDefined();
    expect(idx).toContain('(next_attempt_at)');
    expect(idx).toContain("WHERE status IN ('pending','failed')");
  });

  test('correlation partial index: WHERE correlation_id IS NOT NULL', async () => {
    await byId('v1_016_notifications_outbox').up(client);
    const idx = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('idx_notifications_outbox_correlation'));
    expect(idx).toBeDefined();
    expect(idx).toContain('WHERE correlation_id IS NOT NULL');
  });
});

describe('v1_017_notification_log_v2', () => {
  let client;
  beforeEach(() => { client = { query: jest.fn().mockResolvedValue({ rows: [] }) }; });

  test('recipient_type is a 4-value enum (no vehicle — log_v2 is delivered facts only)', async () => {
    await byId('v1_017_notification_log_v2').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS notification_log_v2'));
    expect(tbl).toContain("CHECK (recipient_type IN (\n                                'resident','staff','contractor','external'\n                              ))");
    // vehicle is specifically an outbox-only concept (blacklist), not a
    // real delivery target — make sure we haven't accidentally copy-pasted.
    expect(tbl).not.toMatch(/recipient_type IN \([^)]*'vehicle'/);
  });

  test('status CHECK is terminal-only: sent/failed (no in_flight leak)', async () => {
    await byId('v1_017_notification_log_v2').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS notification_log_v2'));
    expect(tbl).toContain("CHECK (status IN ('sent','failed'))");
  });

  test('sent-clean CHECK: status=sent forbids error_code/error_message', async () => {
    await byId('v1_017_notification_log_v2').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS notification_log_v2'));
    expect(tbl).toContain('CONSTRAINT notification_log_v2_sent_clean');
    expect(tbl).toMatch(/status <>\s*'sent' OR \(error_code IS NULL AND error_message IS NULL\)/);
  });

  test('failed-coded CHECK: status=failed requires error_code', async () => {
    await byId('v1_017_notification_log_v2').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS notification_log_v2'));
    expect(tbl).toContain('CONSTRAINT notification_log_v2_failed_coded');
  });

  test('external vs internal recipient invariants', async () => {
    await byId('v1_017_notification_log_v2').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS notification_log_v2'));
    expect(tbl).toContain('CONSTRAINT notification_log_v2_external_no_id');
    expect(tbl).toContain('CONSTRAINT notification_log_v2_internal_has_id');
  });

  test('outbox_id FK is ON DELETE SET NULL (log survives outbox cleanup)', async () => {
    await byId('v1_017_notification_log_v2').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS notification_log_v2'));
    expect(tbl).toContain('REFERENCES notifications_outbox(id) ON DELETE SET NULL');
  });

  test('1-to-1 UNIQUE partial index on outbox_id', async () => {
    await byId('v1_017_notification_log_v2').up(client);
    const idx = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('uq_notification_log_v2_outbox'));
    expect(idx).toBeDefined();
    expect(idx).toContain('WHERE outbox_id IS NOT NULL');
  });

  test('recipient-history index on (property_id, recipient_type, recipient_id, created_at DESC)', async () => {
    await byId('v1_017_notification_log_v2').up(client);
    const idx = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('idx_notification_log_v2_recipient'));
    expect(idx).toBeDefined();
    expect(idx).toContain('(property_id, recipient_type, recipient_id, created_at DESC)');
  });
});

describe('v1_018_documents_v2', () => {
  let client;
  beforeEach(() => { client = { query: jest.fn().mockResolvedValue({ rows: [] }) }; });

  test('category CHECK enum has 7 values incl. safety + legal (legacy had 5)', async () => {
    await byId('v1_018_documents_v2').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS documents_v2'));
    for (const c of ['rules', 'contacts', 'instructions', 'contracts', 'safety', 'legal', 'other']) {
      expect(tbl).toContain(`'${c}'`);
    }
  });

  test('has-content CHECK: at least one of body_md / file_url', async () => {
    await byId('v1_018_documents_v2').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS documents_v2'));
    expect(tbl).toContain('CONSTRAINT documents_v2_has_content');
    expect(tbl).toContain('body_md IS NOT NULL OR file_url IS NOT NULL');
  });

  test('file-metadata CHECK: file_url implies mime + size', async () => {
    await byId('v1_018_documents_v2').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS documents_v2'));
    expect(tbl).toContain('CONSTRAINT documents_v2_file_metadata');
    expect(tbl).toContain('file_url IS NULL');
    expect(tbl).toContain('file_mime IS NOT NULL AND file_size_bytes IS NOT NULL');
  });

  test('public partial index: is_public + published_at + not deleted', async () => {
    await byId('v1_018_documents_v2').up(client);
    const idx = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('idx_documents_v2_public'));
    expect(idx).toBeDefined();
    expect(idx).toContain('WHERE deleted_at IS NULL AND published_at IS NOT NULL');
  });

  test('document_versions has CASCADE on document_id', async () => {
    await byId('v1_018_documents_v2').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS document_versions'));
    expect(tbl).toBeDefined();
    expect(tbl).toContain('REFERENCES documents_v2(id) ON DELETE CASCADE');
  });

  test('document_versions UNIQUE (document_id, version DESC)', async () => {
    await byId('v1_018_documents_v2').up(client);
    const idx = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('uq_document_versions_doc_version'));
    expect(idx).toBeDefined();
    expect(idx).toContain('(document_id, version DESC)');
  });

  test('document_versions version CHECK >= 1', async () => {
    await byId('v1_018_documents_v2').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS document_versions'));
    expect(tbl).toContain('CONSTRAINT document_versions_version_positive CHECK (version >= 1)');
  });
});

describe('v1_019_packages_v2', () => {
  let client;
  beforeEach(() => { client = { query: jest.fn().mockResolvedValue({ rows: [] }) }; });

  test('unit_id NOT NULL with ON DELETE RESTRICT (spec §8 Q1)', async () => {
    await byId('v1_019_packages_v2').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS packages_v2'));
    expect(tbl).toContain('unit_id                    UUID NOT NULL REFERENCES units(id) ON DELETE RESTRICT');
  });

  test('received_by_staff_id NOT NULL with ON DELETE RESTRICT (staff retention)', async () => {
    await byId('v1_019_packages_v2').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS packages_v2'));
    expect(tbl).toContain('received_by_staff_id       UUID NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT');
  });

  test('recipient_resident_id FK is ON DELETE SET NULL (spec §8 Q6)', async () => {
    await byId('v1_019_packages_v2').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS packages_v2'));
    expect(tbl).toContain('recipient_resident_id      UUID REFERENCES residents(id) ON DELETE SET NULL');
  });

  test('status CHECK enum: awaiting_pickup/picked_up/returned/lost', async () => {
    await byId('v1_019_packages_v2').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS packages_v2'));
    for (const s of ['awaiting_pickup', 'picked_up', 'returned', 'lost']) {
      expect(tbl).toContain(`'${s}'`);
    }
  });

  test('pickup audit CHECK: picked_up requires picked_up_at + staff_id', async () => {
    await byId('v1_019_packages_v2').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS packages_v2'));
    expect(tbl).toContain('CONSTRAINT packages_v2_pickup_audit');
  });

  test('pickup identity exclusive + required CHECKs', async () => {
    await byId('v1_019_packages_v2').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS packages_v2'));
    expect(tbl).toContain('CONSTRAINT packages_v2_pickup_identity_exclusive');
    expect(tbl).toContain('CONSTRAINT packages_v2_pickup_identity_required');
  });

  test('awaiting-clean CHECK: awaiting forbids picked_up_at + returned_at', async () => {
    await byId('v1_019_packages_v2').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS packages_v2'));
    expect(tbl).toContain('CONSTRAINT packages_v2_awaiting_clean');
  });

  test('SLA partial index on awaiting_pickup by received_at DESC', async () => {
    await byId('v1_019_packages_v2').up(client);
    const idx = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('idx_packages_v2_sla'));
    expect(idx).toBeDefined();
    expect(idx).toContain("WHERE status = 'awaiting_pickup'");
  });

  test('tracking partial index for conflict lookup', async () => {
    await byId('v1_019_packages_v2').up(client);
    const idx = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('idx_packages_v2_tracking'));
    expect(idx).toBeDefined();
    expect(idx).toContain('WHERE tracking_number IS NOT NULL');
  });
});

describe('v1_020_announcements_v2', () => {
  let client;
  beforeEach(() => { client = { query: jest.fn().mockResolvedValue({ rows: [] }) }; });

  test('category CHECK enum: general/maintenance/event/emergency/marketing', async () => {
    await byId('v1_020_announcements_v2').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS announcements_v2'));
    for (const c of ['general', 'maintenance', 'event', 'emergency', 'marketing']) {
      expect(tbl).toContain(`'${c}'`);
    }
  });

  test('audience_type CHECK limited to 4 values (custom deferred §7 Q3)', async () => {
    await byId('v1_020_announcements_v2').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS announcements_v2'));
    expect(tbl).toContain("CHECK (audience_type IN (\n                                   'all','building','entrance','unit_type'\n                                 ))");
    // custom is reserved but not enabled in v1 — the CHECK must NOT list it.
    expect(tbl).not.toMatch(/audience_type IN \([^)]*'custom'/);
  });

  test('audience_unit_type CHECK: owner/tenant/family_member or NULL', async () => {
    await byId('v1_020_announcements_v2').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS announcements_v2'));
    for (const t of ['owner', 'tenant', 'family_member']) {
      expect(tbl).toContain(`'${t}'`);
    }
  });

  test('audience_fields CHECK enforces one-hot selector', async () => {
    await byId('v1_020_announcements_v2').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS announcements_v2'));
    expect(tbl).toContain('CONSTRAINT announcements_v2_audience_fields');
  });

  test('window CHECK: expires_at > starts_at when set', async () => {
    await byId('v1_020_announcements_v2').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS announcements_v2'));
    expect(tbl).toContain('CONSTRAINT announcements_v2_window');
    expect(tbl).toContain('expires_at IS NULL OR expires_at > starts_at');
  });

  test('urgent-requires-push CHECK: is_urgent=true forces web_push', async () => {
    await byId('v1_020_announcements_v2').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS announcements_v2'));
    expect(tbl).toContain('CONSTRAINT announcements_v2_urgent_requires_push');
    expect(tbl).toContain("NOT is_urgent OR 'web_push' = ANY(notify_channels)");
  });

  test('notify_channels CHECK: subset of {web_push, sms, telegram, email}', async () => {
    await byId('v1_020_announcements_v2').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS announcements_v2'));
    expect(tbl).toContain('CONSTRAINT announcements_v2_channels_subset');
    expect(tbl).toContain("notify_channels <@ ARRAY['web_push','sms','telegram','email']::text[]");
  });

  test('publish audit CHECK: published_at requires published_by_staff_id', async () => {
    await byId('v1_020_announcements_v2').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS announcements_v2'));
    expect(tbl).toContain('CONSTRAINT announcements_v2_publish_audit');
  });

  test('feed index: pinned DESC, urgent DESC, starts_at DESC, partial on visible', async () => {
    await byId('v1_020_announcements_v2').up(client);
    const idx = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('idx_announcements_v2_feed'));
    expect(idx).toBeDefined();
    expect(idx).toContain('(property_id, is_pinned DESC, is_urgent DESC, starts_at DESC)');
    expect(idx).toContain('WHERE deleted_at IS NULL AND published_at IS NOT NULL');
  });

  test('default notify_channels is ARRAY[web_push]', async () => {
    await byId('v1_020_announcements_v2').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS announcements_v2'));
    expect(tbl).toContain("DEFAULT ARRAY['web_push']::text[]");
  });
});

describe('v1_021_property_audit_log', () => {
  let client;
  beforeEach(() => { client = { query: jest.fn().mockResolvedValue({ rows: [] }) }; });

  test('conditional rename wrapped in DO $$ block (legacy audit_log → property_audit_log)', async () => {
    await byId('v1_021_property_audit_log').up(client);
    const sqls = client.query.mock.calls.map((c) => c[0]);
    const doBlock = sqls.find((s) => s.includes('DO $$') && s.includes('ALTER TABLE audit_log RENAME TO property_audit_log'));
    expect(doBlock).toBeDefined();
    expect(doBlock).toContain("table_name   = 'audit_log'");
    expect(doBlock).toContain("table_name   = 'property_audit_log'");
  });

  test('conditional rename of legacy indexes (idx_audit_log_actor / _resource)', async () => {
    await byId('v1_021_property_audit_log').up(client);
    const sqls = client.query.mock.calls.map((c) => c[0]);
    const doBlock = sqls.find((s) => s.includes('ALTER INDEX idx_audit_log_actor RENAME TO idx_property_audit_log_actor'));
    expect(doBlock).toBeDefined();
    expect(doBlock).toContain('ALTER INDEX idx_audit_log_resource RENAME TO idx_property_audit_log_resource');
  });

  test('fresh-install CREATE TABLE IF NOT EXISTS property_audit_log', async () => {
    await byId('v1_021_property_audit_log').up(client);
    const sqls = client.query.mock.calls.map((c) => c[0]);
    const tbl = sqls.find((s) => s.includes('CREATE TABLE IF NOT EXISTS property_audit_log'));
    expect(tbl).toBeDefined();
    expect(tbl).toContain('action         VARCHAR(100) NOT NULL');
    expect(tbl).toContain('resource_type  VARCHAR(50) NOT NULL');
    // Fresh install MUST NOT add the legacy users(uid) FK — users is split.
    expect(tbl).not.toMatch(/actor_uid\s+TEXT REFERENCES users/);
  });

  test('idempotent ADD COLUMN IF NOT EXISTS for all 4 new columns', async () => {
    await byId('v1_021_property_audit_log').up(client);
    const sqls = client.query.mock.calls.map((c) => c[0]);
    for (const col of ['property_id UUID', 'actor_type  VARCHAR(20)', 'entity_type VARCHAR(50)', 'entity_id   UUID']) {
      const stmt = sqls.find((s) => s.includes('ADD COLUMN IF NOT EXISTS') && s.includes(col));
      expect(stmt).toBeDefined();
    }
  });

  test('actor_type CHECK enum: drop-then-add (idempotent)', async () => {
    await byId('v1_021_property_audit_log').up(client);
    const sqls = client.query.mock.calls.map((c) => c[0]);
    const drop = sqls.find((s) => s.includes('DROP CONSTRAINT IF EXISTS property_audit_log_actor_type_check'));
    const add = sqls.find((s) => s.includes('ADD CONSTRAINT property_audit_log_actor_type_check'));
    expect(drop).toBeDefined();
    expect(add).toBeDefined();
    for (const t of ['resident', 'staff', 'contractor', 'system', 'external']) {
      expect(add).toContain(`'${t}'`);
    }
  });

  test('v1 entity-lookup partial index: WHERE entity_id IS NOT NULL', async () => {
    await byId('v1_021_property_audit_log').up(client);
    const idx = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('idx_property_audit_log_entity'));
    expect(idx).toBeDefined();
    expect(idx).toContain('(entity_type, entity_id, created_at DESC)');
    expect(idx).toContain('WHERE entity_id IS NOT NULL');
  });

  test('per-property timeline partial index', async () => {
    await byId('v1_021_property_audit_log').up(client);
    const idx = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('idx_property_audit_log_property_time'));
    expect(idx).toBeDefined();
    expect(idx).toContain('(property_id, created_at DESC)');
    expect(idx).toContain('WHERE property_id IS NOT NULL');
  });
});

describe('v1_023_actor_external_uid', () => {
  let client;
  beforeEach(() => { client = { query: jest.fn().mockResolvedValue({ rows: [] }) }; });

  test('adds external_uid bridge columns to staff and contractor users', async () => {
    await byId('v1_023_actor_external_uid').up(client);
    const sqls = client.query.mock.calls.map((c) => c[0]);

    expect(sqls.find((s) => s.includes('ALTER TABLE staff_users') && s.includes('external_uid TEXT'))).toBeDefined();
    expect(sqls.find((s) => s.includes('ALTER TABLE contractor_users') && s.includes('external_uid TEXT'))).toBeDefined();
  });

  test('guards non-null external_uid uniqueness', async () => {
    await byId('v1_023_actor_external_uid').up(client);
    const sqls = client.query.mock.calls.map((c) => c[0]);

    const staffIdx = sqls.find((s) => s.includes('uq_staff_users_external_uid'));
    const contractorIdx = sqls.find((s) => s.includes('uq_contractor_users_external_uid'));
    expect(staffIdx).toContain('WHERE external_uid IS NOT NULL');
    expect(contractorIdx).toContain('WHERE external_uid IS NOT NULL');
  });
});

describe('v1_024_access_request_list_indexes', () => {
  let client;
  beforeEach(() => { client = { query: jest.fn().mockResolvedValue({ rows: [] }) }; });

  test('adds resident/status/created_at indexes for access request list queries', async () => {
    await byId('v1_024_access_request_list_indexes').up(client);
    const sqls = client.query.mock.calls.map((c) => c[0]);

    expect(sqls.find((s) => s.includes('idx_access_requests_resident_created'))).toContain('created_by_resident_id, created_at DESC');
    expect(sqls.find((s) => s.includes('idx_access_requests_status_created'))).toContain('status, created_at DESC');
    expect(sqls.find((s) => s.includes('idx_access_requests_created'))).toContain('created_at DESC');
  });
});

describe('v1_025_access_request_escalated_status', () => {
  let client;
  beforeEach(() => { client = { query: jest.fn().mockResolvedValue({ rows: [] }) }; });

  test('replaces access_requests status CHECK with escalated lifecycle status', async () => {
    await byId('v1_025_access_request_escalated_status').up(client);
    const sqls = client.query.mock.calls.map((c) => c[0]);

    expect(sqls[0]).toContain('DROP CONSTRAINT IF EXISTS access_requests_status_check');
    expect(sqls[1]).toContain('ADD CONSTRAINT access_requests_status_check');
    expect(sqls[1]).toContain("'escalated'");
    expect(sqls[1]).toContain("'pending_approval','escalated','approved'");
  });
});

describe('v1_026_role_scope_memberships', () => {
  let client;
  beforeEach(() => { client = { query: jest.fn().mockResolvedValue({ rows: [] }) }; });

  test('creates role_scope_memberships with subject exclusivity and role enum', async () => {
    await byId('v1_026_role_scope_memberships').up(client);
    const sqls = client.query.mock.calls.map((c) => c[0]);
    const tbl = sqls.find((s) => s.includes('CREATE TABLE IF NOT EXISTS role_scope_memberships'));

    expect(tbl).toBeDefined();
    expect(tbl).toContain('CONSTRAINT role_scope_memberships_subject_exclusive');
    for (const role of [
      'resident', 'security', 'concierge', 'technician', 'contractor',
      'property_admin', 'management_company_admin', 'platform_admin',
    ]) {
      expect(tbl).toContain(`'${role}'`);
    }
  });

  test('enforces property scope without scope_id and non-property scopes with scope_id', async () => {
    await byId('v1_026_role_scope_memberships').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS role_scope_memberships'));

    expect(tbl).toContain('CONSTRAINT role_scope_memberships_scope_consistent');
    expect(tbl).toContain("(scope_level = 'property' AND scope_id IS NULL)");
    expect(tbl).toContain("(scope_level <> 'property' AND scope_id IS NOT NULL)");
  });

  test('indexes active memberships by property, subject, scope, and unique active assignment', async () => {
    await byId('v1_026_role_scope_memberships').up(client);
    const sqls = client.query.mock.calls.map((c) => c[0]);

    expect(sqls.find((s) => s.includes('idx_role_scope_memberships_property_active'))).toContain("WHERE status = 'active'");
    expect(sqls.find((s) => s.includes('idx_role_scope_memberships_scope'))).toContain('scope_level, scope_id');
    expect(sqls.find((s) => s.includes('uq_role_scope_memberships_resident_active'))).toContain('COALESCE(scope_id, property_id)');
    expect(sqls.find((s) => s.includes('uq_role_scope_memberships_staff_active'))).toContain("status = 'active'");
    expect(sqls.find((s) => s.includes('uq_role_scope_memberships_contractor_active'))).toContain('contractor_user_id');
  });
});

describe('v1_027_access_topology', () => {
  let client;
  beforeEach(() => { client = { query: jest.fn().mockResolvedValue({ rows: [] }) }; });

  test('creates access_zones with property scope, zone enum, and active name uniqueness', async () => {
    await byId('v1_027_access_topology').up(client);
    const sqls = client.query.mock.calls.map((c) => c[0]);
    const tbl = sqls.find((s) => s.includes('CREATE TABLE IF NOT EXISTS access_zones'));

    expect(tbl).toBeDefined();
    expect(tbl).toContain('CONSTRAINT access_zones_property_id_unique UNIQUE (property_id, id)');
    for (const zoneType of ['perimeter', 'checkpoint', 'parking', 'street', 'sector', 'service_area']) {
      expect(tbl).toContain(`'${zoneType}'`);
    }
    expect(sqls.find((s) => s.includes('idx_access_zones_property_active'))).toContain('property_id, is_active');
    expect(sqls.find((s) => s.includes('uq_access_zones_property_name_active'))).toContain('LOWER(name)');
  });

  test('creates access_points with same-property zone FK and point enum', async () => {
    await byId('v1_027_access_topology').up(client);
    const sqls = client.query.mock.calls.map((c) => c[0]);
    const tbl = sqls.find((s) => s.includes('CREATE TABLE IF NOT EXISTS access_points'));

    expect(tbl).toBeDefined();
    expect(tbl).toContain('CONSTRAINT access_points_zone_property_fk');
    expect(tbl).toContain('FOREIGN KEY (property_id, zone_id)');
    for (const pointType of ['gate', 'barrier', 'door', 'turnstile', 'wicket', 'intercom', 'checkpoint', 'service_gate']) {
      expect(tbl).toContain(`'${pointType}'`);
    }
    expect(sqls.find((s) => s.includes('idx_access_points_zone'))).toContain('property_id, zone_id, is_active');
    expect(sqls.find((s) => s.includes('idx_access_points_provider'))).toContain('provider_external_id');
  });

  test('adds NOT VALID topology FKs to access requests, passes, and visit logs', async () => {
    await byId('v1_027_access_topology').up(client);
    const sqls = client.query.mock.calls.map((c) => c[0]);

    for (const constraint of [
      'access_requests_target_zone_fk',
      'access_requests_target_point_fk',
      'passes_zone_fk',
      'passes_point_fk',
      'visit_logs_v2_access_point_fk',
    ]) {
      const sql = sqls.find((s) => s.includes(constraint));
      expect(sql).toBeDefined();
      expect(sql).toContain('NOT VALID');
      expect(sql).toContain('ON DELETE RESTRICT');
    }
  });
});

describe('v1_028_access_policies', () => {
  let client;
  beforeEach(() => { client = { query: jest.fn().mockResolvedValue({ rows: [] }) }; });

  test('creates access_policies with policy enums, priority, and same-property topology FKs', async () => {
    await byId('v1_028_access_policies').up(client);
    const sqls = client.query.mock.calls.map((c) => c[0]);
    const tbl = sqls.find((s) => s.includes('CREATE TABLE IF NOT EXISTS access_policies'));

    expect(tbl).toBeDefined();
    expect(tbl).toContain('subject_type        VARCHAR(30) NOT NULL');
    for (const value of ['resident', 'guest', 'staff', 'contractor', 'vehicle', 'courier']) {
      expect(tbl).toContain(`'${value}'`);
    }
    for (const value of ['qr', 'manual', 'plate', 'ble', 'card', 'face', 'pin']) {
      expect(tbl).toContain(`'${value}'`);
    }
    for (const value of ['allow', 'deny', 'needs_approval', 'needs_security_review', 'incident_required']) {
      expect(tbl).toContain(`'${value}'`);
    }
    expect(tbl).toContain('priority            INTEGER NOT NULL DEFAULT 100');
    expect(tbl).toContain('CONSTRAINT access_policies_zone_property_fk');
    expect(tbl).toContain('FOREIGN KEY (property_id, zone_id)');
    expect(tbl).toContain('CONSTRAINT access_policies_point_property_fk');
    expect(tbl).toContain('FOREIGN KEY (property_id, point_id)');
  });

  test('indexes active policies and links passes.policy_id to access_policies', async () => {
    await byId('v1_028_access_policies').up(client);
    const sqls = client.query.mock.calls.map((c) => c[0]);

    expect(sqls.find((s) => s.includes('idx_access_policies_property_active'))).toContain('subject_type, access_method, priority');
    expect(sqls.find((s) => s.includes('idx_access_policies_zone'))).toContain('WHERE zone_id IS NOT NULL');
    expect(sqls.find((s) => s.includes('idx_access_policies_point'))).toContain('WHERE point_id IS NOT NULL');
    expect(sqls.find((s) => s.includes('uq_access_policies_property_name_active'))).toContain('LOWER(name)');

    const fk = sqls.find((s) => s.includes('passes_policy_fk'));
    expect(fk).toBeDefined();
    expect(fk).toContain('REFERENCES access_policies(property_id, id)');
    expect(fk).toContain('NOT VALID');
  });

  test('extends access incident types for policy-driven deny and review events', async () => {
    await byId('v1_028_access_policies').up(client);
    const sqls = client.query.mock.calls.map((c) => c[0]);
    const constraint = sqls.find((s) => s.includes('policy_security_review_required'));

    expect(constraint).toBeDefined();
    expect(constraint).toContain('policy_denied');
    expect(constraint).toContain('policy_security_review_required');
  });
});

describe('v1_034_skud_adapter_framework', () => {
  let client;
  beforeEach(() => { client = { query: jest.fn().mockResolvedValue({ rows: [] }) }; });

  test('creates tenant-scoped SKUD provider configs with provider and health enums', async () => {
    await byId('v1_034_skud_adapter_framework').up(client);
    const sqls = client.query.mock.calls.map((c) => c[0]);
    const tbl = sqls.find((s) => s.includes('CREATE TABLE IF NOT EXISTS skud_provider_configs'));

    expect(tbl).toBeDefined();
    expect(tbl).toContain('CONSTRAINT skud_provider_configs_property_id_unique UNIQUE (property_id, id)');
    for (const provider of ['hikvision', 'bolid', 'sigur', 'parsec', 'generic']) {
      expect(tbl).toContain(`'${provider}'`);
    }
    for (const status of ['unknown', 'healthy', 'degraded', 'down']) {
      expect(tbl).toContain(`'${status}'`);
    }
    expect(sqls.find((s) => s.includes('idx_skud_provider_configs_property'))).toContain('property_id, status, provider');
    expect(sqls.find((s) => s.includes('uq_skud_provider_configs_property_name_active'))).toContain('status <>');
  });

  test('creates hardware devices mapped to provider configs and access points', async () => {
    await byId('v1_034_skud_adapter_framework').up(client);
    const sqls = client.query.mock.calls.map((c) => c[0]);
    const tbl = sqls.find((s) => s.includes('CREATE TABLE IF NOT EXISTS skud_hardware_devices'));

    expect(tbl).toBeDefined();
    expect(tbl).toContain('FOREIGN KEY (property_id, provider_config_id)');
    expect(tbl).toContain('REFERENCES skud_provider_configs(property_id, id)');
    expect(tbl).toContain('CONSTRAINT skud_hardware_devices_property_id_unique UNIQUE (property_id, id)');
    expect(tbl).toContain('FOREIGN KEY (property_id, access_point_id)');
    expect(tbl).toContain('REFERENCES access_points(property_id, id)');
    for (const deviceClass of ['barrier', 'gate', 'intercom', 'lpr', 'camera', 'reader']) {
      expect(tbl).toContain(`'${deviceClass}'`);
    }
    for (const fallbackRule of ['manual_guard', 'offline_queue', 'deny_until_restored']) {
      expect(tbl).toContain(`'${fallbackRule}'`);
    }
    expect(sqls.find((s) => s.includes('uq_skud_hardware_devices_external'))).toContain('external_device_id');
  });

  test('creates idempotent integration event log for inbound and outbound SKUD events', async () => {
    await byId('v1_034_skud_adapter_framework').up(client);
    const sqls = client.query.mock.calls.map((c) => c[0]);
    const tbl = sqls.find((s) => s.includes('CREATE TABLE IF NOT EXISTS skud_integration_events'));

    expect(tbl).toBeDefined();
    expect(tbl).toContain("CHECK (direction IN ('inbound','outbound'))");
    for (const status of ['pending', 'processing', 'succeeded', 'failed', 'retrying', 'dead_lettered']) {
      expect(tbl).toContain(`'${status}'`);
    }
    expect(tbl).toContain('payload                JSONB NOT NULL');
    expect(tbl).toContain('normalized_payload     JSONB');
    expect(sqls.find((s) => s.includes('uq_skud_integration_events_external'))).toContain('external_event_id');
    expect(sqls.find((s) => s.includes('idx_skud_integration_events_status'))).toContain('status, next_retry_at');
  });
});

describe('v1_035_video_evidence_baseline', () => {
  let client;
  beforeEach(() => { client = { query: jest.fn().mockResolvedValue({ rows: [] }) }; });

  test('creates video evidence references linked to incidents, events and cameras', async () => {
    await byId('v1_035_video_evidence_baseline').up(client);
    const sqls = client.query.mock.calls.map((c) => c[0]);
    const tbl = sqls.find((s) => s.includes('CREATE TABLE IF NOT EXISTS video_evidence_references'));

    expect(tbl).toBeDefined();
    expect(tbl).toContain('access_incident_id          UUID REFERENCES access_incidents(id)');
    expect(tbl).toContain('visit_log_id                UUID REFERENCES visit_logs_v2(id)');
    expect(tbl).toContain('skud_integration_event_id   UUID REFERENCES skud_integration_events(id)');
    expect(tbl).toContain('camera_device_id            UUID REFERENCES skud_hardware_devices(id)');
    for (const value of ['clip', 'snapshot', 'event_reference', 'camera_context', 'unavailable']) {
      expect(tbl).toContain(`'${value}'`);
    }
    expect(tbl).toContain('CONSTRAINT video_evidence_has_target');
    expect(tbl).toContain('CONSTRAINT video_evidence_has_reference');
  });

  test('locks video evidence out of biometric identity matching', async () => {
    await byId('v1_035_video_evidence_baseline').up(client);
    const tbl = client.query.mock.calls.map((c) => c[0])
      .find((s) => s.includes('CREATE TABLE IF NOT EXISTS video_evidence_references'));

    expect(tbl).toContain('biometric_identity_matching BOOLEAN NOT NULL DEFAULT FALSE');
    expect(tbl).toContain('CHECK (biometric_identity_matching = FALSE)');
  });

  test('adds lookup indexes for incident, visit, camera and provider event review', async () => {
    await byId('v1_035_video_evidence_baseline').up(client);
    const sqls = client.query.mock.calls.map((c) => c[0]);

    expect(sqls.find((s) => s.includes('idx_video_evidence_incident'))).toContain('access_incident_id');
    expect(sqls.find((s) => s.includes('idx_video_evidence_visit'))).toContain('visit_log_id');
    expect(sqls.find((s) => s.includes('idx_video_evidence_camera_time'))).toContain('camera_device_id');
    expect(sqls.find((s) => s.includes('uq_video_evidence_provider_event'))).toContain('video_provider_event_id');
  });
});

describe('v1_036_video_provider_configs', () => {
  let client;
  beforeEach(() => { client = { query: jest.fn().mockResolvedValue({ rows: [] }) }; });

  test('creates tenant-scoped video provider configs for common Russia VMS/NVR systems', async () => {
    await byId('v1_036_video_provider_configs').up(client);
    const sqls = client.query.mock.calls.map((c) => c[0]);
    const tbl = sqls.find((s) => s.includes('CREATE TABLE IF NOT EXISTS video_provider_configs'));

    expect(tbl).toBeDefined();
    expect(tbl).toContain('CONSTRAINT video_provider_configs_property_id_unique UNIQUE (property_id, id)');
    for (const provider of [
      'trassir',
      'macroscop',
      'hikvision_nvr',
      'dahua_nvr',
      'axxon_next',
      'devline_line',
      'generic_link',
    ]) {
      expect(tbl).toContain(`'${provider}'`);
    }
    for (const status of ['active', 'disabled', 'degraded']) {
      expect(tbl).toContain(`'${status}'`);
    }
    expect(sqls.find((s) => s.includes('idx_video_provider_configs_property'))).toContain('property_id, status, provider');
    expect(sqls.find((s) => s.includes('uq_video_provider_configs_property_name_active'))).toContain('status <>');
  });

  test('links cameras and evidence references to video provider configs', async () => {
    await byId('v1_036_video_provider_configs').up(client);
    const sqls = client.query.mock.calls.map((c) => c[0]);

    expect(sqls.find((s) => s.includes('ALTER TABLE skud_hardware_devices'))).toContain('video_provider_config_id UUID');
    expect(sqls.find((s) => s.includes('skud_hardware_devices_video_provider_property_fk'))).toContain('REFERENCES video_provider_configs(property_id, id)');
    expect(sqls.find((s) => s.includes('idx_skud_hardware_devices_video_provider'))).toContain('video_provider_config_id');
    expect(sqls.find((s) => s.includes('ALTER TABLE video_evidence_references'))).toContain('video_provider_config_id UUID');
    expect(sqls.find((s) => s.includes('video_evidence_video_provider_fk'))).toContain('REFERENCES video_provider_configs(id)');
    expect(sqls.find((s) => s.includes('idx_video_evidence_video_provider'))).toContain('created_at DESC');
    expect(sqls.find((s) => s.includes('uq_video_evidence_video_provider_event'))).toContain('video_provider_event_id');
  });
});

describe('v1_037_skud_russia_provider_wave', () => {
  let client;
  beforeEach(() => { client = { query: jest.fn().mockResolvedValue({ rows: [] }) }; });

  test('expands SKUD provider CHECK for common Russia deployments', async () => {
    await byId('v1_037_skud_russia_provider_wave').up(client);
    const sqls = client.query.mock.calls.map((c) => c[0]);

    expect(sqls[0]).toContain('DROP CONSTRAINT IF EXISTS skud_provider_configs_provider_check');
    const check = sqls.find((s) => s.includes('ADD CONSTRAINT skud_provider_configs_provider_check'));
    for (const provider of [
      'bolid',
      'generic',
      'hikvision',
      'ironlogic',
      'parsec',
      'perco',
      'rusguard',
      'sigur',
      'trassir_access',
    ]) {
      expect(check).toContain(`'${provider}'`);
    }
    expect(sqls.find((s) => s.includes('idx_skud_provider_configs_provider_health'))).toContain('provider, health_status');
  });
});

describe('v1_038_erp_exchange_baseline', () => {
  let client;
  beforeEach(() => { client = { query: jest.fn().mockResolvedValue({ rows: [] }) }; });

  test('creates tenant-scoped ERP provider configs for 1C and generic exchange', async () => {
    await byId('v1_038_erp_exchange_baseline').up(client);
    const sqls = client.query.mock.calls.map((c) => c[0]);
    const tbl = sqls.find((s) => s.includes('CREATE TABLE IF NOT EXISTS erp_provider_configs'));

    expect(tbl).toBeDefined();
    expect(tbl).toContain('CONSTRAINT erp_provider_configs_property_id_unique UNIQUE (property_id, id)');
    for (const provider of [
      'one_c',
      'one_c_zhkh',
      'housing_erp',
      'generic_csv',
      'generic_rest',
      'generic_webhook',
    ]) {
      expect(tbl).toContain(`'${provider}'`);
    }
    expect(tbl).toContain("CHECK (sync_mode IN ('import_only','export_only','hybrid','manual'))");
    expect(sqls.find((s) => s.includes('idx_erp_provider_configs_property'))).toContain('property_id, status, provider');
    expect(sqls.find((s) => s.includes('uq_erp_provider_configs_property_name_active'))).toContain('status <>');
  });

  test('creates external mapping table with explicit conflict visibility', async () => {
    await byId('v1_038_erp_exchange_baseline').up(client);
    const sqls = client.query.mock.calls.map((c) => c[0]);
    const tbl = sqls.find((s) => s.includes('CREATE TABLE IF NOT EXISTS erp_external_mappings'));

    expect(tbl).toBeDefined();
    expect(tbl).toContain('REFERENCES erp_provider_configs(property_id, id)');
    expect(tbl).toContain("conflict_status        VARCHAR(20) NOT NULL DEFAULT 'unmapped'");
    expect(tbl).toContain("CHECK (conflict_status IN ('mapped','unmapped','conflict','ignored'))");
    expect(sqls.find((s) => s.includes('uq_erp_external_mappings_external')))
      .toContain('external_entity_type, external_id');
    expect(sqls.find((s) => s.includes('idx_erp_external_mappings_conflicts')))
      .toContain('conflict_status, updated_at DESC');
  });

  test('creates sync jobs and row-level validation records', async () => {
    await byId('v1_038_erp_exchange_baseline').up(client);
    const sqls = client.query.mock.calls.map((c) => c[0]);
    const jobs = sqls.find((s) => s.includes('CREATE TABLE IF NOT EXISTS erp_sync_jobs'));
    const records = sqls.find((s) => s.includes('CREATE TABLE IF NOT EXISTS erp_sync_records'));

    expect(jobs).toContain("CHECK (direction IN ('import','export'))");
    expect(jobs).toContain('access_events_summary');
    expect(jobs).toContain("CHECK (mode IN ('dry_run','apply'))");
    expect(records).toContain('validation_errors      JSONB NOT NULL DEFAULT');
    expect(records).toContain('CONSTRAINT erp_sync_records_validation_errors_array');
    expect(sqls.find((s) => s.includes('idx_erp_sync_records_job_status'))).toContain('sync_job_id, status, row_index');
  });
});

describe('v1_039_analytics_aggregation_snapshots', () => {
  let client;
  beforeEach(() => { client = { query: jest.fn().mockResolvedValue({ rows: [] }) }; });

  test('creates property-scoped KPI snapshot table', async () => {
    await byId('v1_039_analytics_aggregation_snapshots').up(client);
    const sqls = client.query.mock.calls.map((c) => c[0]);
    const tbl = sqls.find((s) => s.includes('CREATE TABLE IF NOT EXISTS analytics_kpi_snapshots'));

    expect(tbl).toBeDefined();
    expect(tbl).toContain("CHECK (metric_group IN ('operations_dashboard'))");
    expect(tbl).toContain("CHECK (period IN ('24h','7d','30d'))");
    expect(tbl).toContain("CHECK (generated_by IN ('job','manual','system'))");
    expect(tbl).toContain('CONSTRAINT analytics_kpi_snapshots_window_check');
    expect(tbl).toContain('CONSTRAINT analytics_kpi_snapshots_payload_object');
    expect(tbl).toContain('CONSTRAINT analytics_kpi_snapshots_flat_rows_array');
  });

  test('adds latest and window lookup indexes', async () => {
    await byId('v1_039_analytics_aggregation_snapshots').up(client);
    const sqls = client.query.mock.calls.map((c) => c[0]);

    expect(sqls.find((s) => s.includes('idx_analytics_kpi_snapshots_latest')))
      .toContain('property_id, metric_group, period, generated_at DESC');
    expect(sqls.find((s) => s.includes('idx_analytics_kpi_snapshots_window')))
      .toContain('property_id, period, window_ended_at DESC');
  });
});

describe('v1_040_membership_review_lifecycle', () => {
  let client;
  beforeEach(() => { client = { query: jest.fn().mockResolvedValue({ rows: [] }) }; });

  test('extends role_scope_memberships for external platform/company subjects', async () => {
    await byId('v1_040_membership_review_lifecycle').up(client);
    const sqls = client.query.mock.calls.map((c) => c[0]);

    expect(sqls.find((s) => s.includes('ALTER TABLE role_scope_memberships') && s.includes('external_subject_type')))
      .toContain('management_company_id UUID');
    const scopeCheck = sqls.find((s) => s.includes('ADD CONSTRAINT role_scope_memberships_scope_level_check'));
    expect(scopeCheck)
      .toContain("'platform'");
    expect(scopeCheck)
      .toContain("'management_company'");
    expect(sqls.find((s) => s.includes('idx_role_scope_memberships_external')))
      .toContain('external_subject_type, external_subject_id, status');
  });

  test('creates sensitive action review attestation table', async () => {
    await byId('v1_040_membership_review_lifecycle').up(client);
    const sqls = client.query.mock.calls.map((c) => c[0]);
    const tbl = sqls.find((s) => s.includes('CREATE TABLE IF NOT EXISTS sensitive_action_reviews'));

    expect(tbl).toBeDefined();
    expect(tbl).toContain('audit_log_id            UUID NOT NULL REFERENCES property_audit_log(id)');
    for (const status of ['pending', 'approved', 'needs_followup', 'dismissed']) {
      expect(tbl).toContain(`'${status}'`);
    }
    expect(tbl).toContain('classification_snapshot JSONB NOT NULL DEFAULT');
    expect(sqls.find((s) => s.includes('idx_sensitive_action_reviews_property_status')))
      .toContain('property_id, review_status');
  });

  test('creates resident lifecycle, consent history and offline replay ledgers', async () => {
    await byId('v1_040_membership_review_lifecycle').up(client);
    const sqls = client.query.mock.calls.map((c) => c[0]);

    expect(sqls.find((s) => s.includes('CREATE TABLE IF NOT EXISTS resident_lifecycle_events')))
      .toContain('consent_given');
    expect(sqls.find((s) => s.includes('CREATE TABLE IF NOT EXISTS resident_consent_history')))
      .toContain("CHECK (decision IN ('accepted','revoked'))");
    expect(sqls.find((s) => s.includes('CREATE TABLE IF NOT EXISTS security_offline_replay_events')))
      .toContain('client_event_id        TEXT NOT NULL');
    expect(sqls.find((s) => s.includes('ALTER TABLE visit_logs_v2')))
      .toContain('offline_replay_event_id UUID');
  });
});

describe('v1_041_sensitive_review_ops', () => {
  let client;
  beforeEach(() => { client = { query: jest.fn().mockResolvedValue({ rows: [] }) }; });

  test('adds assignment, due date, priority and escalation columns', async () => {
    await byId('v1_041_sensitive_review_ops').up(client);
    const sqls = client.query.mock.calls.map((c) => c[0]);

    const alter = sqls.find((s) => s.includes('ALTER TABLE sensitive_action_reviews')
      && s.includes('assigned_reviewer_staff_id'));
    expect(alter).toBeDefined();
    expect(alter).toContain('assigned_by_staff_id');
    expect(alter).toContain('due_at');
    expect(alter).toContain("priority                   VARCHAR(20) NOT NULL DEFAULT 'normal'");
    expect(alter).toContain("escalation_status          VARCHAR(30) NOT NULL DEFAULT 'none'");
  });

  test('constrains review priority/escalation and indexes review queues', async () => {
    await byId('v1_041_sensitive_review_ops').up(client);
    const sqls = client.query.mock.calls.map((c) => c[0]);

    const priorityCheck = sqls.find((s) => s.includes('sensitive_action_reviews_priority_check')
      && s.includes('CHECK'));
    expect(priorityCheck).toContain("'low','normal','high','urgent'");

    const escalationCheck = sqls.find((s) => s.includes('sensitive_action_reviews_escalation_status_check')
      && s.includes('CHECK'));
    expect(escalationCheck).toContain("'none','overdue','escalated'");

    expect(sqls.find((s) => s.includes('idx_sensitive_action_reviews_assignment')))
      .toContain('assigned_reviewer_staff_id');
    expect(sqls.find((s) => s.includes('idx_sensitive_action_reviews_due')))
      .toContain("WHERE review_status = 'pending'");
    expect(sqls.find((s) => s.includes('idx_sensitive_action_reviews_priority')))
      .toContain('priority');
    expect(sqls.find((s) => s.includes('idx_property_audit_log_sensitive_review_window')))
      .toContain('property_id, action, created_at DESC');
  });
});

describe('v1_042_resident_offboarding_cascade', () => {
  let client;
  beforeEach(() => { client = { query: jest.fn().mockResolvedValue({ rows: [] }) }; });

  test('creates resident unit links with active membership indexes', async () => {
    await byId('v1_042_resident_offboarding_cascade').up(client);
    const sqls = client.query.mock.calls.map((c) => c[0]);
    const tbl = sqls.find((s) => s.includes('CREATE TABLE IF NOT EXISTS resident_unit_links'));

    expect(tbl).toBeDefined();
    expect(tbl).toContain("relationship_type   VARCHAR(30) NOT NULL DEFAULT 'resident'");
    expect(tbl).toContain("'owner','tenant','resident','family_member','representative'");
    expect(tbl).toContain('CONSTRAINT resident_unit_links_window');
    expect(sqls.find((s) => s.includes('INSERT INTO resident_unit_links'))).toContain('FROM residents r');
    expect(sqls.find((s) => s.includes('uq_resident_unit_links_active'))).toContain('WHERE is_active = true');
    expect(sqls.find((s) => s.includes('idx_resident_unit_links_unit'))).toContain('property_id, unit_id, is_active');
  });

  test('adds vehicle offboarding review markers', async () => {
    await byId('v1_042_resident_offboarding_cascade').up(client);
    const sqls = client.query.mock.calls.map((c) => c[0]);
    const alter = sqls.find((s) => s.includes('ALTER TABLE vehicles')
      && s.includes('review_required'));

    expect(alter).toContain('review_required    BOOLEAN NOT NULL DEFAULT false');
    expect(alter).toContain('offboarded_at      TIMESTAMPTZ');
    expect(alter).toContain('offboarding_reason TEXT');
    expect(sqls.find((s) => s.includes('idx_vehicles_resident_review')))
      .toContain('owner_resident_id, review_required');
  });
});

describe('v1_043_emergency_dispatch_mode', () => {
  let client;
  beforeEach(() => { client = { query: jest.fn().mockResolvedValue({ rows: [] }) }; });

  test('creates emergency profiles with severity, dispatch status and notification status', async () => {
    await byId('v1_043_emergency_dispatch_mode').up(client);
    const sqls = client.query.mock.calls.map((c) => c[0]);
    const tbl = sqls.find((s) => s.includes('CREATE TABLE IF NOT EXISTS emergency_request_profiles'));

    expect(tbl).toBeDefined();
    expect(tbl).toContain('request_id            TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE');
    expect(tbl).toContain("dispatch_status       VARCHAR(30) NOT NULL DEFAULT 'new'");
    expect(tbl).toContain("notification_status   VARCHAR(30) NOT NULL DEFAULT 'pending'");
    expect(tbl).toContain('CONSTRAINT emergency_request_profiles_request_unique UNIQUE (request_id)');
    expect(sqls.find((s) => s.includes('emergency_request_profiles_type_check')))
      .toContain('fire_smoke');
    expect(sqls.find((s) => s.includes('emergency_request_profiles_severity_check')))
      .toContain("'P0','P1','P2'");
  });

  test('backfills existing emergency requests and indexes dispatch queues', async () => {
    await byId('v1_043_emergency_dispatch_mode').up(client);
    const sqls = client.query.mock.calls.map((c) => c[0]);

    expect(sqls.find((s) => s.includes('INSERT INTO emergency_request_profiles')))
      .toContain("r.priority = 'emergency' OR r.sla_profile = 'emergency'");
    expect(sqls.find((s) => s.includes('idx_emergency_profiles_queue')))
      .toContain("dispatch_status NOT IN ('resolved','cancelled')");
    expect(sqls.find((s) => s.includes('idx_emergency_profiles_property')))
      .toContain('property_id, dispatch_status, severity');
  });
});

describe('v1_029_service_request_core', () => {
  let client;
  beforeEach(() => { client = { query: jest.fn().mockResolvedValue({ rows: [] }) }; });

  test('creates configurable service request categories with territory and emergency profile fields', async () => {
    await byId('v1_029_service_request_core').up(client);
    const sqls = client.query.mock.calls.map((c) => c[0]);
    const tbl = sqls.find((s) => s.includes('CREATE TABLE IF NOT EXISTS service_request_categories'));

    expect(tbl).toBeDefined();
    for (const value of ['service', 'territory', 'emergency', 'security', 'contractor']) {
      expect(tbl).toContain(`'${value}'`);
    }
    for (const value of ['unit', 'home', 'access_zone', 'access_point', 'common_territory', 'road']) {
      expect(tbl).toContain(`'${value}'`);
    }
    expect(tbl).toContain('first_response_minutes');
    expect(tbl).toContain('resolution_minutes');
    expect(tbl).toContain('service_request_categories_emergency_profile');
  });

  test('extends legacy requests with v1 target, priority and SLA columns plus indexes', async () => {
    await byId('v1_029_service_request_core').up(client);
    const sqls = client.query.mock.calls.map((c) => c[0]);
    const alter = sqls.find((s) => s.includes('ALTER TABLE requests') && s.includes('request_category_id'));

    expect(alter).toContain('target_type TEXT');
    expect(alter).toContain('target_id UUID');
    expect(alter).toContain("priority TEXT NOT NULL DEFAULT 'normal'");
    expect(alter).toContain("sla_profile TEXT NOT NULL DEFAULT 'standard'");
    expect(alter).toContain('first_response_due_at TIMESTAMPTZ');
    expect(alter).toContain('resolution_due_at TIMESTAMPTZ');
    expect(alter).toContain("emergency_metadata JSONB NOT NULL DEFAULT '{}'::jsonb");

    expect(sqls.find((s) => s.includes('requests_service_category_fk'))).toContain('NOT VALID');
    expect(sqls.find((s) => s.includes('idx_requests_target'))).toContain('WHERE target_type IS NOT NULL');
    expect(sqls.find((s) => s.includes('idx_requests_priority_status'))).toContain('priority, status, created_at DESC');
  });
});

describe('v1_030_request_attachments_updates', () => {
  let client;
  beforeEach(() => { client = { query: jest.fn().mockResolvedValue({ rows: [] }) }; });

  test('creates request attachments with safe local upload URL and visibility split', async () => {
    await byId('v1_030_request_attachments_updates').up(client);
    const sqls = client.query.mock.calls.map((c) => c[0]);
    const tbl = sqls.find((s) => s.includes('CREATE TABLE IF NOT EXISTS request_attachments'));

    expect(tbl).toBeDefined();
    expect(tbl).toContain('request_id        TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE');
    expect(tbl).toContain("CHECK (file_kind IN ('photo','document','other'))");
    expect(tbl).toContain("CHECK (visibility IN ('resident','internal'))");
    expect(tbl).toContain("CHECK (file_url LIKE '/uploads/%')");
    expect(sqls.find((s) => s.includes('idx_request_attachments_request_visibility')))
      .toContain('request_id, visibility, created_at DESC');
  });

  test('creates request updates with resident/internal visibility and optional attachments', async () => {
    await byId('v1_030_request_attachments_updates').up(client);
    const sqls = client.query.mock.calls.map((c) => c[0]);
    const tbl = sqls.find((s) => s.includes('CREATE TABLE IF NOT EXISTS request_updates'));

    expect(tbl).toBeDefined();
    expect(tbl).toContain('request_id        TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE');
    expect(tbl).toContain('body              TEXT NOT NULL');
    expect(tbl).toContain("CHECK (visibility IN ('resident','internal'))");
    expect(tbl).toContain("attachment_ids    UUID[] NOT NULL DEFAULT '{}'::uuid[]");
    expect(tbl).toContain('request_updates_body_not_blank');
    expect(sqls.find((s) => s.includes('idx_request_updates_request_visibility')))
      .toContain('request_id, visibility, created_at DESC');
  });
});

describe('v1_031_request_assignment_sla', () => {
  let client;
  beforeEach(() => { client = { query: jest.fn().mockResolvedValue({ rows: [] }) }; });

  test('extends requests with assignee, timestamps and SLA state fields', async () => {
    await byId('v1_031_request_assignment_sla').up(client);
    const sqls = client.query.mock.calls.map((c) => c[0]);
    const alter = sqls.find((s) => s.includes('ALTER TABLE requests') && s.includes('assigned_to_uid'));

    expect(alter).toContain('assigned_to_uid TEXT');
    expect(alter).toContain('assigned_at TIMESTAMPTZ');
    expect(alter).toContain('first_response_at TIMESTAMPTZ');
    expect(alter).toContain('resolved_at TIMESTAMPTZ');
    expect(alter).toContain("sla_state VARCHAR(30) NOT NULL DEFAULT 'on_track'");
    expect(alter).toContain('escalation_level INTEGER NOT NULL DEFAULT 0');
    expect(sqls.find((s) => s.includes('requests_assigned_to_role_check'))).toContain('technician');
    expect(sqls.find((s) => s.includes('requests_sla_state_check'))).toContain('emergency_escalated');
  });

  test('creates request_sla_events with idempotent event key and severity indexes', async () => {
    await byId('v1_031_request_assignment_sla').up(client);
    const sqls = client.query.mock.calls.map((c) => c[0]);
    const tbl = sqls.find((s) => s.includes('CREATE TABLE IF NOT EXISTS request_sla_events'));

    expect(tbl).toBeDefined();
    expect(tbl).toContain('request_id    TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE');
    expect(tbl).toContain("CHECK (event_type IN (");
    expect(tbl).toContain('first_response_overdue');
    expect(tbl).toContain('resolution_overdue');
    expect(tbl).toContain("CHECK (severity IN ('warning','breach','emergency'))");
    expect(tbl).toContain('CONSTRAINT request_sla_events_key_unique UNIQUE (request_id, event_key)');
    expect(sqls.find((s) => s.includes('idx_request_sla_events_type')))
      .toContain('event_type, severity, detected_at DESC');
  });
});

describe('v1_032_technician_workflow', () => {
  let client;
  beforeEach(() => { client = { query: jest.fn().mockResolvedValue({ rows: [] }) }; });

  test('extends requests with technician execution output fields', async () => {
    await byId('v1_032_technician_workflow').up(client);
    const sqls = client.query.mock.calls.map((c) => c[0]);
    const alter = sqls.find((s) => s.includes('ALTER TABLE requests') && s.includes('started_at'));

    expect(alter).toContain('started_at TIMESTAMPTZ');
    expect(alter).toContain('resolution_note TEXT');
    expect(alter).toContain('requires_follow_up BOOLEAN NOT NULL DEFAULT false');
    expect(sqls.find((s) => s.includes('idx_requests_technician_queue')))
      .toContain('assigned_to_role, assigned_to_uid, status, created_at DESC');
  });

  test('creates technician KPI event stream with lifecycle enum and indexes', async () => {
    await byId('v1_032_technician_workflow').up(client);
    const sqls = client.query.mock.calls.map((c) => c[0]);
    const tbl = sqls.find((s) => s.includes('CREATE TABLE IF NOT EXISTS request_technician_events'));

    expect(tbl).toBeDefined();
    expect(tbl).toContain('request_id      TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE');
    expect(tbl).toContain('technician_uid  TEXT REFERENCES users(uid) ON DELETE SET NULL');
    expect(tbl).toContain('actor_uid       TEXT NOT NULL REFERENCES users(uid) ON DELETE RESTRICT');
    expect(tbl).toContain('claimed');
    expect(tbl).toContain('waiting_resident');
    expect(tbl).toContain('waiting_parts');
    expect(tbl).toContain('resolved');
    expect(sqls.find((s) => s.includes('idx_request_technician_events_technician')))
      .toContain('technician_uid, event_type, created_at DESC');
  });
});

describe('v1_033_contractor_workflow', () => {
  let client;
  beforeEach(() => { client = { query: jest.fn().mockResolvedValue({ rows: [] }) }; });

  test('extends requests with contractor assignment binding fields', async () => {
    await byId('v1_033_contractor_workflow').up(client);
    const sqls = client.query.mock.calls.map((c) => c[0]);
    const alter = sqls.find((s) => s.includes('ALTER TABLE requests') && s.includes('assigned_contractor_user_id'));

    expect(alter).toContain('assigned_contractor_user_id UUID');
    expect(alter).toContain('REFERENCES contractor_users(id) ON DELETE SET NULL');
    expect(alter).toContain('assigned_contractor_company_id UUID');
    expect(alter).toContain('REFERENCES contractor_companies(id) ON DELETE SET NULL');
    expect(sqls.find((s) => s.includes('idx_requests_contractor_queue')))
      .toContain('assigned_to_role');
    expect(sqls.find((s) => s.includes('idx_requests_contractor_queue')))
      .toContain('assigned_contractor_user_id');
  });

  test('creates contractor KPI event stream with assignment and completion enum', async () => {
    await byId('v1_033_contractor_workflow').up(client);
    const sqls = client.query.mock.calls.map((c) => c[0]);
    const tbl = sqls.find((s) => s.includes('CREATE TABLE IF NOT EXISTS request_contractor_events'));

    expect(tbl).toBeDefined();
    expect(tbl).toContain('request_id                     TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE');
    expect(tbl).toContain('contractor_user_id             UUID REFERENCES contractor_users(id) ON DELETE SET NULL');
    expect(tbl).toContain('contractor_company_id          UUID REFERENCES contractor_companies(id) ON DELETE SET NULL');
    expect(tbl).toContain('contractor_uid                 TEXT REFERENCES users(uid) ON DELETE SET NULL');
    expect(tbl).toContain('assigned');
    expect(tbl).toContain('started');
    expect(tbl).toContain('waiting_parts');
    expect(tbl).toContain('resolved');
    expect(sqls.find((s) => s.includes('idx_request_contractor_events_contractor')))
      .toContain('contractor_user_id, event_type, created_at DESC');
    expect(sqls.find((s) => s.includes('idx_request_contractor_events_company')))
      .toContain('contractor_company_id, event_type, created_at DESC');
  });
});
