'use strict';

const {
  approveAccessRequest,
  escalateAccessRequest,
  shouldRequireManualApproval,
} = require('../v1/services/accessRequestService');

const UUID_REQUEST = '22222222-2222-4222-8222-222222222222';
const UUID_PROPERTY = '11111111-1111-4111-8111-111111111111';
const UUID_STAFF = '44444444-4444-4444-8444-444444444444';

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

  test('guest/courier/contractor requests up to 24h auto-issue when manual review is off', () => {
    for (const requestType of ['guest_access', 'courier_access', 'contractor_access']) {
      expect(shouldRequireManualApproval({
        property: { feature_flags: { manual_access_approval: false } },
        requestType,
        startsAt: '2026-05-05T10:00:00.000Z',
        endsAt: '2026-05-06T09:59:00.000Z',
      })).toBe(false);
    }
  });

  test('long windows still require manual review', () => {
    expect(shouldRequireManualApproval({
      property: { feature_flags: { manual_access_approval: false } },
      requestType: 'guest_access',
      startsAt: '2026-05-05T10:00:00.000Z',
      endsAt: '2026-05-06T10:01:00.000Z',
    })).toBe(true);
  });
});

describe('AccessRequestService state transitions', () => {
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
            starts_at: '2026-05-05T10:00:00.000Z',
            ends_at: '2026-05-05T12:00:00.000Z',
            status: 'pending_approval',
          }],
        });
      }
      if (sql.includes('INSERT INTO access_approvals')) return Promise.resolve({ rows: [] });
      if (sql.includes('UPDATE access_requests')) {
        return Promise.resolve({ rows: [{ id: UUID_REQUEST, status: 'approved' }] });
      }
      if (sql.includes('INSERT INTO passes')) {
        return Promise.resolve({ rows: [{ id: '66666666-6666-4666-8666-666666666666', status: 'active' }] });
      }
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
  });
});
