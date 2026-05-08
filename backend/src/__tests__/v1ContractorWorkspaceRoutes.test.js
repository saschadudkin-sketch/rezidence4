'use strict';

const { describe, test, expect, beforeEach } = require('@jest/globals');
const express = require('express');
const supertest = require('supertest');

jest.mock('../db', () => ({
  query: jest.fn(),
}));
jest.mock('../logger', () => require('../__mocks__/logger'));

let mockCurrentUser = null;
jest.mock('../middleware/auth', () => (req, res, next) => {
  if (!mockCurrentUser) return res.status(401).json({ error: 'auth not set' });
  req.user = mockCurrentUser;
  next();
});

const db = require('../db');
const contractorWorkspaceRouter = require('../v1/routes/contractorWorkspace');

const UUID_CONTRACTOR = '11111111-1111-4111-8111-111111111111';
const UUID_COMPANY = '22222222-2222-4222-8222-222222222222';
const UUID_TARGET = '33333333-3333-4333-8333-333333333333';
const UUID_RESIDENT = '44444444-4444-4444-8444-444444444444';
const UUID_ATTACHMENT = '55555555-5555-4555-8555-555555555555';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.db = db;
    next();
  });
  app.use('/api/v1/contractor-workspace', contractorWorkspaceRouter);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    res.status(500).json({ error: String(err && err.message || err) });
  });
  return app;
}

function contractorProfileRow(overrides = {}) {
  return {
    id: UUID_CONTRACTOR,
    contractor_company_id: UUID_COMPANY,
    property_id: 'prop-1',
    full_name: 'External Plumber',
    external_uid: 'contractor-1',
    access_expires_at: new Date('2026-12-31T20:59:00Z'),
    is_active: true,
    company_name: 'Pipe LLC',
    company_status: 'active',
    ...overrides,
  };
}

function requestRow(overrides = {}) {
  return {
    id: 'req-1',
    type: 'service',
    category: 'plumber',
    status: 'assigned',
    created_by_uid: 'resident-uid-1',
    created_by_name: 'Ivan',
    created_by_role: 'owner',
    created_by_apt: '12',
    visitor_name: null,
    visitor_phone: '+79990000000',
    car_plate: null,
    comment: 'Bathroom leak',
    pass_duration: 'once',
    valid_until: null,
    scheduled_for: null,
    arrived_at: null,
    photos: [],
    request_category_id: null,
    target_type: 'unit',
    target_id: UUID_TARGET,
    priority: 'high',
    sla_profile: 'urgent',
    first_response_due_at: new Date('2026-05-08T08:00:00Z'),
    resolution_due_at: new Date('2026-05-08T10:00:00Z'),
    emergency_metadata: {},
    assigned_to_uid: 'contractor-1',
    assigned_to_name: 'External Plumber',
    assigned_to_role: 'contractor',
    assigned_contractor_user_id: UUID_CONTRACTOR,
    assigned_contractor_company_id: UUID_COMPANY,
    assigned_at: new Date('2026-05-08T07:15:00Z'),
    started_at: null,
    first_response_at: null,
    resolved_at: null,
    completed_at: null,
    resolution_note: null,
    requires_follow_up: false,
    sla_state: 'on_track',
    escalation_level: 0,
    escalated_at: null,
    escalation_reason: null,
    last_sla_check_at: null,
    created_at: new Date('2026-05-08T07:00:00Z'),
    updated_at: new Date('2026-05-08T07:15:00Z'),
    resident_id: UUID_RESIDENT,
    contractor_user_id: UUID_CONTRACTOR,
    contractor_full_name: 'External Plumber',
    contractor_external_uid: 'contractor-1',
    contractor_access_expires_at: new Date('2026-12-31T20:59:00Z'),
    contractor_company_id: UUID_COMPANY,
    contractor_company_name: 'Pipe LLC',
    contractor_company_status: 'active',
    resident_updates_count: 1,
    contractor_events_count: 0,
    total_count: '1',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = null;
  db.query.mockResolvedValue({ rows: [] });
});

describe('v1 contractor workspace routes', () => {
  test('GET /queue returns current contractor work and validates active non-expired profile', async () => {
    mockCurrentUser = { uid: 'contractor-1', role: 'contractor', name: 'External Plumber' };
    db.query
      .mockResolvedValueOnce({ rows: [contractorProfileRow()] })
      .mockResolvedValueOnce({ rows: [requestRow()] });

    const res = await supertest(buildApp())
      .get('/api/v1/contractor-workspace/queue?limit=10');

    expect(res.status).toBe(200);
    expect(res.body.requests).toHaveLength(1);
    expect(res.body.requests[0]).toMatchObject({
      id: 'req-1',
      assignedToRole: 'contractor',
      assignedContractorUserId: UUID_CONTRACTOR,
      contractor: { id: UUID_CONTRACTOR, companyId: UUID_COMPANY },
    });
    const [profileSql, profileParams] = db.query.mock.calls[0];
    expect(profileSql).toContain('access_expires_at IS NULL OR cu.access_expires_at > NOW()');
    expect(profileParams).toContain('contractor-1');
    const [queueSql, queueParams] = db.query.mock.calls[1];
    expect(queueSql).toContain("r.assigned_to_role = 'contractor'");
    expect(queueSql).toContain('r.assigned_contractor_user_id');
    expect(queueSql).toContain('request_contractor_events');
    expect(queueParams).toContain(UUID_CONTRACTOR);
  });

  test('GET /queue denies contractor with missing or expired profile before listing', async () => {
    mockCurrentUser = { uid: 'expired-contractor', role: 'contractor' };
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await supertest(buildApp())
      .get('/api/v1/contractor-workspace/queue');

    expect(res.status).toBe(403);
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  test('GET /queue denies technician before querying', async () => {
    mockCurrentUser = { uid: 'tech-1', role: 'technician' };

    const res = await supertest(buildApp())
      .get('/api/v1/contractor-workspace/queue');

    expect(res.status).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('POST /requests/:id/assign binds request to active contractor user and writes event', async () => {
    mockCurrentUser = { uid: 'concierge-1', role: 'concierge', name: 'Concierge' };
    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM requests r') && sql.includes('LIMIT 1')) {
        return Promise.resolve({
          rows: [requestRow({
            status: 'waiting_contractor',
            assigned_to_uid: null,
            assigned_to_name: null,
            assigned_to_role: null,
            assigned_contractor_user_id: null,
            assigned_contractor_company_id: null,
          })],
        });
      }
      if (sql.includes('FROM contractor_users cu') && sql.includes('cu.id = $1')) {
        return Promise.resolve({ rows: [contractorProfileRow()] });
      }
      if (sql.includes('UPDATE requests') && sql.includes("assigned_to_role='contractor'")) {
        return Promise.resolve({ rows: [requestRow({ status: 'assigned' })] });
      }
      if (sql.includes('INSERT INTO request_updates')) {
        return Promise.resolve({
          rows: [{
            id: UUID_ATTACHMENT,
            request_id: 'req-1',
            actor_uid: 'concierge-1',
            actor_name: 'Concierge',
            actor_role: 'concierge',
            body: 'Dispatch Pipe LLC',
            visibility: 'internal',
            attachment_ids: [],
            created_at: new Date('2026-05-08T08:00:00Z'),
          }],
        });
      }
      if (sql.includes('INSERT INTO request_contractor_events')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const res = await supertest(buildApp())
      .post('/api/v1/contractor-workspace/requests/req-1/assign')
      .send({ contractorUserId: UUID_CONTRACTOR, note: 'Dispatch Pipe LLC' });

    expect(res.status).toBe(200);
    expect(res.body.request.status).toBe('assigned');
    expect(res.body.request.assignedContractorUserId).toBe(UUID_CONTRACTOR);
    const updateCall = db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO request_updates'));
    expect(updateCall[1]).toContain('Dispatch Pipe LLC');
    const eventCall = db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO request_contractor_events'));
    expect(eventCall[1]).toContain('assigned');
    expect(eventCall[1]).toContain(UUID_CONTRACTOR);
  });

  test('POST /requests/:id/assign rejects suspended contractor company', async () => {
    mockCurrentUser = { uid: 'concierge-1', role: 'concierge', name: 'Concierge' };
    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM requests r') && sql.includes('LIMIT 1')) {
        return Promise.resolve({ rows: [requestRow({ status: 'waiting_contractor' })] });
      }
      if (sql.includes('FROM contractor_users cu') && sql.includes('cu.id = $1')) {
        return Promise.resolve({
          rows: [contractorProfileRow({ company_status: 'suspended' })],
        });
      }
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const res = await supertest(buildApp())
      .post('/api/v1/contractor-workspace/requests/req-1/assign')
      .send({ contractor_user_id: UUID_CONTRACTOR });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/company is not active/i);
    expect(db.query.mock.calls.some(([sql]) => sql.includes('UPDATE requests'))).toBe(false);
  });

  test('POST /requests/:id/start moves assigned contractor work to in_progress', async () => {
    mockCurrentUser = { uid: 'contractor-1', role: 'contractor', name: 'External Plumber' };
    const startedAt = new Date('2026-05-08T08:05:00Z');
    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM contractor_users cu') && sql.includes('cu.external_uid = $1')) {
        return Promise.resolve({ rows: [contractorProfileRow()] });
      }
      if (sql.includes('FROM requests r') && sql.includes('LIMIT 1')) {
        return Promise.resolve({ rows: [requestRow({ status: 'assigned' })] });
      }
      if (sql.includes("SET status='in_progress'")) {
        return Promise.resolve({
          rows: [requestRow({
            status: 'in_progress',
            started_at: startedAt,
            first_response_at: startedAt,
            sla_state: 'responded',
          })],
        });
      }
      if (sql.includes('INSERT INTO request_contractor_events')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const res = await supertest(buildApp())
      .post('/api/v1/contractor-workspace/requests/req-1/start');

    expect(res.status).toBe(200);
    expect(res.body.request.status).toBe('in_progress');
    expect(res.body.request.startedAt).toBe(startedAt.toISOString());
    const eventCall = db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO request_contractor_events'));
    expect(eventCall[1]).toContain('started');
  });

  test('GET /requests/:id returns limited contractor detail without internal staff notes', async () => {
    mockCurrentUser = { uid: 'contractor-1', role: 'contractor', name: 'External Plumber' };
    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM contractor_users cu') && sql.includes('cu.external_uid = $1')) {
        return Promise.resolve({ rows: [contractorProfileRow()] });
      }
      if (sql.includes('FROM requests r') && sql.includes('LIMIT 1')) {
        return Promise.resolve({ rows: [requestRow({ status: 'in_progress' })] });
      }
      if (sql.includes('FROM request_attachments')) {
        return Promise.resolve({
          rows: [{
            id: UUID_ATTACHMENT,
            request_id: 'req-1',
            uploaded_by_uid: 'resident-uid-1',
            file_url: '/uploads/leak.jpg',
            file_kind: 'photo',
            visibility: 'resident',
            metadata: {},
            created_at: new Date('2026-05-08T08:00:00Z'),
          }],
        });
      }
      if (sql.includes('FROM request_updates') && sql.includes("visibility='resident'")) {
        return Promise.resolve({
          rows: [{
            id: UUID_ATTACHMENT,
            request_id: 'req-1',
            actor_uid: 'resident-uid-1',
            actor_name: 'Ivan',
            actor_role: 'owner',
            body: 'Door is open',
            visibility: 'resident',
            attachment_ids: [],
            created_at: new Date('2026-05-08T08:10:00Z'),
          }],
        });
      }
      if (sql.includes('FROM request_contractor_events')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const res = await supertest(buildApp())
      .get('/api/v1/contractor-workspace/requests/req-1');

    expect(res.status).toBe(200);
    expect(res.body.internalComments).toEqual([]);
    expect(res.body.slaEvents).toEqual([]);
    expect(res.body.residentUpdates[0].body).toBe('Door is open');
    const attachmentCall = db.query.mock.calls.find(([sql]) => sql.includes('FROM request_attachments'));
    expect(attachmentCall[0]).toContain("visibility='resident'");
    expect(db.query.mock.calls.some(([sql]) => sql.includes('FROM request_sla_events'))).toBe(false);
  });

  test('POST /requests/:id/resolve persists contractor resolution output and event', async () => {
    mockCurrentUser = { uid: 'contractor-1', role: 'contractor', name: 'External Plumber' };
    const resolvedAt = new Date('2026-05-08T09:00:00Z');
    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM contractor_users cu') && sql.includes('cu.external_uid = $1')) {
        return Promise.resolve({ rows: [contractorProfileRow()] });
      }
      if (sql.includes('FROM requests r') && sql.includes('LIMIT 1')) {
        return Promise.resolve({ rows: [requestRow({ status: 'in_progress' })] });
      }
      if (sql.includes("SET status='resolved'")) {
        return Promise.resolve({
          rows: [requestRow({
            status: 'resolved',
            resolved_at: resolvedAt,
            resolution_note: 'Replaced valve',
            requires_follow_up: true,
            sla_state: 'resolved',
          })],
        });
      }
      if (sql.includes('INSERT INTO request_updates')) {
        return Promise.resolve({
          rows: [{
            id: UUID_ATTACHMENT,
            request_id: 'req-1',
            actor_uid: 'contractor-1',
            actor_name: 'External Plumber',
            actor_role: 'contractor',
            body: 'Replaced valve',
            visibility: 'internal',
            attachment_ids: [UUID_ATTACHMENT],
            created_at: resolvedAt,
          }],
        });
      }
      if (sql.includes('INSERT INTO request_contractor_events')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const res = await supertest(buildApp())
      .post('/api/v1/contractor-workspace/requests/req-1/resolve')
      .send({
        resolutionNote: 'Replaced valve',
        requiresFollowUp: true,
        attachmentIds: [UUID_ATTACHMENT],
      });

    expect(res.status).toBe(200);
    expect(res.body.request.status).toBe('resolved');
    expect(res.body.request.resolutionNote).toBe('Replaced valve');
    const updateCall = db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO request_updates'));
    expect(updateCall[1][5]).toContain(UUID_ATTACHMENT);
    const eventCall = db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO request_contractor_events'));
    expect(eventCall[1]).toContain('resolved');
  });
});
