'use strict';

/**
 * Phase 5 (platform-v1) — notification_log_v2 HTTP endpoint tests.
 * Spec: docs/product/specs/platform-v1/notification-log-v2-spec.md §3.2.
 *
 * Scope:
 *   • /admin/notification-log (list)  — RBAC, anti-full-scan guard, ISO
 *                                       validation, since<=until, happy,
 *                                       filter passthrough, 503.
 *   • /admin/notification-log/metrics — period validation, ordering
 *                                       vs /:id, happy path per period.
 *   • /admin/notification-log/:id     — 404 semantics, happy path.
 *   • /notification-log/mine          — resident-only, empty when legacy
 *                                       user (no residents row), payload
 *                                       trim verification.
 *   • /notification-log/_meta         — returns LIMIT_MAX.
 *
 * Wiring:
 *   - Mock middleware/auth with mockCurrentUser closure (same pattern as
 *     v1OutboxRetryEndpoint.test.js).
 *   - Dispatch per-SQL in mockDb.query.mockImplementation to distinguish
 *     residents lookup from notification_log_v2 queries.
 *   - Mount router directly (not registerApiRoutes) to avoid pulling in
 *     the full v1 middleware graph.
 */

const { describe, test, expect, beforeEach } = require('@jest/globals');
const express = require('express');
const supertest = require('supertest');

jest.mock('../logger', () => require('../__mocks__/logger'));

let mockCurrentUser = null;
jest.mock('../middleware/auth', () => (req, res, next) => {
  if (!mockCurrentUser) return res.status(401).json({ error: 'unauth' });
  req.user = mockCurrentUser;
  next();
});

// Single mockDb shared across tests.  `query` is reset in beforeEach.
const mockDb = { query: jest.fn() };
jest.mock('../db', () => mockDb);

const notificationLogRouter = require('../v1/routes/notificationLog');
const { LIMIT_MAX } = require('../v1/services/notificationLog');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', notificationLogRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = null;
  mockDb.query.mockReset();
});

// Helper: dispatch per-SQL substring to fake different tables.
function dispatchQuery(handlers) {
  mockDb.query.mockImplementation((sql, args) => {
    for (const [needle, handler] of handlers) {
      if (sql.includes(needle)) return Promise.resolve(handler(args));
    }
    return Promise.resolve({ rows: [] });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /admin/notification-log — auth
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/v1/admin/notification-log — auth', () => {
  test('401 when unauthenticated', async () => {
    const res = await supertest(buildApp())
      .get('/api/v1/admin/notification-log?since=2026-04-01T00:00:00Z');
    expect(res.status).toBe(401);
  });

  test('403 for resident role', async () => {
    mockCurrentUser = { uid: 'r1', role: 'resident' };
    const res = await supertest(buildApp())
      .get('/api/v1/admin/notification-log?since=2026-04-01T00:00:00Z');
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'Admin only' });
  });

  test('403 for staff role', async () => {
    mockCurrentUser = { uid: 's1', role: 'security' };
    const res = await supertest(buildApp())
      .get('/api/v1/admin/notification-log?since=2026-04-01T00:00:00Z');
    expect(res.status).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /admin/notification-log — validation
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/v1/admin/notification-log — validation', () => {
  beforeEach(() => { mockCurrentUser = { uid: 'admin1', role: 'admin' }; });

  test('400 when no recipient_id AND no since AND no until (anti-full-scan)', async () => {
    const res = await supertest(buildApp()).get('/api/v1/admin/notification-log');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/since or until required/);
    expect(mockDb.query).not.toHaveBeenCalled();
  });

  test('400 on invalid since ISO', async () => {
    const res = await supertest(buildApp())
      .get('/api/v1/admin/notification-log?since=not-a-date');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/since must be ISO-8601/);
  });

  test('400 on invalid until ISO', async () => {
    const res = await supertest(buildApp())
      .get('/api/v1/admin/notification-log?until=garbage');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/until must be ISO-8601/);
  });

  test('400 when since > until', async () => {
    const res = await supertest(buildApp())
      .get('/api/v1/admin/notification-log?since=2026-05-01T00:00:00Z&until=2026-04-01T00:00:00Z');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/since must be <= until/);
  });

  test('200 when recipient_id provided without temporal filters (allowed — indexed)', async () => {
    mockDb.query.mockResolvedValue({ rows: [] });
    const res = await supertest(buildApp())
      .get('/api/v1/admin/notification-log?recipient_id=uuid-abc');
    expect(res.status).toBe(200);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /admin/notification-log — happy path + filter passthrough
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/v1/admin/notification-log — happy path', () => {
  beforeEach(() => { mockCurrentUser = { uid: 'admin1', role: 'admin' }; });

  test('200 with rows + limit/offset/count envelope', async () => {
    mockDb.query.mockResolvedValue({ rows: [
      { id: 'a', channel: 'sms', status: 'sent' },
      { id: 'b', channel: 'telegram', status: 'failed' },
    ] });
    const res = await supertest(buildApp())
      .get('/api/v1/admin/notification-log?since=2026-04-01T00:00:00Z&limit=10&offset=5');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      items: [
        { id: 'a', channel: 'sms', status: 'sent' },
        { id: 'b', channel: 'telegram', status: 'failed' },
      ],
      limit: 10,
      offset: 5,
      count: 2,
    });
  });

  test('passes recipient_type + channel + status + event_type into SQL', async () => {
    mockDb.query.mockResolvedValue({ rows: [] });
    await supertest(buildApp())
      .get('/api/v1/admin/notification-log')
      .query({
        recipient_id: 'r-abc',
        recipient_type: 'resident',
        channel: 'sms',
        status: 'sent',
        event_type: 'visit_arrived',
      });
    const [sql, args] = mockDb.query.mock.calls[0];
    expect(sql).toMatch(/recipient_type = \$/);
    expect(sql).toMatch(/recipient_id = \$/);
    expect(sql).toMatch(/channel = \$/);
    expect(sql).toMatch(/event_type = \$/);
    expect(sql).toMatch(/status = \$/);
    expect(args).toEqual(expect.arrayContaining([
      'resident', 'r-abc', 'sms', 'visit_arrived', 'sent',
    ]));
  });

  test('scopes admin list by authenticated property_id when present', async () => {
    mockCurrentUser = { uid: 'admin1', role: 'admin', property_id: 'property-1' };
    mockDb.query.mockResolvedValue({ rows: [] });
    await supertest(buildApp())
      .get('/api/v1/admin/notification-log?since=2026-04-01T00:00:00Z');
    const [sql, args] = mockDb.query.mock.calls[0];
    expect(sql).toMatch(/WHERE property_id = \$1 AND created_at >= \$2/);
    expect(args).toEqual(['property-1', '2026-04-01T00:00:00Z', 50, 0]);
  });

  test('does not accept property_id from query as admin scope', async () => {
    mockDb.query.mockResolvedValue({ rows: [] });
    await supertest(buildApp())
      .get('/api/v1/admin/notification-log?since=2026-04-01T00:00:00Z&property_id=other-property');
    const [sql, args] = mockDb.query.mock.calls[0];
    expect(sql).not.toMatch(/property_id = \$/);
    expect(args).toEqual(['2026-04-01T00:00:00Z', 50, 0]);
  });

  test('503 when SQL rejects', async () => {
    mockDb.query.mockRejectedValue(new Error('pool terminated'));
    const res = await supertest(buildApp())
      .get('/api/v1/admin/notification-log?since=2026-04-01T00:00:00Z');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ ok: false, error: 'pool terminated' });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /admin/notification-log/metrics
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/v1/admin/notification-log/metrics', () => {
  beforeEach(() => { mockCurrentUser = { uid: 'admin1', role: 'admin' }; });

  test('403 for non-admin', async () => {
    mockCurrentUser = { uid: 'r', role: 'resident' };
    const res = await supertest(buildApp())
      .get('/api/v1/admin/notification-log/metrics');
    expect(res.status).toBe(403);
  });

  test('400 on invalid period', async () => {
    const res = await supertest(buildApp())
      .get('/api/v1/admin/notification-log/metrics?period=5m');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/24h, 7d, 30d/);
    expect(mockDb.query).not.toHaveBeenCalled();
  });

  test('200 default period=24h with full shape', async () => {
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ channel: 'sms', sent: '100', failed: '5' }] })
      .mockResolvedValueOnce({ rows: [{ event_type: 'visit_arrived', total: 50 }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await supertest(buildApp())
      .get('/api/v1/admin/notification-log/metrics');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.period).toBe('24h');
    expect(res.body.period_hours).toBe(24);
    expect(res.body.channels).toEqual([
      { channel: 'sms', sent: 100, failed: 5, success_rate: 100 / 105 },
    ]);
    expect(res.body.top_events).toEqual([{ event_type: 'visit_arrived', total: 50 }]);
    expect(res.body.top_errors).toEqual([]);
    expect(typeof res.body.generated_at).toBe('string');
  });

  test('200 period=7d → hoursBack=168', async () => {
    mockDb.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await supertest(buildApp())
      .get('/api/v1/admin/notification-log/metrics?period=7d');
    expect(res.status).toBe(200);
    expect(res.body.period).toBe('7d');
    expect(res.body.period_hours).toBe(168);
    // Every query should have passed the interval string "168 hours".
    for (const call of mockDb.query.mock.calls) {
      expect(call[1]).toEqual(['168 hours']);
    }
  });

  test('scopes metrics by authenticated property_id when present', async () => {
    mockCurrentUser = { uid: 'admin1', role: 'admin', property_id: 'property-1' };
    mockDb.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await supertest(buildApp())
      .get('/api/v1/admin/notification-log/metrics?period=7d');
    expect(res.status).toBe(200);
    for (const call of mockDb.query.mock.calls) {
      expect(call[0]).toMatch(/AND property_id = \$2/);
      expect(call[1]).toEqual(['168 hours', 'property-1']);
    }
  });

  test('200 period=30d → hoursBack=720', async () => {
    mockDb.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await supertest(buildApp())
      .get('/api/v1/admin/notification-log/metrics?period=30d');
    expect(res.body.period_hours).toBe(720);
  });

  test('503 when a metrics sub-query rejects', async () => {
    mockDb.query.mockRejectedValue(new Error('boom'));
    const res = await supertest(buildApp())
      .get('/api/v1/admin/notification-log/metrics');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ ok: false, error: 'boom' });
  });

  test('route order — "metrics" is not swallowed by /:id', async () => {
    // If /:id matched first, it would SELECT WHERE id='metrics' and we'd get 404
    // (since mockDb returns empty by default).  Metrics handler succeeds with 200.
    mockDb.query.mockResolvedValue({ rows: [] });
    const res = await supertest(buildApp())
      .get('/api/v1/admin/notification-log/metrics');
    expect(res.status).toBe(200);
    expect(res.body.period).toBe('24h');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /admin/notification-log/:id
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/v1/admin/notification-log/:id', () => {
  beforeEach(() => { mockCurrentUser = { uid: 'admin1', role: 'admin' }; });

  test('403 for non-admin', async () => {
    mockCurrentUser = { uid: 'x', role: 'security' };
    const res = await supertest(buildApp())
      .get('/api/v1/admin/notification-log/abc-uuid');
    expect(res.status).toBe(403);
  });

  test('404 when row not found', async () => {
    mockDb.query.mockResolvedValue({ rows: [] });
    const res = await supertest(buildApp())
      .get('/api/v1/admin/notification-log/no-such-id');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: 'Not found' });
  });

  test('200 with full row shape (including payload)', async () => {
    const fake = {
      id: 'abc',
      channel: 'web_push',
      event_type: 'package_arrived',
      status: 'sent',
      payload: { title: 'ok', body: 'detail', endpoint: 'SECRET' },
      provider_message_id: 'fcm-123',
      error_code: null,
    };
    mockDb.query.mockResolvedValue({ rows: [fake] });
    const res = await supertest(buildApp())
      .get('/api/v1/admin/notification-log/abc');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, item: fake });
    // Admin view is NOT trimmed — provider_message_id + full payload visible.
    expect(res.body.item.payload.endpoint).toBe('SECRET');
    expect(res.body.item.provider_message_id).toBe('fcm-123');
  });

  test('scopes detail by authenticated property_id when present', async () => {
    mockCurrentUser = { uid: 'admin1', role: 'admin', property_id: 'property-1' };
    mockDb.query.mockResolvedValue({ rows: [{ id: 'abc', property_id: 'property-1' }] });
    const res = await supertest(buildApp())
      .get('/api/v1/admin/notification-log/abc');
    expect(res.status).toBe(200);
    const [sql, args] = mockDb.query.mock.calls[0];
    expect(sql).toMatch(/WHERE id = \$1 AND property_id = \$2/);
    expect(args).toEqual(['abc', 'property-1']);
  });

  test('503 on query rejection', async () => {
    mockDb.query.mockRejectedValue(new Error('pg connection reset'));
    const res = await supertest(buildApp())
      .get('/api/v1/admin/notification-log/some-id');
    expect(res.status).toBe(503);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /notification-log/mine (resident)
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/v1/notification-log/mine', () => {
  test('401 when unauthenticated', async () => {
    const res = await supertest(buildApp()).get('/api/v1/notification-log/mine');
    expect(res.status).toBe(401);
  });

  test('403 for admin role (admin uses /admin/* instead)', async () => {
    mockCurrentUser = { uid: 'admin1', role: 'admin' };
    const res = await supertest(buildApp()).get('/api/v1/notification-log/mine');
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'Residents only' });
  });

  test('200 empty list when resident has no residents row (legacy user)', async () => {
    mockCurrentUser = { uid: 'legacy-uid', role: 'resident' };
    dispatchQuery([
      ['FROM residents', () => ({ rows: [] })],   // resolveResidentByUid miss
    ]);
    const res = await supertest(buildApp()).get('/api/v1/notification-log/mine');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, items: [], count: 0 });
    // Only the residents lookup happened — no notification_log_v2 query.
    expect(mockDb.query).toHaveBeenCalledTimes(1);
    expect(mockDb.query.mock.calls[0][0]).toMatch(/FROM residents/);
  });

  test('200 with trimmed payload when resident has rows', async () => {
    mockCurrentUser = { uid: 'legacy-uid', role: 'resident' };
    dispatchQuery([
      ['FROM residents', () => ({ rows: [{ id: 'resident-uuid-1' }] })],
      ['FROM notification_log_v2', () => ({ rows: [
        {
          id: 'log-1',
          channel: 'web_push',
          event_type: 'package_arrived',
          status: 'sent',
          payload: {
            title: 'Посылка готова',
            body: 'Заберите с ресепшн',
            endpoint: 'SECRET-FCM-URL',
            p256dh: 'SECRET-KEY',
            subscription_id: 'sub-internal',
          },
          attempt_count: 1,
        },
      ] })],
    ]);
    const res = await supertest(buildApp()).get('/api/v1/notification-log/mine');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.count).toBe(1);
    expect(res.body.items[0].id).toBe('log-1');
    expect(res.body.items[0].payload).toEqual({
      title: 'Посылка готова',
      body: 'Заберите с ресепшн',
    });
    // Critical: secrets MUST NOT leak.
    expect(JSON.stringify(res.body)).not.toMatch(/SECRET-FCM-URL/);
    expect(JSON.stringify(res.body)).not.toMatch(/SECRET-KEY/);
    expect(JSON.stringify(res.body)).not.toMatch(/sub-internal/);
  });

  test('list query filters by recipient_type=resident AND status=sent', async () => {
    mockCurrentUser = { uid: 'legacy-uid', role: 'resident' };
    dispatchQuery([
      ['FROM residents', () => ({ rows: [{ id: 'r1' }] })],
      ['FROM notification_log_v2', () => ({ rows: [] })],
    ]);
    await supertest(buildApp()).get('/api/v1/notification-log/mine');
    // Second call is the notification_log_v2 query.
    const sql = mockDb.query.mock.calls[1][0];
    expect(sql).toMatch(/recipient_type = 'resident'/);
    expect(sql).toMatch(/recipient_id = \$1/);
    expect(sql).toMatch(/status = 'sent'/);
    // Admin-only columns must NOT appear in /mine select.
    expect(sql).not.toMatch(/provider_message_id/);
    expect(sql).not.toMatch(/error_message/);
  });

  test('respects ?limit= query param', async () => {
    mockCurrentUser = { uid: 'uid1', role: 'resident' };
    dispatchQuery([
      ['FROM residents', () => ({ rows: [{ id: 'r1' }] })],
      ['FROM notification_log_v2', () => ({ rows: [] })],
    ]);
    await supertest(buildApp()).get('/api/v1/notification-log/mine?limit=5');
    expect(mockDb.query.mock.calls[1][1]).toEqual(['r1', 5]);
  });

  test('scopes resident lookup and mine list by authenticated property_id when present', async () => {
    mockCurrentUser = { uid: 'uid1', role: 'resident', property_id: 'property-1' };
    dispatchQuery([
      ['FROM residents', () => ({ rows: [{ id: 'r1' }] })],
      ['FROM notification_log_v2', () => ({ rows: [] })],
    ]);
    await supertest(buildApp()).get('/api/v1/notification-log/mine?limit=5');
    expect(mockDb.query.mock.calls[0][0]).toMatch(/external_uid = \$1 AND property_id = \$2/);
    expect(mockDb.query.mock.calls[0][1]).toEqual(['uid1', 'property-1']);
    expect(mockDb.query.mock.calls[1][0]).toMatch(/AND property_id = \$2/);
    expect(mockDb.query.mock.calls[1][1]).toEqual(['r1', 'property-1', 5]);
  });

  test('503 when residents lookup rejects', async () => {
    mockCurrentUser = { uid: 'u1', role: 'resident' };
    mockDb.query.mockRejectedValue(new Error('pool down'));
    const res = await supertest(buildApp()).get('/api/v1/notification-log/mine');
    expect(res.status).toBe(503);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /notification-log/_meta
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/v1/notification-log/_meta', () => {
  test('200 returns limit_max for pagination-aware clients', async () => {
    mockCurrentUser = { uid: 'u1', role: 'resident' };
    const res = await supertest(buildApp()).get('/api/v1/notification-log/_meta');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, limit_max: LIMIT_MAX });
  });
});
