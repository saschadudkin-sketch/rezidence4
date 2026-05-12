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
    expect(res.body.priorities).toEqual(expect.arrayContaining(['normal', 'urgent']));
    expect(res.body.escalation_statuses).toEqual(expect.arrayContaining(['none', 'overdue']));
    expect(res.body.report_evidence_types).toEqual(expect.arrayContaining(['summary', 'live_rollout']));
  });

  test('summary endpoint returns sensitive review queue totals', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'property_admin' };
    db.query.mockResolvedValueOnce({
      rows: [
        { review_status: 'pending', priority: 'urgent', total: 2, overdue: 1 },
        { review_status: 'approved', priority: 'normal', total: 3, overdue: 0 },
      ],
    });

    const res = await supertest(buildApp())
      .get(`/api/v1/audit/sensitive-actions/_summary?property_id=${UUID_PROPERTY}`);

    expect(res.status).toBe(200);
    expect(res.body.summary.totals).toEqual({
      total: 5,
      overdue: 1,
      by_status: { pending: 2, approved: 3 },
      by_priority: { urgent: 2, normal: 3 },
    });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('GROUP BY 1, 2');
    expect(sql).toContain('COUNT(*) FILTER');
    expect(params[1]).toBe(UUID_PROPERTY);
  });

  test('anti-abuse endpoint returns actor hotspots', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'property_admin' };
    db.query.mockResolvedValueOnce({
      rows: [{
        actor_uid: 'guard-1',
        actor_role: 'security',
        category: 'manual_override',
        total_actions: 6,
        high_risk_actions: 6,
        pending_reviews: 3,
        overdue_reviews: 1,
        off_hours_actions: 2,
        distinct_resources: 4,
      }],
    });

    const res = await supertest(buildApp())
      .get(`/api/v1/audit/sensitive-actions/_anti-abuse?property_id=${UUID_PROPERTY}&window_hours=72&min_actions=5`);

    expect(res.status).toBe(200);
    expect(res.body.analytics.summary).toMatchObject({
      total_findings: 1,
      actors: 1,
      overdue_reviews: 1,
    });
    expect(res.body.analytics.findings[0].flags).toEqual(expect.arrayContaining(['high_volume', 'off_hours']));
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('off_hours_actions');
    expect(sql).toContain('overdue_reviews');
    expect(params).toEqual(expect.arrayContaining(['72', 5, UUID_PROPERTY]));
  });

  test('report evidence endpoints record and list live DH-60 report evidence', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'property_admin', property_id: UUID_PROPERTY };
    db.query
      .mockResolvedValueOnce({
        rows: [{
          id: 'report-1',
          property_id: UUID_PROPERTY,
          report_type: 'live_rollout',
          status: 'generated',
          summary: { reviewers: 2 },
          generated_by_uid: 'admin-1',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 'report-1',
          property_id: UUID_PROPERTY,
          report_type: 'live_rollout',
          status: 'generated',
          summary: { reviewers: 2 },
          generated_by_uid: 'admin-1',
        }],
      });

    const createRes = await supertest(buildApp())
      .post('/api/v1/audit/sensitive-actions/_report-evidence')
      .send({
        property_id: UUID_PROPERTY,
        report_type: 'live_rollout',
        summary: { reviewers: 2 },
      });
    const listRes = await supertest(buildApp())
      .get(`/api/v1/audit/sensitive-actions/_report-evidence?property_id=${UUID_PROPERTY}&report_type=live_rollout`);

    expect(createRes.status).toBe(201);
    expect(createRes.body.evidence).toMatchObject({ report_type: 'live_rollout' });
    expect(listRes.status).toBe(200);
    expect(listRes.body.evidence).toHaveLength(1);
    expect(db.query.mock.calls[0][0]).toContain('INSERT INTO sensitive_action_report_evidence');
    expect(db.query.mock.calls[1][0]).toContain('FROM sensitive_action_report_evidence');
  });

  test('manual sample endpoint materializes review rows', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'property_admin' };
    db.query.mockResolvedValueOnce({
      rows: [{ id: 'review-1', audit_log_id: UUID_AUDIT, priority: 'urgent' }],
    });

    const res = await supertest(buildApp())
      .post('/api/v1/audit/sensitive-actions/_sample')
      .send({
        property_id: UUID_PROPERTY,
        category: 'manual_override',
        window_hours: 24,
        sample_percent: 100,
        due_hours: 48,
        limit: 20,
      });

    expect(res.status).toBe(201);
    expect(res.body.sampled_count).toBe(1);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('auto-sampled by DH-60 review rules');
    expect(sql).toContain('ON CONFLICT (audit_log_id) DO NOTHING');
    expect(params).toEqual(expect.arrayContaining(['24', 100, 20, '48', UUID_PROPERTY]));
  });

  test('manual escalation endpoint marks overdue review rows', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'property_admin' };
    db.query.mockResolvedValueOnce({
      rows: [
        { id: 'review-1', escalation_status: 'overdue' },
        { id: 'review-2', escalation_status: 'escalated' },
      ],
    });

    const res = await supertest(buildApp())
      .post('/api/v1/audit/sensitive-actions/_escalate')
      .send({
        property_id: UUID_PROPERTY,
        limit: 10,
        escalate_after_hours: 12,
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      escalated_count: 2,
      overdue_count: 1,
      hard_escalated_count: 1,
    });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).toContain("THEN 'escalated'");
    expect(sql).toContain('INSERT INTO notifications_outbox');
    expect(sql).toContain('audit.sensitive_review.escalated');
    expect(params).toEqual(['12', 10, UUID_PROPERTY]);
  });

  test('list can filter assigned and overdue review queue items', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'property_admin' };

    const res = await supertest(buildApp())
      .get('/api/v1/audit/sensitive-actions')
      .query({
        assigned_reviewer_staff_id: UUID_STAFF,
        priority: 'urgent',
        escalation_status: 'overdue',
        overdue: 'true',
      });

    expect(res.status).toBe(200);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('r.assigned_reviewer_staff_id');
    expect(sql).toContain("COALESCE(r.priority, 'normal')");
    expect(sql).toContain("COALESCE(r.escalation_status, 'none')");
    expect(sql).toContain('r.due_at < NOW()');
    expect(params).toEqual(expect.arrayContaining([UUID_STAFF, 'urgent', 'overdue']));
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

  test('property admin can assign a sensitive action review with SLA fields', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'property_admin' };
    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM staff_users') && sql.includes('external_uid')) {
        return Promise.resolve({ rows: [{ id: UUID_STAFF }] });
      }
      if (sql.includes('FROM staff_users') && sql.includes('WHERE id = $1')) {
        return Promise.resolve({ rows: [{ id: UUID_STAFF, property_id: UUID_PROPERTY, role: 'property_admin' }] });
      }
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
            review_status: 'pending',
            assigned_reviewer_staff_id: UUID_STAFF,
            assigned_by_staff_id: UUID_STAFF,
            due_at: '2026-05-12T10:00:00.000Z',
            priority: 'urgent',
            assignment_reason: 'weekly override sample',
          }],
        });
      }
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const res = await supertest(buildApp())
      .post(`/api/v1/audit/sensitive-actions/${UUID_AUDIT}/assign`)
      .send({
        assigned_reviewer_staff_id: UUID_STAFF,
        due_at: '2026-05-12T10:00:00.000Z',
        priority: 'urgent',
        reason: 'weekly override sample',
      });

    expect(res.status).toBe(200);
    expect(res.body.review).toMatchObject({
      assigned_reviewer_staff_id: UUID_STAFF,
      priority: 'urgent',
      assignment_reason: 'weekly override sample',
    });
    const insertCall = db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO sensitive_action_reviews'));
    expect(insertCall[0]).toContain('assigned_reviewer_staff_id');
    expect(insertCall[0]).toContain("WHERE sensitive_action_reviews.review_status = 'pending'");
    expect(insertCall[1]).toEqual(expect.arrayContaining([
      UUID_AUDIT,
      UUID_PROPERTY,
      'manual_override',
      'override.created',
      UUID_STAFF,
      UUID_STAFF,
      '2026-05-12T10:00:00.000Z',
      'urgent',
      'weekly override sample',
    ]));
  });
});
