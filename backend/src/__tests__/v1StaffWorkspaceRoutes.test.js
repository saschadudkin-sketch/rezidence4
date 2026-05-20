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
const staffWorkspaceRouter = require('../v1/routes/staffWorkspace');

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const UUID_C = '33333333-3333-4333-8333-333333333333';

function buildApp({ property } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.db = db;
    if (property) req.property = property;
    next();
  });
  app.use('/api/v1/staff-workspace', staffWorkspaceRouter);
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
    status: 'pending',
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
    priority: 'emergency',
    sla_profile: 'emergency',
    first_response_due_at: new Date('2026-05-08T08:00:00Z'),
    resolution_due_at: new Date('2026-05-08T10:00:00Z'),
    emergency_metadata: {},
    assigned_to_uid: null,
    assigned_to_name: null,
    assigned_to_role: null,
    assigned_at: null,
    first_response_at: null,
    resolved_at: null,
    completed_at: null,
    sla_state: 'emergency_escalated',
    escalation_level: 1,
    escalated_at: new Date('2026-05-08T08:05:00Z'),
    escalation_reason: 'first_response_overdue',
    last_sla_check_at: new Date('2026-05-08T08:05:00Z'),
    created_at: new Date('2026-05-08T07:00:00Z'),
    updated_at: new Date('2026-05-08T08:05:00Z'),
    resident_updates_count: 1,
    internal_comments_count: 2,
    sla_events_count: 1,
    total_count: '1',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = null;
  db.query.mockResolvedValue({ rows: [] });
});

describe('v1 staff workspace routes', () => {
  test('GET /inbox returns filtered overdue operational queue', async () => {
    mockCurrentUser = { uid: 'concierge-1', role: 'concierge' };
    db.query.mockResolvedValueOnce({ rows: [requestRow()] });

    const res = await supertest(buildApp({ property: { id: UUID_B, slug: 'demo', property_type: 'cottage_community' } }))
      .get(`/api/v1/staff-workspace/inbox?queue=overdue&category=plumber&target_type=unit&target_id=${UUID_A}&limit=10`);

    expect(res.status).toBe(200);
    expect(res.body.requests).toHaveLength(1);
    expect(res.body.requests[0]).toMatchObject({
      id: 'req-1',
      category: 'plumber',
      priority: 'emergency',
      isOverdue: true,
    });
    expect(res.body.property.type).toBe('cottage_community');
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('resident_ref.property_id');
    expect(sql).toContain("r.sla_state IN ('escalated','emergency_escalated')");
    expect(sql).toContain('r.category');
    expect(sql).toContain('r.target_type');
    expect(params).toContain(UUID_B);
    expect(params).toContain('plumber');
    expect(params).toContain('unit');
    expect(params).toContain(UUID_A);
  });

  test('GET /inbox rejects residents before querying', async () => {
    mockCurrentUser = { uid: 'resident-1', role: 'owner' };

    const res = await supertest(buildApp())
      .get('/api/v1/staff-workspace/inbox');

    expect(res.status).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('POST /requests/:id/internal-comments stores internal-only comment', async () => {
    mockCurrentUser = { uid: 'security-1', role: 'security', name: 'Охрана' };
    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM requests') && sql.includes('LIMIT 1')) {
        return Promise.resolve({ rows: [requestRow()] });
      }
      if (sql.includes('FROM request_attachments')) return Promise.resolve({ rows: [] });
      if (sql.includes("visibility='resident'")) return Promise.resolve({ rows: [] });
      if (sql.includes("visibility='internal'")) return Promise.resolve({ rows: [] });
      if (sql.includes('FROM request_sla_events')) return Promise.resolve({ rows: [] });
      if (sql.includes('INSERT INTO request_updates')) {
        return Promise.resolve({
          rows: [{
            id: UUID_C,
            request_id: 'req-1',
            actor_uid: 'security-1',
            actor_name: 'Охрана',
            actor_role: 'security',
            body: 'Вызвали аварийную бригаду',
            visibility: 'internal',
            attachment_ids: [],
            created_at: new Date('2026-05-08T09:00:00Z'),
          }],
        });
      }
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const res = await supertest(buildApp({ property: { id: UUID_B } }))
      .post('/api/v1/staff-workspace/requests/req-1/internal-comments')
      .send({ body: 'Вызвали аварийную бригаду' });

    expect(res.status).toBe(201);
    expect(res.body.comment.visibility).toBe('internal');
    const detailCall = db.query.mock.calls.find(([sql]) => sql.includes('FROM requests') && sql.includes('LIMIT 1'));
    expect(detailCall[0]).toContain('resident_ref.property_id = $2');
    expect(detailCall[1]).toEqual(['req-1', UUID_B]);
    const insertCall = db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO request_updates'));
    expect(insertCall[0]).toContain("'internal'");
  });

  test('GET /residents/:id/quick-view hides phone from security role', async () => {
    mockCurrentUser = { uid: 'security-1', role: 'security' };
    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM residents r')) {
        return Promise.resolve({
          rows: [{
            id: UUID_A,
            external_uid: 'resident-uid-1',
            property_id: UUID_B,
            unit_id: UUID_C,
            full_name: 'Иван',
            phone: '+79990001122',
            email: 'ivan@example.test',
            role: 'resident',
            resident_type: 'owner',
            is_active: true,
            unit_number: '12',
            unit_type: 'apartment',
            floor: 3,
            building_id: 'b1',
            building_name: 'Корпус 1',
            building_code: 'B1',
            entrance_id: 'e1',
            entrance_name: 'Подъезд 1',
            entrance_code: '1',
          }],
        });
      }
      if (sql.includes('FROM vehicles')) return Promise.resolve({ rows: [{ id: 'veh-1', plate_number: 'A001AA77' }] });
      if (sql.includes('GROUP BY status')) return Promise.resolve({ rows: [{ status: 'pending', count: 2 }] });
      if (sql.includes('FROM requests')) return Promise.resolve({ rows: [requestRow()] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const res = await supertest(buildApp({ property: { id: UUID_B } }))
      .get(`/api/v1/staff-workspace/residents/${UUID_A}/quick-view`);

    expect(res.status).toBe(200);
    expect(res.body.resident.phone).toBeNull();
    expect(res.body.vehicles[0].plate_number).toBe('A001AA77');
    expect(res.body.requestCounts.pending).toBe(2);
    const residentCall = db.query.mock.calls.find(([sql]) => sql.includes('FROM residents r'));
    expect(residentCall[0]).toContain('r.property_id = $2');
    expect(residentCall[0]).toContain('e.building_id = u.building_id');
    expect(residentCall[0]).not.toContain('e.property_id');
    expect(residentCall[1]).toEqual([UUID_A, UUID_B]);
    const vehiclesCall = db.query.mock.calls.find(([sql]) => sql.includes('FROM vehicles'));
    expect(vehiclesCall[0]).toContain('property_id = $2');
    expect(vehiclesCall[1]).toEqual([UUID_A, UUID_B]);
    const countsCall = db.query.mock.calls.find(([sql]) => sql.includes('GROUP BY status'));
    expect(countsCall[0]).toContain('scoped_resident.property_id = $2');
    expect(countsCall[1]).toEqual(['resident-uid-1', UUID_B]);
    const recentRequestsCall = db.query.mock.calls.find(
      ([sql]) => sql.includes('FROM requests') && sql.includes('ORDER BY created_at DESC'),
    );
    expect(recentRequestsCall[0]).toContain('scoped_resident.property_id = $2');
    expect(recentRequestsCall[1]).toEqual(['resident-uid-1', UUID_B]);
  });

  test('GET /residents/:id/quick-view shows phone to concierge', async () => {
    mockCurrentUser = { uid: 'concierge-1', role: 'concierge' };
    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM residents r')) {
        return Promise.resolve({
          rows: [{
            id: UUID_A,
            external_uid: null,
            property_id: UUID_B,
            unit_id: UUID_C,
            full_name: 'Иван',
            phone: '+79990001122',
            email: null,
            role: 'resident',
            resident_type: 'owner',
            is_active: true,
            unit_number: '12',
            unit_type: 'apartment',
            floor: null,
            building_id: null,
            building_name: null,
            building_code: null,
            entrance_id: null,
            entrance_name: null,
            entrance_code: null,
          }],
        });
      }
      if (sql.includes('FROM vehicles')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const res = await supertest(buildApp({ property: { id: UUID_B } }))
      .get(`/api/v1/staff-workspace/residents/${UUID_A}/quick-view`);

    expect(res.status).toBe(200);
    expect(res.body.resident.phone).toBe('+79990001122');
  });
});
