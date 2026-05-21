'use strict';

/**
 * Phase 5 — /api/v1/notifications/outbox/health unit tests.
 * Spec: notifications-outbox-spec.md §4.5 — admin introspection.
 *
 * Scope:
 *   • auth: 401 when req.user absent, 403 for non-admin, 200 for admin.
 *   • SQL shape: single aggregate SELECT hitting notifications_outbox with
 *     FILTER clauses for per-status counts + stuck_in_flight + oldest-pending.
 *   • response: normalized integer fields, null age when queue empty,
 *     feature_enabled surfaces NOTIFICATIONS_OUTBOX_ENABLED env var.
 *   • DB errors → 503 ok:false (never crashes the process).
 */

const { describe, test, expect, beforeEach, afterEach } = require('@jest/globals');
const express = require('express');
const supertest = require('supertest');

jest.mock('../logger', () => require('../__mocks__/logger'));

const mockGetRedis = jest.fn(() => null);
const mockSseRedisStatus = jest.fn(() => ({ enabled: false, subscriber: 'unconfigured' }));

jest.mock('../lib/redisClient', () => ({
  getRedis: () => mockGetRedis(),
}));

jest.mock('../sse-redis', () => ({
  getStatus: () => mockSseRedisStatus(),
}));

// Mutable auth user (same pattern as v1Routes.test.js).
let mockCurrentUser = null;
jest.mock('../middleware/auth', () => (req, res, next) => {
  if (!mockCurrentUser) return res.status(401).json({ error: 'unauth' });
  req.user = mockCurrentUser;
  next();
});

// Mocked db is passed as first-class dep — registerObservabilityRoutes uses
// `{ db }` DI, no global require.
const mockDb = {
  query: jest.fn(),
  pool: { totalCount: 0, idleCount: 0, waitingCount: 0 },
};

const { registerObservabilityRoutes } = require('../app/registerObservabilityRoutes');

function buildApp() {
  const app = express();
  app.use(express.json());
  registerObservabilityRoutes(app, { db: mockDb });
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    res.status(500).json({ error: String(err && err.message || err) });
  });
  return app;
}

const ORIGINAL_FLAG = process.env.NOTIFICATIONS_OUTBOX_ENABLED;

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = null;
  mockGetRedis.mockReturnValue(null);
  mockSseRedisStatus.mockReturnValue({ enabled: false, subscriber: 'unconfigured' });
  // Default shape of the aggregate SELECT when notifications_outbox is empty.
  mockDb.query.mockResolvedValue({
    rows: [{
      pending: '0',
      in_flight: '0',
      failed: '0',
      dead: '0',
      sent_last_24h: '0',
      stuck_in_flight: '0',
      oldest_pending_age_seconds: null,
    }],
  });
});

afterEach(() => {
  if (ORIGINAL_FLAG === undefined) {
    delete process.env.NOTIFICATIONS_OUTBOX_ENABLED;
  } else {
    process.env.NOTIFICATIONS_OUTBOX_ENABLED = ORIGINAL_FLAG;
  }
});

describe('GET /api/v1/events/health — redis status', () => {
  beforeEach(() => { mockCurrentUser = { uid: 'admin1', role: 'admin' }; });

  test('reports healthy when Redis is unconfigured', async () => {
    const res = await supertest(buildApp()).get('/api/v1/events/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      degraded: false,
      redis: {
        publisher: 'unconfigured',
        subscriber: 'unconfigured',
        enabled: false,
      },
    });
  });

  test('reports degraded when Redis publisher ping fails', async () => {
    mockGetRedis.mockReturnValue({ ping: jest.fn().mockRejectedValue(new Error('redis down')) });
    mockSseRedisStatus.mockReturnValue({ enabled: true, subscriber: 'ok' });
    const res = await supertest(buildApp()).get('/api/v1/events/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.degraded).toBe(true);
    expect(res.body.redis.publisher).toBe('error');
  });

  test('reports degraded when Redis subscriber is not ready', async () => {
    mockGetRedis.mockReturnValue({ ping: jest.fn().mockResolvedValue('PONG') });
    mockSseRedisStatus.mockReturnValue({ enabled: true, subscriber: 'connecting' });
    const res = await supertest(buildApp()).get('/api/v1/events/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.degraded).toBe(true);
    expect(res.body.redis).toMatchObject({
      publisher: 'ok',
      subscriber: 'connecting',
      enabled: true,
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// auth
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/v1/notifications/outbox/health — auth', () => {
  test('401 when unauthenticated', async () => {
    const app = buildApp();
    const res = await supertest(app).get('/api/v1/notifications/outbox/health');
    expect(res.status).toBe(401);
  });

  test('403 for non-admin role', async () => {
    mockCurrentUser = { uid: 'u1', role: 'security' };
    const app = buildApp();
    const res = await supertest(app).get('/api/v1/notifications/outbox/health');
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'Admin only' });
  });

  test('200 for admin', async () => {
    mockCurrentUser = { uid: 'admin1', role: 'admin' };
    const app = buildApp();
    const res = await supertest(app).get('/api/v1/notifications/outbox/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// SQL & response shape
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/v1/notifications/outbox/health — payload', () => {
  beforeEach(() => { mockCurrentUser = { uid: 'admin1', role: 'admin' }; });

  test('runs a single aggregate SELECT against notifications_outbox', async () => {
    const app = buildApp();
    await supertest(app).get('/api/v1/notifications/outbox/health');
    expect(mockDb.query).toHaveBeenCalledTimes(1);
    const sql = mockDb.query.mock.calls[0][0];
    expect(sql).toMatch(/FROM\s+notifications_outbox/i);
    // Per-status FILTER clauses (core of the dashboard).
    expect(sql).toMatch(/FILTER\s*\(\s*WHERE\s+status\s*=\s*'pending'\s*\)/i);
    expect(sql).toMatch(/FILTER\s*\(\s*WHERE\s+status\s*=\s*'in_flight'\s*\)/i);
    expect(sql).toMatch(/FILTER\s*\(\s*WHERE\s+status\s*=\s*'failed'\s*\)/i);
    expect(sql).toMatch(/FILTER\s*\(\s*WHERE\s+status\s*=\s*'dead'\s*\)/i);
    // Stuck-in-flight window = 30 minutes
    expect(sql).toMatch(/INTERVAL\s+'30\s+minutes'/i);
    // Oldest pending age calculation
    expect(sql).toMatch(/EXTRACT\(\s*EPOCH\s+FROM/i);
    expect(sql).toMatch(/MIN\(\s*next_attempt_at\s*\)\s*FILTER\s*\(\s*WHERE\s+status\s+IN/i);
  });

  test('normalizes Postgres-string counts into numbers', async () => {
    mockDb.query.mockResolvedValue({
      rows: [{
        pending: '42',
        in_flight: '3',
        failed: '7',
        dead: '1',
        sent_last_24h: '1000',
        stuck_in_flight: '2',
        oldest_pending_age_seconds: '125.8',
      }],
    });
    const app = buildApp();
    const res = await supertest(app).get('/api/v1/notifications/outbox/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      counts: {
        pending: 42,
        in_flight: 3,
        failed: 7,
        dead: 1,
        sent_last_24h: 1000,
      },
      stuck_in_flight: 2,
      oldest_pending_age_seconds: 126,
    });
    expect(typeof res.body.ts).toBe('string');
  });

  test('scopes shared-pool health by user property_id when present', async () => {
    mockCurrentUser = { uid: 'admin1', role: 'admin', property_id: 'property-1' };
    const app = buildApp();
    const res = await supertest(app).get('/api/v1/notifications/outbox/health');
    expect(res.status).toBe(200);
    const [sql, args] = mockDb.query.mock.calls[0];
    expect(sql).toMatch(/WHERE\s+property_id\s*=\s*\$1/i);
    expect(args).toEqual(['property-1']);
  });

  test('oldest_pending_age_seconds is null when queue empty', async () => {
    const app = buildApp();
    const res = await supertest(app).get('/api/v1/notifications/outbox/health');
    expect(res.body.oldest_pending_age_seconds).toBeNull();
  });

  test('surfaces feature_enabled from NOTIFICATIONS_OUTBOX_ENABLED', async () => {
    process.env.NOTIFICATIONS_OUTBOX_ENABLED = 'true';
    const app = buildApp();
    const res = await supertest(app).get('/api/v1/notifications/outbox/health');
    expect(res.body.feature_enabled).toBe(true);

    delete process.env.NOTIFICATIONS_OUTBOX_ENABLED;
    const res2 = await supertest(buildApp()).get('/api/v1/notifications/outbox/health');
    expect(res2.body.feature_enabled).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// error handling
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/v1/notifications/outbox/health — errors', () => {
  beforeEach(() => { mockCurrentUser = { uid: 'admin1', role: 'admin' }; });

  test('503 ok:false when query rejects', async () => {
    mockDb.query.mockRejectedValue(new Error('relation "notifications_outbox" does not exist'));
    const app = buildApp();
    const res = await supertest(app).get('/api/v1/notifications/outbox/health');
    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/temporarily unavailable/);
  });
});
