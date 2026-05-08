'use strict';

jest.mock('../db', () => ({
  query: jest.fn(),
  pool: { connect: jest.fn() },
}));
jest.mock('../logger', () => require('../__mocks__/logger'));

const db = require('../db');
const { verifyPass } = require('../v1/services/verifyPass');

const UUID_PROPERTY = '11111111-1111-4111-8111-111111111111';
const UUID_PASS = '22222222-2222-4222-8222-222222222222';
const UUID_VISIT_LOG = '33333333-3333-4333-8333-333333333333';
const UUID_INCIDENT = '44444444-4444-4444-8444-444444444444';
const UUID_STAFF = '55555555-5555-4555-8555-555555555555';
const UUID_VEHICLE = '66666666-6666-4666-8666-666666666666';
const UUID_POINT = '77777777-7777-4777-8777-777777777777';

const NOW = '2026-05-05T10:30:00.000Z';

function makePass(overrides = {}) {
  return {
    id: UUID_PASS,
    property_id: UUID_PROPERTY,
    pass_type: 'guest',
    subject_type: 'guest',
    status: 'active',
    valid_from: '2026-05-05T10:00:00.000Z',
    valid_until: '2026-05-05T12:00:00.000Z',
    subject_resident_id: null,
    subject_vehicle_id: null,
    access_request_id: null,
    visitor_name_snapshot: 'Guest',
    ...overrides,
  };
}

function makeTxClient(handler) {
  return {
    query: jest.fn(handler),
    release: jest.fn(),
  };
}

function installTxClient({ incident = true } = {}) {
  const txClient = makeTxClient((sql) => {
    if (sql === 'BEGIN' || sql === 'COMMIT') return Promise.resolve({ rows: [] });
    if (sql.includes('INSERT INTO visit_logs_v2')) return Promise.resolve({ rows: [{ id: UUID_VISIT_LOG }] });
    if (sql.includes('INSERT INTO access_incidents')) {
      return Promise.resolve({ rows: incident ? [{ id: UUID_INCIDENT }] : [] });
    }
    if (sql.includes('UPDATE passes')) return Promise.resolve({ rows: [] });
    if (sql.includes('INSERT INTO property_audit_log')) return Promise.resolve({ rows: [] });
    throw new Error(`unexpected SQL: ${sql}`);
  });
  db.pool.connect.mockResolvedValue(txClient);
  return txClient;
}

beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockReset();
  db.pool.connect.mockReset();
});

describe('verifyPass orchestration — Phase 1.2 QR flow', () => {
  test('valid QR allows entry, creates visit log, and marks one-shot pass used', async () => {
    const txClient = installTxClient();
    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM qr_passes_v2')) return Promise.resolve({ rows: [makePass()] });
      if (sql.includes('FROM visit_logs_v2') && sql.includes('event_type =')) return Promise.resolve({ rows: [] });
      if (sql.includes('FROM access_policies')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const result = await verifyPass({
      property_id: UUID_PROPERTY,
      mode: 'qr',
      token: 'valid-qr-token-123',
      access_point_id: UUID_POINT,
      performed_by_staff_id: UUID_STAFF,
      occurred_at: NOW,
    });

    expect(result.verdict.allowed).toBe(true);
    expect(result.visit_log_id).toBe(UUID_VISIT_LOG);
    expect(result.pass_id).toBe(UUID_PASS);

    const visitCall = txClient.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO visit_logs_v2'));
    const passUpdateCall = txClient.query.mock.calls.find(([sql]) => sql.includes('UPDATE passes'));
    const auditCall = txClient.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO property_audit_log'));
    expect(visitCall[1]).toEqual([
      UUID_PROPERTY, UUID_PASS, UUID_POINT, 'entry_allowed', 'guard_console',
      'Guest', null, UUID_STAFF, null, NOW,
    ]);
    expect(passUpdateCall[0]).toContain("status = 'used'");
    expect(passUpdateCall[1]).toEqual([UUID_PASS]);
    expect(auditCall[0]).toContain('property_id');
    expect(auditCall[0]).toContain('entity_id');
    expect(auditCall[1][0]).toBe(UUID_PROPERTY);
    expect(auditCall[1][1]).toBe(UUID_STAFF);
    expect(auditCall[1][2]).toBe('visit.entry_allowed');
  });

  test('valid QR can be denied by deterministic access policy with audit trace', async () => {
    const txClient = installTxClient();
    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM qr_passes_v2')) return Promise.resolve({ rows: [makePass()] });
      if (sql.includes('COUNT(*)::int AS n')) return Promise.resolve({ rows: [{ n: 0 }] });
      if (sql.includes('FROM visit_logs_v2') && sql.includes('event_type =')) return Promise.resolve({ rows: [] });
      if (sql.includes('FROM access_policies')) {
        return Promise.resolve({
          rows: [{
            id: '88888888-8888-4888-8888-888888888888',
            property_id: UUID_PROPERTY,
            name: 'Guest denied at night',
            subject_type: 'guest',
            subject_role: null,
            zone_id: null,
            point_id: null,
            access_method: 'qr',
            approval_mode: 'auto',
            effect: 'deny',
            priority: 10,
            schedule_json: null,
            duration_minutes: null,
            is_recurring: false,
            is_active: true,
            created_by: null,
            metadata: {},
            created_at: '2026-05-05T08:00:00.000Z',
            updated_at: '2026-05-05T08:00:00.000Z',
          }],
        });
      }
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const result = await verifyPass({
      property_id: UUID_PROPERTY,
      mode: 'qr',
      token: 'valid-qr-token-123',
      performed_by_staff_id: UUID_STAFF,
      occurred_at: NOW,
    });

    expect(result.verdict.allowed).toBe(false);
    expect(result.verdict.reason).toBe('policy_denied');
    expect(result.verdict.policy_decision.matched_policy_name).toBe('Guest denied at night');
    expect(result.incident_id).toBe(UUID_INCIDENT);
    expect(txClient.query.mock.calls.some(([sql]) => sql.includes('UPDATE passes'))).toBe(false);

    const auditCall = txClient.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO property_audit_log'));
    const changes = JSON.parse(auditCall[1][4]);
    expect(changes.policy_decision.reason).toBe('policy_denied');
    expect(changes.policy_decision.trace[0]).toMatchObject({ result: 'matched' });
  });

  test('invalid QR denies, creates visit log and incident', async () => {
    const txClient = installTxClient();
    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM qr_passes_v2')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const result = await verifyPass({
      property_id: UUID_PROPERTY,
      mode: 'qr',
      token: 'missing-qr-token-123',
      performed_by_staff_id: UUID_STAFF,
      occurred_at: NOW,
    });

    expect(result.verdict.allowed).toBe(false);
    expect(result.verdict.reason).toBe('invalid_qr');
    expect(result.incident_id).toBe(UUID_INCIDENT);

    const visitCall = txClient.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO visit_logs_v2'));
    const incidentCall = txClient.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO access_incidents'));
    expect(visitCall[1][1]).toBeNull();
    expect(visitCall[1][3]).toBe('entry_denied');
    expect(incidentCall[1]).toEqual([
      UUID_PROPERTY, null, UUID_VISIT_LOG, null,
      'invalid_qr', 'medium', 'invalid qr',
    ]);
  });

  test.each([
    ['expired pass', makePass({ status: 'expired' }), 'expired', 'expired_pass_attempt', 'low'],
    ['revoked pass', makePass({ status: 'revoked' }), 'pass_revoked', 'blacklist_hit', 'high'],
    ['blocked pass', makePass({ status: 'blocked' }), 'pass_blocked', 'blacklist_hit', 'high'],
  ])('%s denies and creates incident', async (_name, pass, reason, incidentType, severity) => {
    const txClient = installTxClient();
    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM qr_passes_v2')) return Promise.resolve({ rows: [pass] });
      if (sql.includes('COUNT(*)::int AS n')) return Promise.resolve({ rows: [{ n: 0 }] });
      if (sql.includes('FROM visit_logs_v2') && sql.includes('event_type =')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const result = await verifyPass({
      property_id: UUID_PROPERTY,
      mode: 'qr',
      token: 'deny-qr-token-123',
      performed_by_staff_id: UUID_STAFF,
      occurred_at: NOW,
    });

    expect(result.verdict.allowed).toBe(false);
    expect(result.verdict.reason).toBe(reason);
    expect(result.incident_id).toBe(UUID_INCIDENT);

    const incidentCall = txClient.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO access_incidents'));
    expect(incidentCall[1][4]).toBe(incidentType);
    expect(incidentCall[1][5]).toBe(severity);
    expect(txClient.query.mock.calls.some(([sql]) => sql.includes('UPDATE passes'))).toBe(false);
  });

  test('repeated QR attempt within guard window returns existing allowed visit log without new writes', async () => {
    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM qr_passes_v2')) return Promise.resolve({ rows: [makePass()] });
      if (sql.includes('FROM visit_logs_v2') && sql.includes('event_type =')) {
        return Promise.resolve({ rows: [{ id: UUID_VISIT_LOG, event_type: 'entry_allowed' }] });
      }
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const result = await verifyPass({
      property_id: UUID_PROPERTY,
      mode: 'qr',
      token: 'valid-qr-token-123',
      performed_by_staff_id: UUID_STAFF,
      occurred_at: NOW,
    });

    expect(result.verdict.allowed).toBe(true);
    expect(result.verdict.reason).toBe('idempotent_replay');
    expect(result.visit_log_id).toBe(UUID_VISIT_LOG);
    expect(db.pool.connect).not.toHaveBeenCalled();
  });

  test('vehicle QR carries plate into visit log', async () => {
    const txClient = installTxClient();
    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM qr_passes_v2')) {
        return Promise.resolve({ rows: [makePass({
          pass_type: 'vehicle',
          subject_type: 'vehicle',
          subject_vehicle_id: UUID_VEHICLE,
        })] });
      }
      if (sql.includes('FROM vehicles WHERE id')) {
        return Promise.resolve({ rows: [{
          id: UUID_VEHICLE,
          plate_number: 'A001AA77',
          is_whitelisted: false,
          is_blacklisted: false,
        }] });
      }
      if (sql.includes('FROM visit_logs_v2') && sql.includes('event_type =')) return Promise.resolve({ rows: [] });
      if (sql.includes('FROM access_policies')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const result = await verifyPass({
      property_id: UUID_PROPERTY,
      mode: 'qr',
      token: 'vehicle-qr-token-123',
      performed_by_staff_id: UUID_STAFF,
      occurred_at: NOW,
    });

    expect(result.verdict.allowed).toBe(true);
    const visitCall = txClient.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO visit_logs_v2'));
    expect(visitCall[1][5]).toBe('Plate A001AA77');
  });
});

describe('verifyPass orchestration — Phase 1.3 plate flow', () => {
  function makeVehicle(overrides = {}) {
    return {
      id: UUID_VEHICLE,
      plate_number: 'A001AA77',
      is_whitelisted: false,
      is_blacklisted: false,
      ...overrides,
    };
  }

  function mockPlateQueries({ vehicle = makeVehicle(), pass = null, repeatCount = 0 } = {}) {
    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM vehicles') && sql.includes('plate_number')) {
        return Promise.resolve({ rows: vehicle ? [vehicle] : [] });
      }
      if (sql.includes('FROM passes p')) return Promise.resolve({ rows: pass ? [pass] : [] });
      if (sql.includes('FROM access_policies')) return Promise.resolve({ rows: [] });
      if (sql.includes('COUNT(*)::int AS n')) return Promise.resolve({ rows: [{ n: repeatCount }] });
      throw new Error(`unexpected SQL: ${sql}`);
    });
  }

  test('known allowed plate creates allowed visit log', async () => {
    const txClient = installTxClient();
    mockPlateQueries({
      pass: makePass({
        pass_type: 'vehicle',
        subject_type: 'vehicle',
        subject_vehicle_id: UUID_VEHICLE,
      }),
    });

    const result = await verifyPass({
      property_id: UUID_PROPERTY,
      mode: 'plate',
      plate: 'A001AA77',
      performed_by_staff_id: UUID_STAFF,
      occurred_at: NOW,
    });

    expect(result.verdict.allowed).toBe(true);
    expect(result.pass_id).toBe(UUID_PASS);

    const visitCall = txClient.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO visit_logs_v2'));
    expect(visitCall[1]).toEqual([
      UUID_PROPERTY, UUID_PASS, null, 'entry_allowed', 'guard_console',
      'Plate A001AA77', 'A001AA77', UUID_STAFF, null, NOW,
    ]);
    expect(txClient.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO access_incidents'))).toBe(false);
  });

  test('unknown plate denies and creates incident', async () => {
    const txClient = installTxClient();
    mockPlateQueries({ vehicle: null });

    const result = await verifyPass({
      property_id: UUID_PROPERTY,
      mode: 'plate',
      plate: 'B002BB77',
      performed_by_staff_id: UUID_STAFF,
      occurred_at: NOW,
    });

    expect(result.verdict.allowed).toBe(false);
    expect(result.verdict.reason).toBe('unauthorized_vehicle');
    expect(result.incident_id).toBe(UUID_INCIDENT);

    const visitCall = txClient.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO visit_logs_v2'));
    const incidentCall = txClient.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO access_incidents'));
    expect(visitCall[1][6]).toBe('B002BB77');
    expect(incidentCall[1][4]).toBe('unauthorized_vehicle');
  });

  test('blacklisted plate denies with high-severity incident', async () => {
    const txClient = installTxClient();
    mockPlateQueries({ vehicle: makeVehicle({ is_blacklisted: true }) });

    const result = await verifyPass({
      property_id: UUID_PROPERTY,
      mode: 'plate',
      plate: 'A001AA77',
      performed_by_staff_id: UUID_STAFF,
      occurred_at: NOW,
    });

    expect(result.verdict.allowed).toBe(false);
    expect(result.verdict.reason).toBe('vehicle_blacklisted');

    const incidentCall = txClient.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO access_incidents'));
    expect(incidentCall[1][4]).toBe('blacklist_hit');
    expect(incidentCall[1][5]).toBe('high');
  });

  test('whitelisted plate without active pass allows entry', async () => {
    const txClient = installTxClient();
    mockPlateQueries({ vehicle: makeVehicle({ is_whitelisted: true }), pass: null });

    const result = await verifyPass({
      property_id: UUID_PROPERTY,
      mode: 'plate',
      plate: 'A001AA77',
      performed_by_staff_id: UUID_STAFF,
      occurred_at: NOW,
    });

    expect(result.verdict.allowed).toBe(true);
    expect(result.pass_id).toBeNull();
    expect(txClient.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO access_incidents'))).toBe(false);
  });

  test('known non-whitelisted vehicle without pass denies as unauthorized resident vehicle', async () => {
    const txClient = installTxClient();
    mockPlateQueries({ vehicle: makeVehicle({ is_whitelisted: false }), pass: null });

    const result = await verifyPass({
      property_id: UUID_PROPERTY,
      mode: 'plate',
      plate: 'A001AA77',
      performed_by_staff_id: UUID_STAFF,
      occurred_at: NOW,
    });

    expect(result.verdict.allowed).toBe(false);
    expect(result.verdict.reason).toBe('unauthorized_vehicle');
    const incidentCall = txClient.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO access_incidents'));
    expect(incidentCall[1][3]).toBe(UUID_VEHICLE);
  });

  test('plate input is normalized before vehicle lookup and visit log write', async () => {
    const txClient = installTxClient();
    mockPlateQueries({ vehicle: makeVehicle({ is_whitelisted: true }), pass: null });

    const result = await verifyPass({
      property_id: UUID_PROPERTY,
      mode: 'plate',
      plate: 'а 001 аа 77',
      performed_by_staff_id: UUID_STAFF,
      occurred_at: NOW,
    });

    expect(result.verdict.allowed).toBe(true);
    const vehicleLookup = db.query.mock.calls.find(([sql]) => sql.includes('FROM vehicles'));
    const visitCall = txClient.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO visit_logs_v2'));
    expect(vehicleLookup[1]).toEqual([UUID_PROPERTY, 'A001AA77']);
    expect(visitCall[1][6]).toBe('A001AA77');
  });
});
