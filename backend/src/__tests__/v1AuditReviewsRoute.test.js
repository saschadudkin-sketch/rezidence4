'use strict';

const express = require('express');
const supertest = require('supertest');

jest.mock('../db', () => ({
  query: jest.fn(),
}));

let mockCurrentUser = null;
jest.mock('../middleware/auth', () => (req, res, next) => {
  if (!mockCurrentUser) return res.status(401).json({ error: 'auth not set' });
  req.user = mockCurrentUser;
  next();
});

const db = require('../db');
const auditReviewsRouter = require('../v1/routes/auditReviews');

const UUID_PROPERTY = '11111111-1111-4111-8111-111111111111';
const UUID_AUDIT = '22222222-2222-4222-8222-222222222222';
const UUID_STAFF = '33333333-3333-4333-8333-333333333333';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/audit', auditReviewsRouter);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    res.status(500).json({ error: String(err && err.message || err) });
  });
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = null;
  db.query.mockResolvedValue({ rows: [] });
});

describe('v1 audit review route', () => {
  test('property admin can list sensitive actions with taxonomy metadata', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'property_admin' };
    db.query.mockResolvedValueOnce({
      rows: [{
        id: 'audit-1',
        property_id: UUID_PROPERTY,
        actor_uid: 'guard-1',
        actor_role: 'security',
        actor_type: 'staff',
        action: 'override.created',
        resource_type: 'access_override',
        resource_id: 'override-1',
        entity_type: null,
        entity_id: null,
        changes: { override_type: 'manual_admit' },
        ip_address: '127.0.0.1',
        created_at: '2026-05-05T10:00:00.000Z',
      }],
    });

    const res = await supertest(buildApp())
      .get('/api/v1/audit/sensitive-actions?category=manual_override&limit=10');

    expect(res.status).toBe(200);
    expect(res.body.actions).toHaveLength(1);
    expect(res.body.actions[0]).toMatchObject({
      id: 'audit-1',
      action: 'override.created',
      canonical_event_type: 'access.manual_override.created',
      category: 'manual_override',
      review_required: true,
    });

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('FROM property_audit_log');
    expect(sql).toContain('action = ANY($1::text[])');
    expect(params[0]).toEqual(expect.arrayContaining([
      'override.created',
      'access.manual_override.created',
    ]));
    expect(params[params.length - 2]).toBe(10);
    expect(params[params.length - 1]).toBe(0);
  });

  test('filters by property, actor, resource type and time range without dynamic SQL values', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'property_admin' };

    const res = await supertest(buildApp())
      .get('/api/v1/audit/sensitive-actions')
      .query({
        property_id: UUID_PROPERTY,
        actor_uid: 'guard-1',
        resource_type: 'vehicle',
        from: '2026-05-05T00:00:00.000Z',
        to: '2026-05-06T00:00:00.000Z',
      });

    expect(res.status).toBe(200);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('property_id = $2');
    expect(sql).toContain('actor_uid = $3');
    expect(sql).toContain('resource_type = $4');
    expect(sql).toContain('created_at >= $5');
    expect(sql).toContain('created_at <= $6');
    expect(params.slice(1, 6)).toEqual([
      UUID_PROPERTY,
      'guard-1',
      'vehicle',
      '2026-05-05T00:00:00.000Z',
      '2026-05-06T00:00:00.000Z',
    ]);
  });

  test('security users cannot read sensitive action review reports', async () => {
    mockCurrentUser = { uid: 'guard-1', role: 'security' };

    const res = await supertest(buildApp())
      .get('/api/v1/audit/sensitive-actions');

    expect(res.status).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('invalid category returns available categories', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'property_admin' };

    const res = await supertest(buildApp())
      .get('/api/v1/audit/sensitive-actions?category=unknown');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid category');
    expect(res.body.categories).toEqual(expect.arrayContaining(['manual_override']));
  });

  test('metadata endpoint exposes review catalog', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'property_admin' };

    const res = await supertest(buildApp())
      .get('/api/v1/audit/sensitive-actions/_meta');

    expect(res.status).toBe(200);
    expect(res.body.categories).toEqual(expect.arrayContaining(['manual_override', 'permission_change']));
    expect(res.body.actions).toEqual(expect.arrayContaining(['override.created', 'staff.updated']));
  });

  test('property admin can attest a sensitive action review', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'property_admin' };
    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: UUID_STAFF }] });
      if (sql.includes('FROM property_audit_log')) {
        return Promise.resolve({
          rows: [{
            id: UUID_AUDIT,
            property_id: UUID_PROPERTY,
            actor_uid: 'guard-1',
            actor_role: 'security',
            actor_type: 'staff',
            action: 'override.created',
            resource_type: 'access_override',
            resource_id: 'override-1',
            entity_type: null,
            entity_id: null,
            changes: {},
            ip_address: '127.0.0.1',
            created_at: '2026-05-05T10:00:00.000Z',
          }],
        });
      }
      if (sql.includes('INSERT INTO sensitive_action_reviews')) {
        return Promise.resolve({
          rows: [{
            id: 'review-1',
            audit_log_id: UUID_AUDIT,
            review_status: 'approved',
            reviewer_staff_id: UUID_STAFF,
            comment: 'checked',
          }],
        });
      }
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const res = await supertest(buildApp())
      .post(`/api/v1/audit/sensitive-actions/${UUID_AUDIT}/review`)
      .send({ decision: 'approved', comment: 'checked' });

    expect(res.status).toBe(200);
    expect(res.body.review.review_status).toBe('approved');
    const insertCall = db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO sensitive_action_reviews'));
    expect(insertCall[1]).toEqual(expect.arrayContaining([
      UUID_AUDIT,
      UUID_PROPERTY,
      'manual_override',
      'override.created',
      'access_override',
      'override-1',
      'approved',
    ]));
  });
});
