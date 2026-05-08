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
const technicianWorkspaceRouter = require('../v1/routes/technicianWorkspace');

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.db = db;
    next();
  });
  app.use('/api/v1/technician-workspace', technicianWorkspaceRouter);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    res.status(500).json({ error: String(err && err.message || err) });
  });
  return app;
}

function requestRow(overrides = {}) {
  return {
    id: 'req-1',
    type: 'service',
    category: 'plumber',
    status: 'accepted',
    created_by_uid: 'resident-uid-1',
    created_by_name: 'Иван',
    created_by_role: 'owner',
    created_by_apt: '12',
    visitor_name: null,
    visitor_phone: null,
    car_plate: null,
    comment: 'Протечка',
    pass_duration: 'once',
    valid_until: null,
    scheduled_for: null,
    arrived_at: null,
    photos: [],
    request_category_id: null,
    target_type: 'unit',
    target_id: UUID_A,
    priority: 'high',
    sla_profile: 'urgent',
    first_response_due_at: new Date('2026-05-08T08:00:00Z'),
    resolution_due_at: new Date('2026-05-08T10:00:00Z'),
    emergency_metadata: {},
    assigned_to_uid: 'tech-1',
    assigned_to_name: 'Техник',
    assigned_to_role: 'technician',
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
    resident_id: UUID_B,
    resident_updates_count: 1,
    internal_comments_count: 0,
    sla_events_count: 0,
    technician_events_count: 0,
    total_count: '1',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = null;
  db.query.mockResolvedValue({ rows: [] });
});

describe('v1 technician workspace routes', () => {
  test('GET /queue returns assigned technician work and scopes SQL to current technician', async () => {
    mockCurrentUser = { uid: 'tech-1', role: 'technician', name: 'Техник' };
    db.query.mockResolvedValueOnce({ rows: [requestRow()] });

    const res = await supertest(buildApp())
      .get('/api/v1/technician-workspace/queue?limit=10');

    expect(res.status).toBe(200);
    expect(res.body.requests).toHaveLength(1);
    expect(res.body.requests[0]).toMatchObject({
      id: 'req-1',
      assignedToUid: 'tech-1',
      assignedToRole: 'technician',
      resident: { id: UUID_B, uid: 'resident-uid-1' },
    });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('r.assigned_to_uid');
    expect(sql).toContain("r.assigned_to_role = 'technician'");
    expect(sql).toContain('request_technician_events');
    expect(params).toContain('tech-1');
  });

  test('GET /queue denies non-technician staff before querying', async () => {
    mockCurrentUser = { uid: 'concierge-1', role: 'concierge' };

    const res = await supertest(buildApp())
      .get('/api/v1/technician-workspace/queue');

    expect(res.status).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('POST /requests/:id/claim assigns available work to current technician and writes KPI event', async () => {
    mockCurrentUser = { uid: 'tech-1', role: 'technician', name: 'Техник' };
    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM requests r') && sql.includes('LIMIT 1')) {
        return Promise.resolve({
          rows: [requestRow({
            status: 'pending',
            assigned_to_uid: null,
            assigned_to_name: null,
            assigned_to_role: null,
            assigned_at: null,
          })],
        });
      }
      if (sql.includes('UPDATE requests') && sql.includes("assigned_to_role='technician'")) {
        return Promise.resolve({
          rows: [requestRow({
            status: 'accepted',
            assigned_to_uid: 'tech-1',
            assigned_to_name: 'Техник',
            assigned_to_role: 'technician',
          })],
        });
      }
      if (sql.includes('INSERT INTO request_technician_events')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const res = await supertest(buildApp())
      .post('/api/v1/technician-workspace/requests/req-1/claim');

    expect(res.status).toBe(200);
    expect(res.body.request.status).toBe('accepted');
    expect(res.body.request.assignedToUid).toBe('tech-1');
    const eventCall = db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO request_technician_events'));
    expect(eventCall[1]).toContain('claimed');
  });

  test('POST /requests/:id/start moves assigned work to in_progress and marks first response', async () => {
    mockCurrentUser = { uid: 'tech-1', role: 'technician', name: 'Техник' };
    const startedAt = new Date('2026-05-08T08:05:00Z');
    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM requests r') && sql.includes('LIMIT 1')) {
        return Promise.resolve({ rows: [requestRow({ status: 'accepted' })] });
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
      if (sql.includes('INSERT INTO request_technician_events')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const res = await supertest(buildApp())
      .post('/api/v1/technician-workspace/requests/req-1/start');

    expect(res.status).toBe(200);
    expect(res.body.request.status).toBe('in_progress');
    expect(res.body.request.startedAt).toBe(startedAt.toISOString());
    expect(res.body.request.firstResponseAt).toBe(startedAt.toISOString());
    const eventCall = db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO request_technician_events'));
    expect(eventCall[1]).toContain('started');
  });

  test('POST /requests/:id/waiting stores waiting_parts transition and internal note', async () => {
    mockCurrentUser = { uid: 'tech-1', role: 'technician', name: 'Техник' };
    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM requests r') && sql.includes('LIMIT 1')) {
        return Promise.resolve({ rows: [requestRow({ status: 'in_progress' })] });
      }
      if (sql.includes('UPDATE requests') && sql.includes('status=$1')) {
        return Promise.resolve({ rows: [requestRow({ status: 'waiting_parts' })] });
      }
      if (sql.includes('INSERT INTO request_updates')) {
        return Promise.resolve({
          rows: [{
            id: UUID_A,
            request_id: 'req-1',
            actor_uid: 'tech-1',
            actor_name: 'Техник',
            actor_role: 'technician',
            body: 'Нужен смеситель',
            visibility: 'internal',
            attachment_ids: [],
            created_at: new Date('2026-05-08T08:20:00Z'),
          }],
        });
      }
      if (sql.includes('INSERT INTO request_technician_events')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const res = await supertest(buildApp())
      .post('/api/v1/technician-workspace/requests/req-1/waiting')
      .send({ reason: 'parts', note: 'Нужен смеситель' });

    expect(res.status).toBe(200);
    expect(res.body.request.status).toBe('waiting_parts');
    const commentCall = db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO request_updates'));
    expect(commentCall[1]).toContain('Нужен смеситель');
    const eventCall = db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO request_technician_events'));
    expect(eventCall[1]).toContain('waiting_parts');
  });

  test('POST /requests/:id/resolve persists resolution output and result attachments', async () => {
    mockCurrentUser = { uid: 'tech-1', role: 'technician', name: 'Техник' };
    const resolvedAt = new Date('2026-05-08T09:00:00Z');
    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM requests r') && sql.includes('LIMIT 1')) {
        return Promise.resolve({ rows: [requestRow({ status: 'in_progress' })] });
      }
      if (sql.includes("SET status='resolved'")) {
        return Promise.resolve({
          rows: [requestRow({
            status: 'resolved',
            resolved_at: resolvedAt,
            resolution_note: 'Заменили смеситель',
            requires_follow_up: true,
            sla_state: 'resolved',
          })],
        });
      }
      if (sql.includes('INSERT INTO request_updates')) {
        return Promise.resolve({
          rows: [{
            id: UUID_B,
            request_id: 'req-1',
            actor_uid: 'tech-1',
            actor_name: 'Техник',
            actor_role: 'technician',
            body: 'Заменили смеситель',
            visibility: 'internal',
            attachment_ids: [UUID_A],
            created_at: resolvedAt,
          }],
        });
      }
      if (sql.includes('INSERT INTO request_technician_events')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const res = await supertest(buildApp())
      .post('/api/v1/technician-workspace/requests/req-1/resolve')
      .send({
        resolutionNote: 'Заменили смеситель',
        requiresFollowUp: true,
        attachmentIds: [UUID_A],
      });

    expect(res.status).toBe(200);
    expect(res.body.request.status).toBe('resolved');
    expect(res.body.request.resolutionNote).toBe('Заменили смеситель');
    expect(res.body.request.requiresFollowUp).toBe(true);
    const updateCall = db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO request_updates'));
    expect(updateCall[1][5]).toContain(UUID_A);
    const eventCall = db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO request_technician_events'));
    expect(eventCall[1]).toContain('resolved');
  });

  test('GET /requests/:id blocks technician from another technician assignment', async () => {
    mockCurrentUser = { uid: 'tech-1', role: 'technician', name: 'Техник' };
    db.query.mockResolvedValueOnce({
      rows: [requestRow({ assigned_to_uid: 'tech-2', assigned_to_name: 'Другой техник' })],
    });

    const res = await supertest(buildApp())
      .get('/api/v1/technician-workspace/requests/req-1');

    expect(res.status).toBe(403);
    expect(db.query).toHaveBeenCalledTimes(1);
  });
});
