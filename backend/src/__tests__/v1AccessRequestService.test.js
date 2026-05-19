'use strict';

const {
  approveAccessRequest,
  cancelAccessRequest,
  createAccessRequest,
  escalateAccessRequest,
  rejectAccessRequest,
  shouldRequireManualApproval,
  submitAccessRequest,
} = require('../v1/services/accessRequestService');

const UUID_REQUEST = '22222222-2222-4222-8222-222222222222';
const UUID_PROPERTY = '11111111-1111-4111-8111-111111111111';
const UUID_STAFF = '44444444-4444-4444-8444-444444444444';
const UUID_ZONE = '77777777-7777-4777-8777-777777777777';
const UUID_POINT = '88888888-8888-4888-8888-888888888888';
const UUID_POLICY = '99999999-9999-4999-8999-999999999999';
const UUID_RESIDENT = '33333333-3333-4333-8333-333333333333';
const UUID_VISITOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function allowPolicy(overrides = {}) {
  return {
    id: UUID_POLICY,
    property_id: UUID_PROPERTY,
    name: 'Guest allow',
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

function makeTxClient(handler) {
  return {
    query: jest.fn(handler),
    release: jest.fn(),
  };
}

function makeTxPool(client) {
  return {
    connect: jest.fn().mockResolvedValue(client),
  };
}

describe('AccessRequestService approval policy', () => {
  test('manual_access_approval forces contractor requests through manual review', () => {
    expect(shouldRequireManualApproval({
      property: { feature_flags: { manual_access_approval: true } },
      requestType: 'contractor_access',
      startsAt: '2026-05-05T10:00:00.000Z',
      endsAt: '2026-05-05T12:00:00.000Z',
    })).toBe(true);
  });

  test('policy allow can auto-issue when manual review is off', () => {
    expect(shouldRequireManualApproval({
      property: { feature_flags: { manual_access_approval: false } },
      policyDecision: { decision: 'allow' },
    })).toBe(false);
  });

  test('missing policy decision requires manual review', () => {
    expect(shouldRequireManualApproval({
      property: { feature_flags: { manual_access_approval: false } },
    })).toBe(true);
  });
});

describe('AccessRequestService state transitions', () => {
  test('direct trusted visitor access request requires an active resident-owned template', async () => {
    const queryable = {
      query: jest.fn((sql) => {
        if (sql.includes('FROM residents')) return Promise.resolve({ rows: [{ id: UUID_RESIDENT }] });
        if (sql.includes('FROM trusted_visitors')) return Promise.resolve({ rows: [] });
        throw new Error(`unexpected SQL: ${sql}`);
      }),
    };
    const txPool = { connect: jest.fn() };

    await expect(createAccessRequest({
      queryable,
      txPool,
      property: { feature_flags: { manual_access_approval: false } },
      user: { uid: 'legacy-resident-1', role: 'owner' },
      input: {
        property_id: UUID_PROPERTY,
        request_type: 'guest_access',
        visitor_name: null,
        visitor_phone: null,
        vehicle_id: null,
        target_unit_id: null,
        target_zone_id: null,
        target_point_id: null,
        trusted_visitor_id: UUID_VISITOR,
        request_id: null,
        reason: 'visit',
        starts_at: '2026-05-05T10:00:00.000Z',
        ends_at: '2026-05-05T12:00:00.000Z',
      },
    })).rejects.toMatchObject({
      status: 409,
      message: 'Trusted visitor is unavailable for pass creation',
    });
    expect(txPool.connect).not.toHaveBeenCalled();
  });

  test('direct trusted visitor access request cannot be created by staff', async () => {
    const queryable = {
      query: jest.fn((sql) => {
        if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: UUID_STAFF }] });
        throw new Error(`unexpected SQL: ${sql}`);
      }),
    };
    const txPool = { connect: jest.fn() };

    await expect(createAccessRequest({
      queryable,
      txPool,
      property: { feature_flags: { manual_access_approval: false } },
      user: { uid: 'legacy-staff-1', role: 'security' },
      input: {
        property_id: UUID_PROPERTY,
        request_type: 'guest_access',
        visitor_name: null,
        visitor_phone: null,
        vehicle_id: null,
        target_unit_id: null,
        target_zone_id: null,
        target_point_id: null,
        trusted_visitor_id: UUID_VISITOR,
        request_id: null,
        reason: 'visit',
        starts_at: '2026-05-05T10:00:00.000Z',
        ends_at: '2026-05-05T12:00:00.000Z',
      },
    })).rejects.toMatchObject({
      status: 403,
      message: 'Trusted visitor pass creation requires resident identity',
    });
    expect(txPool.connect).not.toHaveBeenCalled();
  });

  test('contractor access requires a linked service request', async () => {
    const queryable = {
      query: jest.fn((sql) => {
        if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: UUID_STAFF }] });
        if (sql.includes('FROM access_zones')) return Promise.resolve({ rows: [{ id: UUID_ZONE }] });
        if (sql.includes('FROM access_points')) return Promise.resolve({ rows: [{ id: UUID_POINT, zone_id: UUID_ZONE }] });
        throw new Error(`unexpected SQL: ${sql}`);
      }),
    };
    const txPool = { connect: jest.fn() };

    await expect(createAccessRequest({
      queryable,
      txPool,
      property: { feature_flags: { manual_access_approval: false } },
      user: { uid: 'legacy-staff-1', role: 'security' },
      input: {
        property_id: UUID_PROPERTY,
        request_type: 'contractor_access',
        visitor_name: null,
        visitor_phone: null,
        vehicle_id: null,
        target_unit_id: null,
        target_zone_id: UUID_ZONE,
        target_point_id: UUID_POINT,
        request_id: null,
        reason: 'repair work',
        starts_at: '2026-05-05T10:00:00.000Z',
        ends_at: '2026-05-05T12:00:00.000Z',
      },
    })).rejects.toMatchObject({
      status: 422,
      message: 'contractor_access requires linked request_id',
    });
    expect(txPool.connect).not.toHaveBeenCalled();
  });

  test('create rejects topology references outside the access request property', async () => {
    const queryable = {
      query: jest.fn((sql) => {
        if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: UUID_STAFF }] });
        if (sql.includes('FROM access_zones')) return Promise.resolve({ rows: [] });
        throw new Error(`unexpected SQL: ${sql}`);
      }),
    };
    const txPool = { connect: jest.fn() };

    await expect(createAccessRequest({
      queryable,
      txPool,
      property: { feature_flags: { manual_access_approval: false } },
      user: { uid: 'legacy-staff-1', role: 'security' },
      input: {
        property_id: UUID_PROPERTY,
        request_type: 'guest_access',
        visitor_name: 'Guest',
        visitor_phone: null,
        vehicle_id: null,
        target_unit_id: null,
        target_zone_id: UUID_ZONE,
        target_point_id: null,
        request_id: null,
        reason: 'visit',
        starts_at: '2026-05-05T10:00:00.000Z',
        ends_at: '2026-05-05T12:00:00.000Z',
      },
    })).rejects.toMatchObject({
      status: 400,
      message: 'target_zone_id does not exist for this property',
    });
    expect(txPool.connect).not.toHaveBeenCalled();
  });

  test('approve rejects terminal states without writing pass', async () => {
    const txClient = makeTxClient((sql) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return Promise.resolve({ rows: [] });
      if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: UUID_STAFF }] });
      if (sql.includes('FROM access_requests') && sql.includes('FOR UPDATE')) {
        return Promise.resolve({ rows: [{ status: 'rejected' }] });
      }
      throw new Error(`unexpected SQL: ${sql}`);
    });

    await expect(approveAccessRequest({
      txPool: makeTxPool(txClient),
      user: { uid: 'legacy-staff-1', role: 'security' },
      accessRequestId: UUID_REQUEST,
      comment: 'late',
    })).rejects.toMatchObject({
      status: 409,
      message: "Cannot approve from status 'rejected'",
    });

    expect(txClient.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO passes'))).toBe(false);
    expect(txClient.query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true);
    expect(txClient.release).toHaveBeenCalledTimes(1);
  });

  test('approve rejects contractor access when linked service request is missing', async () => {
    const txClient = makeTxClient((sql) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return Promise.resolve({ rows: [] });
      if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: UUID_STAFF }] });
      if (sql.includes('FROM access_requests') && sql.includes('FOR UPDATE')) {
        return Promise.resolve({
          rows: [{
            id: UUID_REQUEST,
            property_id: UUID_PROPERTY,
            request_type: 'contractor_access',
            vehicle_id: null,
            created_by_contractor_user_id: null,
            target_zone_id: UUID_ZONE,
            target_point_id: UUID_POINT,
            starts_at: '2026-05-05T10:00:00.000Z',
            ends_at: '2026-05-05T12:00:00.000Z',
            status: 'pending_approval',
          }],
        });
      }
      if (sql.includes('FROM access_zones')) return Promise.resolve({ rows: [{ id: UUID_ZONE }] });
      if (sql.includes('FROM access_points')) return Promise.resolve({ rows: [{ id: UUID_POINT, zone_id: UUID_ZONE }] });
      if (sql.includes('FROM request_access_links')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    await expect(approveAccessRequest({
      txPool: makeTxPool(txClient),
      user: { uid: 'legacy-staff-1', role: 'security' },
      accessRequestId: UUID_REQUEST,
      comment: 'ok',
    })).rejects.toMatchObject({
      status: 409,
      message: 'contractor_access requires linked service request',
    });

    expect(txClient.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO passes'))).toBe(false);
    expect(txClient.query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true);
    expect(txClient.release).toHaveBeenCalledTimes(1);
  });

  test('approve rejects persisted target point outside the access request property', async () => {
    const txClient = makeTxClient((sql) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return Promise.resolve({ rows: [] });
      if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: UUID_STAFF }] });
      if (sql.includes('FROM access_requests') && sql.includes('FOR UPDATE')) {
        return Promise.resolve({
          rows: [{
            id: UUID_REQUEST,
            property_id: UUID_PROPERTY,
            request_type: 'guest_access',
            vehicle_id: null,
            created_by_contractor_user_id: null,
            target_zone_id: null,
            target_point_id: UUID_POINT,
            starts_at: '2026-05-05T10:00:00.000Z',
            ends_at: '2026-05-05T12:00:00.000Z',
            status: 'pending_approval',
          }],
        });
      }
      if (sql.includes('FROM access_points')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    await expect(approveAccessRequest({
      txPool: makeTxPool(txClient),
      user: { uid: 'legacy-staff-1', role: 'security' },
      accessRequestId: UUID_REQUEST,
      comment: 'ok',
    })).rejects.toMatchObject({
      status: 400,
      message: 'target_point_id does not exist for this property',
    });

    expect(txClient.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO passes'))).toBe(false);
    expect(txClient.query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true);
    expect(txClient.release).toHaveBeenCalledTimes(1);
  });

  test('escalate rejects already escalated requests', async () => {
    const txClient = makeTxClient((sql) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return Promise.resolve({ rows: [] });
      if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: UUID_STAFF }] });
      if (sql.includes('FROM access_requests') && sql.includes('FOR UPDATE')) {
        return Promise.resolve({ rows: [{ status: 'escalated' }] });
      }
      throw new Error(`unexpected SQL: ${sql}`);
    });

    await expect(escalateAccessRequest({
      txPool: makeTxPool(txClient),
      user: { uid: 'legacy-staff-1', role: 'security' },
      accessRequestId: UUID_REQUEST,
      comment: 'again',
    })).rejects.toMatchObject({
      status: 409,
      message: "Cannot escalate from status 'escalated'",
    });

    expect(txClient.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO access_approvals'))).toBe(false);
    expect(txClient.query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true);
    expect(txClient.release).toHaveBeenCalledTimes(1);
  });

  test('approve writes approval, request update, and pass in one transaction', async () => {
    const txClient = makeTxClient((sql) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return Promise.resolve({ rows: [] });
      if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: UUID_STAFF }] });
      if (sql.includes('FROM access_requests') && sql.includes('FOR UPDATE')) {
        return Promise.resolve({
          rows: [{
            id: UUID_REQUEST,
            property_id: UUID_PROPERTY,
            request_type: 'guest_access',
            vehicle_id: null,
            target_zone_id: UUID_ZONE,
            target_point_id: UUID_POINT,
            starts_at: '2026-05-05T10:00:00.000Z',
            ends_at: '2026-05-05T12:00:00.000Z',
            status: 'pending_approval',
          }],
        });
      }
      if (sql.includes('FROM access_zones')) return Promise.resolve({ rows: [{ id: UUID_ZONE }] });
      if (sql.includes('FROM access_points')) return Promise.resolve({ rows: [{ id: UUID_POINT, zone_id: UUID_ZONE }] });
      if (sql.includes('INSERT INTO access_approvals')) return Promise.resolve({ rows: [] });
      if (sql.includes('UPDATE access_requests')) {
        return Promise.resolve({ rows: [{ id: UUID_REQUEST, status: 'approved' }] });
      }
      if (sql.includes('FROM access_policies')) return Promise.resolve({ rows: [allowPolicy()] });
      if (sql.includes('INSERT INTO passes')) {
        return Promise.resolve({ rows: [{ id: '66666666-6666-4666-8666-666666666666', status: 'active' }] });
      }
      if (sql.includes('INSERT INTO notifications_outbox')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const result = await approveAccessRequest({
      txPool: makeTxPool(txClient),
      user: { uid: 'legacy-staff-1', role: 'security' },
      accessRequestId: UUID_REQUEST,
      comment: 'ok',
    });

    expect(result.access_request.status).toBe('approved');
    expect(result.pass.status).toBe('active');
    expect(txClient.query.mock.calls.map(([sql]) => sql)).toEqual(expect.arrayContaining([
      'BEGIN',
      'COMMIT',
    ]));
    const passCall = txClient.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO passes'));
    const updateCall = txClient.query.mock.calls.find(([sql]) => sql.includes('UPDATE access_requests'));
    expect(updateCall[0]).toContain('AND status = $2');
    expect(updateCall[1]).toEqual([UUID_REQUEST, 'pending_approval']);
    expect(passCall[1][6]).toBe(UUID_ZONE);
    expect(passCall[1][7]).toBe(UUID_POINT);
    expect(passCall[1][8]).toBe(UUID_POLICY);
  });

  test('approve rolls back when locked status no longer matches update predicate', async () => {
    const txClient = makeTxClient((sql) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return Promise.resolve({ rows: [] });
      if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: UUID_STAFF }] });
      if (sql.includes('FROM access_requests') && sql.includes('FOR UPDATE')) {
        return Promise.resolve({
          rows: [{
            id: UUID_REQUEST,
            property_id: UUID_PROPERTY,
            request_type: 'guest_access',
            vehicle_id: null,
            target_zone_id: null,
            target_point_id: null,
            starts_at: '2026-05-05T10:00:00.000Z',
            ends_at: '2026-05-05T12:00:00.000Z',
            status: 'pending_approval',
          }],
        });
      }
      if (sql.includes('FROM access_policies')) return Promise.resolve({ rows: [allowPolicy()] });
      if (sql.includes('INSERT INTO access_approvals')) return Promise.resolve({ rows: [] });
      if (sql.includes('UPDATE access_requests')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    await expect(approveAccessRequest({
      txPool: makeTxPool(txClient),
      user: { uid: 'legacy-staff-1', role: 'security' },
      accessRequestId: UUID_REQUEST,
      comment: 'ok',
    })).rejects.toMatchObject({
      status: 409,
      message: 'Access request status changed; refresh and retry',
    });

    const updateCall = txClient.query.mock.calls.find(([sql]) => sql.includes('UPDATE access_requests'));
    expect(updateCall[0]).toContain('AND status = $2');
    expect(updateCall[1]).toEqual([UUID_REQUEST, 'pending_approval']);
    expect(txClient.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO passes'))).toBe(false);
    expect(txClient.query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true);
  });

  test('submit scopes mutation by current status', async () => {
    const txClient = makeTxClient((sql) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return Promise.resolve({ rows: [] });
      if (sql.includes('FROM access_requests') && sql.includes('FOR UPDATE')) {
        return Promise.resolve({ rows: [{ status: 'new' }] });
      }
      if (sql.includes('UPDATE access_requests')) {
        return Promise.resolve({ rows: [{ id: UUID_REQUEST, status: 'pending_approval' }] });
      }
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const result = await submitAccessRequest({
      txPool: makeTxPool(txClient),
      accessRequestId: UUID_REQUEST,
      propertyId: UUID_PROPERTY,
    });

    expect(result.access_request.status).toBe('pending_approval');
    const updateCall = txClient.query.mock.calls.find(([sql]) => sql.includes('UPDATE access_requests'));
    expect(updateCall[0]).toContain('AND property_id = $2');
    expect(updateCall[0]).toContain('AND status = $3');
    expect(updateCall[1]).toEqual([UUID_REQUEST, UUID_PROPERTY, 'new']);
  });

  test('reject/cancel/escalate updates include locked status predicate', async () => {
    const cases = [
      {
        run: () => rejectAccessRequest({
          txPool: makeTxPool(makeClient('pending_approval', 'rejected')),
          user: { uid: 'legacy-staff-1', role: 'security' },
          accessRequestId: UUID_REQUEST,
          comment: 'no',
          propertyId: UUID_PROPERTY,
        }),
        status: 'pending_approval',
      },
      {
        run: () => cancelAccessRequest({
          txPool: makeTxPool(makeClient('pending_approval', 'cancelled', { created_by_resident_id: UUID_RESIDENT })),
          user: { uid: 'legacy-resident-1', role: 'owner' },
          accessRequestId: UUID_REQUEST,
          isPropertyAdmin: true,
          propertyId: UUID_PROPERTY,
        }),
        status: 'pending_approval',
      },
      {
        run: () => escalateAccessRequest({
          txPool: makeTxPool(makeClient('pending_approval', 'escalated')),
          user: { uid: 'legacy-staff-1', role: 'security' },
          accessRequestId: UUID_REQUEST,
          comment: 'admin',
          propertyId: UUID_PROPERTY,
        }),
        status: 'pending_approval',
      },
    ];

    for (const item of cases) {
      const result = await item.run();
      expect(result.access_request).toBeDefined();
    }

    function makeClient(currentStatus, nextStatus, extraCurrent = {}) {
      return makeTxClient((sql) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') return Promise.resolve({ rows: [] });
        if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: UUID_STAFF }] });
        if (sql.includes('FROM access_requests') && sql.includes('FOR UPDATE')) {
          return Promise.resolve({ rows: [{ status: currentStatus, ...extraCurrent }] });
        }
        if (sql.includes('INSERT INTO access_approvals')) return Promise.resolve({ rows: [] });
        if (sql.includes('UPDATE access_requests')) {
          expect(sql).toContain('AND status = $3');
          return Promise.resolve({ rows: [{ id: UUID_REQUEST, property_id: UUID_PROPERTY, status: nextStatus }] });
        }
        if (sql.includes('INSERT INTO notifications_outbox')) return Promise.resolve({ rows: [] });
        throw new Error(`unexpected SQL: ${sql}`);
      });
    }
  });

  test('approve returns structured conflict when expected status is stale', async () => {
    const txClient = makeTxClient((sql) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return Promise.resolve({ rows: [] });
      if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: UUID_STAFF }] });
      if (sql.includes('FROM access_requests') && sql.includes('FOR UPDATE')) {
        return Promise.resolve({
          rows: [{
            id: UUID_REQUEST,
            property_id: UUID_PROPERTY,
            request_type: 'guest_access',
            vehicle_id: null,
            target_zone_id: UUID_ZONE,
            target_point_id: UUID_POINT,
            starts_at: '2026-05-05T10:00:00.000Z',
            ends_at: '2026-05-05T12:00:00.000Z',
            status: 'approved',
          }],
        });
      }
      throw new Error(`unexpected SQL: ${sql}`);
    });

    await expect(approveAccessRequest({
      txPool: makeTxPool(txClient),
      user: { uid: 'legacy-staff-1', role: 'security' },
      accessRequestId: UUID_REQUEST,
      expectedCurrentStatus: 'pending_approval',
    })).rejects.toMatchObject({
      status: 409,
      details: {
        currentStatus: 'approved',
        expectedCurrentStatus: 'pending_approval',
      },
    });
  });
});
