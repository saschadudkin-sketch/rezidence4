'use strict';

const express = require('express');
const supertest = require('supertest');

jest.mock('../db', () => ({
  query: jest.fn(),
  pool: { connect: jest.fn() },
}));
jest.mock('../logger', () => require('../__mocks__/logger'));
jest.mock('../middleware/idempotency', () => (_req, _res, next) => next());

let mockCurrentUser = null;
jest.mock('../middleware/auth', () => (req, res, next) => {
  if (!mockCurrentUser) return res.status(401).json({ error: 'auth not set' });
  req.user = mockCurrentUser;
  next();
});

const db = require('../db');
const accessRequestsRouter = require('../v1/routes/accessRequests');

const UUID_PROPERTY = '11111111-1111-4111-8111-111111111111';
const UUID_REQUEST = '22222222-2222-4222-8222-222222222222';
const UUID_RESIDENT = '33333333-3333-4333-8333-333333333333';
const UUID_STAFF = '44444444-4444-4444-8444-444444444444';
const UUID_CONTRACTOR = '55555555-5555-4555-8555-555555555555';
const UUID_PASS = '66666666-6666-4666-8666-666666666666';
const UUID_ZONE = '77777777-7777-4777-8777-777777777777';
const UUID_POINT = '88888888-8888-4888-8888-888888888888';
const UUID_VEHICLE = '99999999-9999-4999-8999-999999999999';
const UUID_POLICY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function buildApp({ featureFlags = null } = {}) {
  const app = express();
  app.use(express.json());
  if (featureFlags) {
    app.use((req, _res, next) => {
      req.property = { feature_flags: featureFlags };
      next();
    });
  }
  app.use('/api/v1/access-requests', accessRequestsRouter);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    res.status(500).json({ error: String(err && err.message || err) });
  });
  return app;
}

function validCreatePayload(overrides = {}) {
  return {
    property_id: UUID_PROPERTY,
    request_type: 'guest_access',
    visitor_name: 'Guest',
    starts_at: '2026-05-05T10:00:00.000Z',
    ends_at: '2026-05-05T12:00:00.000Z',
    ...overrides,
  };
}

function accessRequestRow(overrides = {}) {
  return {
    id: UUID_REQUEST,
    property_id: UUID_PROPERTY,
    created_by_type: 'resident',
    created_by_resident_id: UUID_RESIDENT,
    created_by_staff_id: null,
    created_by_contractor_user_id: null,
    request_type: 'guest_access',
    visitor_name: 'Guest',
    visitor_phone: null,
    vehicle_id: null,
    target_zone_id: null,
    target_point_id: null,
    target_unit_id: null,
    reason: null,
    starts_at: '2026-05-05T10:00:00.000Z',
    ends_at: '2026-05-05T12:00:00.000Z',
    status: 'new',
    approval_required: true,
    approved_at: null,
    rejected_at: null,
    cancelled_at: null,
    created_at: '2026-05-04T10:00:00.000Z',
    updated_at: '2026-05-04T10:00:00.000Z',
    ...overrides,
  };
}

function allowPolicy(overrides = {}) {
  return {
    id: UUID_POLICY,
    property_id: UUID_PROPERTY,
    name: 'Allow access',
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
    ...overrides,
  };
}

function makeTxClient(handler) {
  return {
    query: jest.fn(handler),
    release: jest.fn(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = null;
  db.query.mockResolvedValue({ rows: [] });
  db.pool.connect.mockReset();
});

describe('v1 accessRequests route — Phase 1.1 request lifecycle', () => {
  test('resident create writes residents.id, not legacy uid, into created_by_resident_id', async () => {
    mockCurrentUser = { uid: 'legacy-resident-1', role: 'owner' };
    const row = accessRequestRow({
      status: 'approved',
      approval_required: false,
      approved_at: '2026-05-04T10:01:00.000Z',
    });
    const txClient = makeTxClient((sql) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return Promise.resolve({ rows: [] });
      if (sql.includes('INSERT INTO access_requests')) return Promise.resolve({ rows: [row] });
      if (sql.includes('INSERT INTO passes')) {
        return Promise.resolve({ rows: [{
          id: UUID_PASS,
          pass_type: 'guest',
          status: 'active',
          policy_id: UUID_POLICY,
          valid_from: row.starts_at,
          valid_until: row.ends_at,
        }] });
      }
      throw new Error(`unexpected SQL: ${sql}`);
    });
    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM residents')) return Promise.resolve({ rows: [{ id: UUID_RESIDENT }] });
      if (sql.includes('FROM access_policies')) return Promise.resolve({ rows: [allowPolicy()] });
      return Promise.resolve({ rows: [] });
    });
    db.pool.connect.mockResolvedValue(txClient);

    const res = await supertest(buildApp())
      .post('/api/v1/access-requests')
      .send(validCreatePayload());

    expect(res.status).toBe(201);
    expect(res.body.access_request.id).toBe(UUID_REQUEST);
    expect(res.body.access_request.status).toBe('approved');
    expect(res.body.access_request.approval_required).toBe(false);
    expect(res.body.pass.id).toBe(UUID_PASS);

    const insertCall = txClient.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO access_requests'));
    expect(insertCall).toBeDefined();
    expect(insertCall[1][0]).toBe(UUID_PROPERTY);
    expect(insertCall[1][1]).toBe('resident');
    expect(insertCall[1][2]).toBe(UUID_RESIDENT);
    expect(insertCall[1]).not.toContain('legacy-resident-1');
  });

  test('contractor create writes contractor_users.id into created_by_contractor_user_id', async () => {
    mockCurrentUser = { uid: 'legacy-contractor-1', role: 'contractor' };
    const row = accessRequestRow({
      created_by_type: 'contractor',
      created_by_resident_id: null,
      created_by_contractor_user_id: UUID_CONTRACTOR,
      request_type: 'contractor_access',
      status: 'approved',
      approval_required: false,
      approved_at: '2026-05-04T10:01:00.000Z',
    });
    const txClient = makeTxClient((sql) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return Promise.resolve({ rows: [] });
      if (sql.includes('INSERT INTO access_requests')) return Promise.resolve({ rows: [row] });
      if (sql.includes('INSERT INTO request_access_links')) return Promise.resolve({ rows: [] });
      if (sql.includes('INSERT INTO passes')) {
        return Promise.resolve({ rows: [{
          id: UUID_PASS,
          pass_type: 'contractor',
          status: 'active',
          policy_id: UUID_POLICY,
          valid_from: row.starts_at,
          valid_until: row.ends_at,
        }] });
      }
      throw new Error(`unexpected SQL: ${sql}`);
    });
    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM contractor_users')) return Promise.resolve({ rows: [{ id: UUID_CONTRACTOR }] });
      if (sql.includes('FROM requests')) {
        return Promise.resolve({ rows: [{
          id: 'req-1',
          status: 'assigned',
          assigned_contractor_user_id: UUID_CONTRACTOR,
          resolution_due_at: '2026-05-05T13:00:00.000Z',
        }] });
      }
      if (sql.includes('FROM access_policies')) {
        return Promise.resolve({ rows: [allowPolicy({ subject_type: 'contractor' })] });
      }
      return Promise.resolve({ rows: [] });
    });
    db.pool.connect.mockResolvedValue(txClient);

    const res = await supertest(buildApp())
      .post('/api/v1/access-requests')
      .send(validCreatePayload({ request_type: 'contractor_access', request_id: 'req-1' }));

    expect(res.status).toBe(201);
    const insertCall = txClient.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO access_requests'));
    expect(insertCall[1][1]).toBe('contractor');
    expect(insertCall[1][2]).toBeNull();
    expect(insertCall[1][4]).toBe(UUID_CONTRACTOR);
    expect(insertCall[1]).not.toContain('legacy-contractor-1');

    const passCall = txClient.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO passes'));
    expect(passCall[1][2]).toBe('contractor');
    expect(passCall[1][3]).toBe('contractor_user');
    expect(passCall[1][4]).toBe(UUID_CONTRACTOR);
  });

  test('create validates topology target and auto-issued pass inherits zone and point', async () => {
    mockCurrentUser = { uid: 'legacy-resident-1', role: 'owner' };
    const row = accessRequestRow({
      status: 'approved',
      approval_required: false,
      approved_at: '2026-05-04T10:01:00.000Z',
      target_zone_id: UUID_ZONE,
      target_point_id: UUID_POINT,
    });
    const txClient = makeTxClient((sql) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return Promise.resolve({ rows: [] });
      if (sql.includes('INSERT INTO access_requests')) return Promise.resolve({ rows: [row] });
      if (sql.includes('INSERT INTO passes')) {
        return Promise.resolve({ rows: [{
          id: UUID_PASS,
          pass_type: 'guest',
          status: 'active',
          zone_id: UUID_ZONE,
          point_id: UUID_POINT,
          policy_id: UUID_POLICY,
          valid_from: row.starts_at,
          valid_until: row.ends_at,
        }] });
      }
      throw new Error(`unexpected SQL: ${sql}`);
    });
    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM residents')) return Promise.resolve({ rows: [{ id: UUID_RESIDENT }] });
      if (sql.includes('FROM access_zones')) return Promise.resolve({ rows: [{ id: UUID_ZONE }] });
      if (sql.includes('FROM access_points')) {
        return Promise.resolve({ rows: [{ id: UUID_POINT, zone_id: UUID_ZONE }] });
      }
      if (sql.includes('FROM access_policies')) return Promise.resolve({ rows: [allowPolicy()] });
      return Promise.resolve({ rows: [] });
    });
    db.pool.connect.mockResolvedValue(txClient);

    const res = await supertest(buildApp())
      .post('/api/v1/access-requests')
      .send(validCreatePayload({
        target_zone_id: UUID_ZONE,
        target_point_id: UUID_POINT,
      }));

    expect(res.status).toBe(201);
    expect(res.body.pass.zone_id).toBe(UUID_ZONE);
    expect(res.body.pass.point_id).toBe(UUID_POINT);

    const passCall = txClient.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO passes'));
    expect(passCall[1][6]).toBe(UUID_ZONE);
    expect(passCall[1][7]).toBe(UUID_POINT);
  });

  test('resident vehicle_access can only use a vehicle owned by that resident', async () => {
    mockCurrentUser = { uid: 'legacy-resident-1', role: 'owner' };
    const row = accessRequestRow({
      request_type: 'vehicle_access',
      vehicle_id: UUID_VEHICLE,
      status: 'pending_approval',
      approval_required: true,
    });
    const txClient = makeTxClient((sql) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return Promise.resolve({ rows: [] });
      if (sql.includes('INSERT INTO access_requests')) return Promise.resolve({ rows: [row] });
      if (sql.includes('INSERT INTO passes')) throw new Error('vehicle request should wait for approval');
      throw new Error(`unexpected SQL: ${sql}`);
    });
    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM vehicles')) {
        return Promise.resolve({
          rows: [{
            id: UUID_VEHICLE,
            property_id: UUID_PROPERTY,
            owner_resident_id: UUID_RESIDENT,
            owner_contractor_user_id: null,
            owner_type: 'resident',
            vehicle_type: 'car',
            is_whitelisted: true,
            is_blacklisted: false,
          }],
        });
      }
      if (sql.includes('FROM residents')) return Promise.resolve({ rows: [{ id: UUID_RESIDENT }] });
      if (sql.includes('FROM access_policies')) {
        return Promise.resolve({ rows: [allowPolicy({
          subject_type: 'vehicle',
          access_method: 'plate',
          approval_mode: 'required',
        })] });
      }
      return Promise.resolve({ rows: [] });
    });
    db.pool.connect.mockResolvedValue(txClient);

    const res = await supertest(buildApp())
      .post('/api/v1/access-requests')
      .send(validCreatePayload({
        request_type: 'vehicle_access',
        vehicle_id: UUID_VEHICLE,
        visitor_name: null,
      }));

    expect(res.status).toBe(201);
    expect(res.body.access_request.vehicle_id).toBe(UUID_VEHICLE);
    expect(res.body.access_request.status).toBe('pending_approval');
    expect(res.body.pass).toBeNull();
    expect(txClient.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO passes'))).toBe(false);
  });

  test('manual approval setting keeps non-contractor request pending and does not issue pass', async () => {
    mockCurrentUser = { uid: 'legacy-resident-1', role: 'owner' };
    const row = accessRequestRow({ status: 'pending_approval', approval_required: true });
    const txClient = makeTxClient((sql) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return Promise.resolve({ rows: [] });
      if (sql.includes('INSERT INTO access_requests')) return Promise.resolve({ rows: [row] });
      if (sql.includes('INSERT INTO passes')) throw new Error('pass should not be issued');
      throw new Error(`unexpected SQL: ${sql}`);
    });
    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM residents')) return Promise.resolve({ rows: [{ id: UUID_RESIDENT }] });
      if (sql.includes('FROM access_policies')) return Promise.resolve({ rows: [allowPolicy()] });
      return Promise.resolve({ rows: [] });
    });
    db.pool.connect.mockResolvedValue(txClient);

    const res = await supertest(buildApp({ featureFlags: { manual_access_approval: true } }))
      .post('/api/v1/access-requests')
      .send(validCreatePayload());

    expect(res.status).toBe(201);
    expect(res.body.access_request.status).toBe('pending_approval');
    expect(res.body.access_request.approval_required).toBe(true);
    expect(res.body.pass).toBeNull();
    expect(txClient.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO passes'))).toBe(false);
  });

  test('manual approval setting keeps contractor request pending and does not issue pass', async () => {
    mockCurrentUser = { uid: 'legacy-contractor-1', role: 'contractor' };
    const row = accessRequestRow({
      created_by_type: 'contractor',
      created_by_resident_id: null,
      created_by_contractor_user_id: UUID_CONTRACTOR,
      request_type: 'contractor_access',
      status: 'pending_approval',
      approval_required: true,
    });
    const txClient = makeTxClient((sql) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return Promise.resolve({ rows: [] });
      if (sql.includes('INSERT INTO access_requests')) return Promise.resolve({ rows: [row] });
      if (sql.includes('INSERT INTO request_access_links')) return Promise.resolve({ rows: [] });
      if (sql.includes('INSERT INTO passes')) throw new Error('pass should not be issued');
      throw new Error(`unexpected SQL: ${sql}`);
    });
    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM contractor_users')) return Promise.resolve({ rows: [{ id: UUID_CONTRACTOR }] });
      if (sql.includes('FROM requests')) {
        return Promise.resolve({ rows: [{
          id: 'req-1',
          status: 'assigned',
          assigned_contractor_user_id: UUID_CONTRACTOR,
          resolution_due_at: '2026-05-05T13:00:00.000Z',
        }] });
      }
      if (sql.includes('FROM access_policies')) {
        return Promise.resolve({ rows: [allowPolicy({ subject_type: 'contractor' })] });
      }
      return Promise.resolve({ rows: [] });
    });
    db.pool.connect.mockResolvedValue(txClient);

    const res = await supertest(buildApp({ featureFlags: { manual_access_approval: true } }))
      .post('/api/v1/access-requests')
      .send(validCreatePayload({ request_type: 'contractor_access', request_id: 'req-1' }));

    expect(res.status).toBe(201);
    expect(res.body.access_request.status).toBe('pending_approval');
    expect(res.body.access_request.approval_required).toBe(true);
    expect(res.body.pass).toBeNull();
    expect(txClient.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO passes'))).toBe(false);
  });

  test('missing contractor mapping returns 403 on create', async () => {
    mockCurrentUser = { uid: 'missing-contractor', role: 'contractor' };
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await supertest(buildApp())
      .post('/api/v1/access-requests')
      .send(validCreatePayload({ request_type: 'contractor_access' }));

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Contractor identity is not mapped/);
  });

  test('staff approve writes approval, request status, pass, and uses staff_users.id', async () => {
    mockCurrentUser = { uid: 'legacy-staff-1', role: 'security' };
    const approved = accessRequestRow({ status: 'approved', approved_at: '2026-05-04T10:01:00.000Z' });
    const txClient = makeTxClient((sql) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return Promise.resolve({ rows: [] });
      if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: UUID_STAFF }] });
      if (sql.includes('FROM access_requests') && sql.includes('FOR UPDATE')) {
        return Promise.resolve({ rows: [{
          id: UUID_REQUEST,
          property_id: UUID_PROPERTY,
          request_type: 'guest_access',
          vehicle_id: null,
          starts_at: '2026-05-05T10:00:00.000Z',
          ends_at: '2026-05-05T12:00:00.000Z',
          status: 'pending_approval',
        }] });
      }
      if (sql.includes('INSERT INTO access_approvals')) return Promise.resolve({ rows: [] });
      if (sql.includes('UPDATE access_requests')) return Promise.resolve({ rows: [approved] });
      if (sql.includes('FROM access_policies')) return Promise.resolve({ rows: [allowPolicy()] });
      if (sql.includes('INSERT INTO passes')) {
        return Promise.resolve({ rows: [{
          id: UUID_PASS,
          pass_type: 'guest',
          status: 'active',
          valid_from: '2026-05-05T10:00:00.000Z',
          valid_until: '2026-05-05T12:00:00.000Z',
        }] });
      }
      return Promise.resolve({ rows: [] });
    });
    db.pool.connect.mockResolvedValue(txClient);
    db.query.mockResolvedValue({ rows: [{ property_id: UUID_PROPERTY }] });

    const res = await supertest(buildApp())
      .post(`/api/v1/access-requests/${UUID_REQUEST}/approve`)
      .send({ comment: 'ok' });

    expect(res.status).toBe(200);
    expect(res.body.access_request.status).toBe('approved');
    expect(res.body.pass.id).toBe(UUID_PASS);

    const approvalCall = txClient.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO access_approvals'));
    const passCall = txClient.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO passes'));
    expect(approvalCall[1]).toContain(UUID_STAFF);
    expect(passCall[1]).toContain(UUID_STAFF);
    expect(approvalCall[1]).not.toContain('legacy-staff-1');
    expect(passCall[1]).not.toContain('legacy-staff-1');
  });

  test('resident cannot approve own request', async () => {
    mockCurrentUser = { uid: 'legacy-resident-1', role: 'owner' };

    const res = await supertest(buildApp())
      .post(`/api/v1/access-requests/${UUID_REQUEST}/approve`)
      .send({ comment: 'nope' });

    expect(res.status).toBe(403);
    expect(db.pool.connect).not.toHaveBeenCalled();
  });

  test('missing staff mapping returns 403 before approve mutation', async () => {
    mockCurrentUser = { uid: 'missing-staff', role: 'security' };
    const txClient = makeTxClient((sql) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return Promise.resolve({ rows: [] });
      if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });
    db.pool.connect.mockResolvedValue(txClient);
    db.query.mockResolvedValue({ rows: [{ property_id: UUID_PROPERTY }] });

    const res = await supertest(buildApp())
      .post(`/api/v1/access-requests/${UUID_REQUEST}/approve`)
      .send({ comment: 'ok' });

    expect(res.status).toBe(403);
    expect(txClient.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO access_approvals'))).toBe(false);
    expect(txClient.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO passes'))).toBe(false);
  });

  test('invalid approve transition returns 409 and does not create pass', async () => {
    mockCurrentUser = { uid: 'legacy-staff-1', role: 'security' };
    const txClient = makeTxClient((sql) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return Promise.resolve({ rows: [] });
      if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: UUID_STAFF }] });
      if (sql.includes('FROM access_requests') && sql.includes('FOR UPDATE')) {
        return Promise.resolve({ rows: [{ status: 'rejected' }] });
      }
      throw new Error(`unexpected SQL: ${sql}`);
    });
    db.pool.connect.mockResolvedValue(txClient);
    db.query.mockResolvedValue({ rows: [{ property_id: UUID_PROPERTY }] });

    const res = await supertest(buildApp())
      .post(`/api/v1/access-requests/${UUID_REQUEST}/approve`)
      .send({ comment: 'late' });

    expect(res.status).toBe(409);
    expect(txClient.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO passes'))).toBe(false);
  });

  test('staff reject writes approval and rejected request status', async () => {
    mockCurrentUser = { uid: 'legacy-staff-1', role: 'concierge' };
    const rejected = accessRequestRow({ status: 'rejected', rejected_at: '2026-05-04T10:02:00.000Z' });
    const txClient = makeTxClient((sql) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return Promise.resolve({ rows: [] });
      if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: UUID_STAFF }] });
      if (sql.includes('FROM access_requests') && sql.includes('FOR UPDATE')) {
        return Promise.resolve({ rows: [{ status: 'pending_approval' }] });
      }
      if (sql.includes('INSERT INTO access_approvals')) return Promise.resolve({ rows: [] });
      if (sql.includes('UPDATE access_requests')) return Promise.resolve({ rows: [rejected] });
      return Promise.resolve({ rows: [] });
    });
    db.pool.connect.mockResolvedValue(txClient);
    db.query.mockResolvedValue({ rows: [{ property_id: UUID_PROPERTY }] });

    const res = await supertest(buildApp())
      .post(`/api/v1/access-requests/${UUID_REQUEST}/reject`)
      .send({ reason: 'not allowed today' });

    expect(res.status).toBe(200);
    expect(res.body.access_request.status).toBe('rejected');

    const approvalCall = txClient.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO access_approvals'));
    const updateCall = txClient.query.mock.calls.find(([sql]) => sql.includes('UPDATE access_requests'));
    expect(approvalCall[0]).toContain("'rejected'");
    expect(approvalCall[1]).toEqual([UUID_REQUEST, UUID_STAFF, 'not allowed today']);
    expect(updateCall[0]).toContain("status = 'rejected'");
  });

  test('security escalate writes approval and escalated request status', async () => {
    mockCurrentUser = { uid: 'legacy-security-1', role: 'security' };
    const escalated = accessRequestRow({ status: 'escalated' });
    const txClient = makeTxClient((sql) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return Promise.resolve({ rows: [] });
      if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: UUID_STAFF }] });
      if (sql.includes('FROM access_requests') && sql.includes('FOR UPDATE')) {
        return Promise.resolve({ rows: [{ status: 'pending_approval' }] });
      }
      if (sql.includes('INSERT INTO access_approvals')) return Promise.resolve({ rows: [] });
      if (sql.includes('UPDATE access_requests')) return Promise.resolve({ rows: [escalated] });
      return Promise.resolve({ rows: [] });
    });
    db.pool.connect.mockResolvedValue(txClient);
    db.query.mockResolvedValue({ rows: [{ property_id: UUID_PROPERTY }] });

    const res = await supertest(buildApp())
      .post(`/api/v1/access-requests/${UUID_REQUEST}/escalate`)
      .send({ comment: 'needs admin' });

    expect(res.status).toBe(200);
    expect(res.body.access_request.status).toBe('escalated');

    const approvalCall = txClient.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO access_approvals'));
    const updateCall = txClient.query.mock.calls.find(([sql]) => sql.includes('UPDATE access_requests'));
    expect(approvalCall[0]).toContain("'escalated'");
    expect(approvalCall[1]).toEqual([UUID_REQUEST, UUID_STAFF, 'needs admin']);
    expect(updateCall[0]).toContain("status = 'escalated'");
  });
});
