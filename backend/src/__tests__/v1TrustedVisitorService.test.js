'use strict';

const {
  createPassFromTrustedVisitor,
  listTrustedVisitors,
  normalizeTrustedVisitorInput,
} = require('../v1/services/trustedVisitorService');

const UUID_PROPERTY = '11111111-1111-4111-8111-111111111111';
const UUID_REQUEST = '22222222-2222-4222-8222-222222222222';
const UUID_RESIDENT = '33333333-3333-4333-8333-333333333333';
const UUID_VISITOR = '44444444-4444-4444-8444-444444444444';
const UUID_PASS = '55555555-5555-4555-8555-555555555555';
const UUID_POLICY = '66666666-6666-4666-8666-666666666666';
const UUID_UNIT = '77777777-7777-4777-8777-777777777777';

function visitor(overrides = {}) {
  return {
    id: UUID_VISITOR,
    property_id: UUID_PROPERTY,
    resident_id: UUID_RESIDENT,
    name: 'Anna Cleaner',
    phone: '+79990000000',
    visitor_type: 'cleaner',
    default_vehicle_plate: null,
    default_instructions: 'Use north gate',
    allowed_zone_id: null,
    allowed_point_id: null,
    is_active: true,
    last_used_at: null,
    created_at: '2026-05-05T08:00:00.000Z',
    updated_at: '2026-05-05T08:00:00.000Z',
    ...overrides,
  };
}

function allowPolicy() {
  return {
    id: UUID_POLICY,
    property_id: UUID_PROPERTY,
    name: 'Allow service',
    subject_type: 'guest',
    subject_role: null,
    zone_id: null,
    point_id: null,
    access_method: 'qr',
    approval_mode: 'auto',
    effect: 'allow',
    priority: 10,
    schedule_json: null,
    duration_minutes: null,
    is_recurring: true,
    is_active: true,
    created_by: null,
    metadata: {},
    created_at: '2026-05-04T10:00:00.000Z',
    updated_at: '2026-05-04T10:00:00.000Z',
  };
}

function makeTxClient(handler) {
  return {
    query: jest.fn(handler),
    release: jest.fn(),
  };
}

describe('TrustedVisitorService validation', () => {
  test('normalizes frequent guest template fields', () => {
    expect(normalizeTrustedVisitorInput({
      name: '  Mom  ',
      phone: '  +7000  ',
      visitor_type: 'relative',
      default_instructions: '  Call me  ',
    })).toMatchObject({
      name: 'Mom',
      phone: '+7000',
      visitor_type: 'relative',
      default_instructions: 'Call me',
    });
  });

  test('rejects unsupported visitor types', () => {
    expect(() => normalizeTrustedVisitorInput({
      name: 'Robot',
      visitor_type: 'vip',
    })).toThrow(/Invalid visitor_type/);
  });

  test('rejects malformed topology ids before they reach SQL', () => {
    expect(() => normalizeTrustedVisitorInput({
      name: 'Guest',
      allowed_zone_id: 'not-a-uuid',
    })).toThrow(/allowed_zone_id must be UUID or null/);
  });
});

describe('TrustedVisitorService pass creation', () => {
  test('lists trusted visitors with recent access request history', async () => {
    const recentRequest = {
      id: UUID_REQUEST,
      property_id: UUID_PROPERTY,
      created_by_type: 'resident',
      created_by_resident_id: UUID_RESIDENT,
      created_by_staff_id: null,
      created_by_contractor_user_id: null,
      request_type: 'guest_access',
      visitor_name: 'Anna Cleaner',
      visitor_phone: '+79990000000',
      vehicle_id: null,
      target_zone_id: null,
      target_point_id: null,
      target_unit_id: UUID_UNIT,
      trusted_visitor_id: UUID_VISITOR,
      reason: null,
      guest_instructions: null,
      guard_notes: null,
      share_delivery_channels: [],
      starts_at: '2026-05-05T10:00:00.000Z',
      ends_at: '2026-05-05T12:00:00.000Z',
      status: 'approved',
      approval_required: false,
      approved_at: '2026-05-05T08:00:00.000Z',
      rejected_at: null,
      cancelled_at: null,
      created_at: '2026-05-05T08:00:00.000Z',
      updated_at: '2026-05-05T08:00:00.000Z',
      trusted_visitor_history_rank: '1',
    };
    const queryable = {
      query: jest.fn((sql, params) => {
        if (sql.includes('FROM trusted_visitors')) {
          return Promise.resolve({ rows: [visitor()] });
        }
        if (sql.includes('FROM access_requests')) {
          expect(sql).toContain('AND property_id = $3');
          expect(sql).toContain('AND created_by_resident_id = $4');
          expect(params).toEqual([[UUID_VISITOR], 5, UUID_PROPERTY, UUID_RESIDENT]);
          return Promise.resolve({ rows: [recentRequest] });
        }
        throw new Error(`unexpected SQL: ${sql}`);
      }),
    };

    const rows = await listTrustedVisitors(queryable, {
      propertyId: UUID_PROPERTY,
      residentId: UUID_RESIDENT,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].recent_access_requests).toHaveLength(1);
    expect(rows[0].recent_access_requests[0]).not.toHaveProperty('trusted_visitor_history_rank');
    expect(rows[0].recent_access_requests[0].trusted_visitor_id).toBe(UUID_VISITOR);
  });

  test('deactivated visitor cannot create future passes', async () => {
    const queryable = {
      query: jest.fn((sql) => {
        if (sql.includes('FROM trusted_visitors')) {
          return Promise.resolve({ rows: [visitor({ is_active: false })] });
        }
        throw new Error(`unexpected SQL: ${sql}`);
      }),
    };
    const txPool = { connect: jest.fn() };

    await expect(createPassFromTrustedVisitor({
      queryable,
      txPool,
      property: { feature_flags: { manual_access_approval: false } },
      user: { uid: 'legacy-resident-1', role: 'owner' },
      id: UUID_VISITOR,
      propertyId: UUID_PROPERTY,
      residentId: UUID_RESIDENT,
      input: {
        target_unit_id: UUID_UNIT,
        starts_at: '2026-05-05T10:00:00.000Z',
        ends_at: '2026-05-05T12:00:00.000Z',
      },
    })).rejects.toMatchObject({
      status: 409,
      message: 'Trusted visitor is deactivated',
    });
    expect(txPool.connect).not.toHaveBeenCalled();
  });

  test('creates a normal access request and links it to the trusted visitor', async () => {
    const createdRequest = {
      id: UUID_REQUEST,
      property_id: UUID_PROPERTY,
      created_by_type: 'resident',
      created_by_resident_id: UUID_RESIDENT,
      created_by_staff_id: null,
      created_by_contractor_user_id: null,
      request_type: 'service_access',
      visitor_name: 'Anna Cleaner',
      visitor_phone: '+79990000000',
      vehicle_id: null,
      target_zone_id: null,
      target_point_id: null,
      target_unit_id: UUID_UNIT,
      trusted_visitor_id: UUID_VISITOR,
      reason: null,
      guest_instructions: 'Use north gate',
      guard_notes: null,
      share_delivery_channels: ['link', 'qr'],
      starts_at: '2026-05-05T10:00:00.000Z',
      ends_at: '2026-05-05T12:00:00.000Z',
      status: 'approved',
      approval_required: false,
      approved_at: '2026-05-05T08:00:00.000Z',
      rejected_at: null,
      cancelled_at: null,
      created_at: '2026-05-05T08:00:00.000Z',
      updated_at: '2026-05-05T08:00:00.000Z',
    };
    const txClient = makeTxClient((sql) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return Promise.resolve({ rows: [] });
      if (sql.includes('INSERT INTO access_requests')) return Promise.resolve({ rows: [createdRequest] });
      if (sql.includes('UPDATE trusted_visitors')) {
        return Promise.resolve({ rows: [visitor({ last_used_at: '2026-05-05T08:05:00.000Z' })] });
      }
      if (sql.includes('INSERT INTO passes')) {
        return Promise.resolve({
          rows: [{
            id: UUID_PASS,
            pass_type: 'service',
            status: 'active',
            valid_from: createdRequest.starts_at,
            valid_until: createdRequest.ends_at,
          }],
        });
      }
      throw new Error(`unexpected tx SQL: ${sql}`);
    });
    const queryable = {
      query: jest.fn((sql) => {
        if (sql.includes('FROM trusted_visitors')) return Promise.resolve({ rows: [visitor()] });
        if (sql.includes('resident_unit_links')) return Promise.resolve({ rows: [{ '?column?': 1 }] });
        if (sql.includes('FROM residents') && sql.includes('external_uid')) {
          return Promise.resolve({ rows: [{ id: UUID_RESIDENT }] });
        }
        if (sql.includes('FROM access_policies')) return Promise.resolve({ rows: [allowPolicy()] });
        throw new Error(`unexpected SQL: ${sql}`);
      }),
    };

    const result = await createPassFromTrustedVisitor({
      queryable,
      txPool: { connect: jest.fn().mockResolvedValue(txClient) },
      property: { feature_flags: { manual_access_approval: false } },
      user: { uid: 'legacy-resident-1', role: 'owner' },
      id: UUID_VISITOR,
      propertyId: UUID_PROPERTY,
      residentId: UUID_RESIDENT,
      input: {
        target_unit_id: UUID_UNIT,
        starts_at: '2026-05-05T10:00:00.000Z',
        ends_at: '2026-05-05T12:00:00.000Z',
      },
    });

    expect(result.access_request.trusted_visitor_id).toBe(UUID_VISITOR);
    expect(result.access_request.request_type).toBe('service_access');
    expect(result.pass.id).toBe(UUID_PASS);
    const insertCall = txClient.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO access_requests'));
    expect(insertCall[1][5]).toBe('service_access');
    expect(insertCall[1][6]).toBe('Anna Cleaner');
    expect(insertCall[1][12]).toBe(UUID_VISITOR);
    expect(insertCall[1][14]).toBe('Use north gate');
    expect(result.trusted_visitor.last_used_at).toBe('2026-05-05T08:05:00.000Z');
    expect(result.trusted_visitor.recent_access_requests).toEqual([createdRequest]);
  });

  test('does not allow vehicle_access through trusted visitor shortcut without vehicle flow', async () => {
    const queryable = {
      query: jest.fn((sql) => {
        if (sql.includes('FROM trusted_visitors')) return Promise.resolve({ rows: [visitor()] });
        if (sql.includes('resident_unit_links')) return Promise.resolve({ rows: [{ '?column?': 1 }] });
        throw new Error(`unexpected SQL: ${sql}`);
      }),
    };
    const txPool = { connect: jest.fn() };

    await expect(createPassFromTrustedVisitor({
      queryable,
      txPool,
      property: { feature_flags: { manual_access_approval: false } },
      user: { uid: 'legacy-resident-1', role: 'owner' },
      id: UUID_VISITOR,
      propertyId: UUID_PROPERTY,
      residentId: UUID_RESIDENT,
      input: {
        target_unit_id: UUID_UNIT,
        request_type: 'vehicle_access',
        starts_at: '2026-05-05T10:00:00.000Z',
        ends_at: '2026-05-05T12:00:00.000Z',
      },
    })).rejects.toMatchObject({
      status: 422,
      message: 'vehicle_access from trusted visitor requires the vehicle flow',
    });
    expect(txPool.connect).not.toHaveBeenCalled();
  });
});
