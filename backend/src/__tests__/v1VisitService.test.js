'use strict';

jest.mock('../v1/services/verifyPass', () => ({
  verifyPass: jest.fn(),
}));

const { verifyPass } = require('../v1/services/verifyPass');
const {
  createVisitLog,
  verifyVisit,
} = require('../v1/services/visitService');

const UUID_PROPERTY = '11111111-1111-4111-8111-111111111111';
const UUID_PASS = '66666666-6666-4666-8666-666666666666';
const UUID_STAFF = '44444444-4444-4444-8444-444444444444';

function makeQueryable(handler) {
  return { query: jest.fn(handler) };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('VisitService', () => {
  test('createVisitLog normalizes plate and writes staff_users.id', async () => {
    const queryable = makeQueryable((sql) => {
      if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: UUID_STAFF }] });
      if (sql.includes('INSERT INTO visit_logs_v2')) {
        return Promise.resolve({ rows: [{ id: 'visit-1', vehicle_plate: 'A123BC777', performed_by_staff_id: UUID_STAFF }] });
      }
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const result = await createVisitLog({
      queryable,
      user: { uid: 'legacy-security-1', role: 'security' },
      input: {
        property_id: UUID_PROPERTY,
        pass_id: null,
        event_type: 'manual_admit',
        event_source: 'guard_console',
        person_label: 'Guest',
        vehicle_plate: 'а 123 вс 777',
        provider_event_id: null,
        provider_payload: { source: 'manual' },
        occurred_at: '2026-05-05T10:00:00.000Z',
      },
    });

    expect(result.visit_log.performed_by_staff_id).toBe(UUID_STAFF);
    const insertCall = queryable.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO visit_logs_v2'));
    expect(insertCall[1][5]).toBe('A123BC777');
    expect(insertCall[1][6]).toBe(UUID_STAFF);
    expect(insertCall[1]).not.toContain('legacy-security-1');
  });

  test('verifyVisit calls verifyPass with staff_users.id and enriches pass info', async () => {
    verifyPass.mockResolvedValue({
      verdict: { allowed: true, reason: 'active_pass' },
      pass_id: UUID_PASS,
      visit_log_id: 'visit-1',
      incident_id: null,
    });
    const queryable = makeQueryable((sql) => {
      if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: UUID_STAFF }] });
      if (sql.includes('FROM passes')) return Promise.resolve({ rows: [{ id: UUID_PASS, status: 'active' }] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const result = await verifyVisit({
      queryable,
      verifyDb: queryable,
      user: { uid: 'legacy-security-1', role: 'security' },
      input: {
        property_id: UUID_PROPERTY,
        mode: 'qr',
        token: 'a'.repeat(32),
        plate: null,
        occurred_at: null,
      },
    });

    expect(result.pass.id).toBe(UUID_PASS);
    expect(verifyPass).toHaveBeenCalledWith(expect.objectContaining({
      performed_by_staff_id: UUID_STAFF,
      token: 'a'.repeat(32),
    }));
  });

  test('missing staff mapping returns service error before verify', async () => {
    const queryable = makeQueryable((sql) => {
      if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    await expect(verifyVisit({
      queryable,
      verifyDb: queryable,
      user: { uid: 'missing-security', role: 'security' },
      input: { property_id: UUID_PROPERTY, mode: 'qr', token: 'a'.repeat(32), plate: null, occurred_at: null },
    })).rejects.toMatchObject({
      status: 403,
      message: 'Staff identity is not mapped to v1',
    });
    expect(verifyPass).not.toHaveBeenCalled();
  });
});
