'use strict';

const {
  evaluateAccessPolicy,
  getDefaultPolicyTemplates,
  scheduleMatches,
} = require('../v1/services/accessPolicyService');

const UUID_PROPERTY = '11111111-1111-4111-8111-111111111111';
const UUID_POLICY_A = '22222222-2222-4222-8222-222222222222';
const UUID_POLICY_B = '33333333-3333-4333-8333-333333333333';
const UUID_ZONE = '44444444-4444-4444-8444-444444444444';
const UUID_POINT = '55555555-5555-4555-8555-555555555555';
const UUID_OTHER_POINT = '66666666-6666-4666-8666-666666666666';

const NOW = new Date('2026-05-05T09:00:00.000Z'); // 12:00 Europe/Moscow

function policy(overrides = {}) {
  return {
    id: UUID_POLICY_A,
    property_id: UUID_PROPERTY,
    name: 'Default allow',
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

function queryableWithPolicies(rows) {
  return {
    query: jest.fn((sql) => {
      if (sql.includes('FROM access_policies')) return Promise.resolve({ rows });
      if (sql.includes('FROM access_points')) return Promise.resolve({ rows: [{ zone_id: UUID_ZONE }] });
      throw new Error(`unexpected SQL: ${sql}`);
    }),
  };
}

describe('AccessPolicyService', () => {
  test('exposes the default template catalog required by DH-13', () => {
    const keys = getDefaultPolicyTemplates().map((template) => template.key);
    expect(keys).toEqual([
      'resident_vehicle',
      'guest_vehicle',
      'courier',
      'contractor_service',
      'staff_operational',
      'emergency_access',
    ]);
  });

  test('allows existing verify behavior when no active policies exist', async () => {
    const queryable = queryableWithPolicies([]);

    const result = await evaluateAccessPolicy({
      queryable,
      propertyId: UUID_PROPERTY,
      subjectType: 'guest',
      accessMethod: 'qr',
      now: NOW,
    });

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('no_active_policies');
    expect(queryable.query).toHaveBeenCalledTimes(1);
  });

  test('uses deterministic priority ordering for matching policies', async () => {
    const queryable = queryableWithPolicies([
      policy({ id: UUID_POLICY_B, name: 'Deny first', effect: 'deny', priority: 10 }),
      policy({ id: UUID_POLICY_A, name: 'Allow later', effect: 'allow', priority: 20 }),
    ]);

    const result = await evaluateAccessPolicy({
      queryable,
      propertyId: UUID_PROPERTY,
      subjectType: 'guest',
      accessMethod: 'qr',
      now: NOW,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('policy_denied');
    expect(result.matched_policy_id).toBe(UUID_POLICY_B);
    expect(result.trace[0]).toMatchObject({ policy_id: UUID_POLICY_B, result: 'matched' });
  });

  test('denies when a scoped policy matches but its schedule is closed', async () => {
    const queryable = queryableWithPolicies([
      policy({
        schedule_json: {
          timezone: 'Europe/Moscow',
          days_of_week: [2],
          time_windows: [{ start: '15:00', end: '16:00' }],
        },
      }),
    ]);

    const result = await evaluateAccessPolicy({
      queryable,
      propertyId: UUID_PROPERTY,
      subjectType: 'guest',
      accessMethod: 'qr',
      now: NOW,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('outside_policy_schedule');
    expect(result.trace[0]).toMatchObject({ result: 'schedule_mismatch' });
  });

  test('enforces pass point scope before evaluating configurable policies', async () => {
    const queryable = queryableWithPolicies([policy()]);

    const result = await evaluateAccessPolicy({
      queryable,
      propertyId: UUID_PROPERTY,
      subjectType: 'guest',
      passType: 'guest',
      accessMethod: 'qr',
      pointId: UUID_OTHER_POINT,
      pass: { point_id: UUID_POINT, zone_id: null, subject_type: 'guest', pass_type: 'guest' },
      now: NOW,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('policy_point_mismatch');
    expect(queryable.query).not.toHaveBeenCalled();
  });

  test('resolves access point zone for zone-scoped policy matching', async () => {
    const queryable = queryableWithPolicies([
      policy({ zone_id: UUID_ZONE }),
    ]);

    const result = await evaluateAccessPolicy({
      queryable,
      propertyId: UUID_PROPERTY,
      subjectType: 'guest',
      accessMethod: 'qr',
      pointId: UUID_POINT,
      now: NOW,
    });

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('policy_allowed');
    expect(queryable.query.mock.calls.some(([sql]) => sql.includes('FROM access_points'))).toBe(true);
  });

  test('evaluates Europe/Moscow schedule windows predictably', () => {
    expect(scheduleMatches({
      timezone: 'Europe/Moscow',
      days_of_week: [2],
      time_windows: [{ start: '11:00', end: '12:30' }],
    }, NOW)).toMatchObject({ ok: true });
  });
});
