'use strict';

/**
 * Phase 5 — POST /api/v1/notifications/outbox/retry endpoint tests.
 * Spec: notifications-outbox-spec.md §4.5.
 *
 * Scope:
 *   • auth: 401 unauth, 403 non-admin, 200 admin.
 *   • 400 on validation errors (bubble from resurrectOutboxRows).
 *   • 200 happy path — body echoes { ok, revived, revivedIds }.
 *   • 503 on pool.query rejection.
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

const mockDb = {
  query: jest.fn(),
  pool: { totalCount: 0, idleCount: 0, waitingCount: 0 },
};

const { registerObservabilityRoutes } = require('../app/registerObservabilityRoutes');

const UUID_1 = '11111111-1111-4111-8111-111111111111';

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

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = null;
});

// ══════════════════════════════════════════════════════════════════════════════
// auth
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/v1/notifications/outbox/retry — auth', () => {
  test('401 when unauthenticated', async () => {
    const res = await supertest(buildApp())
      .post('/api/v1/notifications/outbox/retry')
      .send({ status: 'dead' });
    expect(res.status).toBe(401);
  });

  test('403 for non-admin role', async () => {
    mockCurrentUser = { uid: 'u1', role: 'security' };
    const res = await supertest(buildApp())
      .post('/api/v1/notifications/outbox/retry')
      .send({ status: 'dead' });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'Admin only' });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// validation
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/v1/notifications/outbox/retry — validation', () => {
  beforeEach(() => { mockCurrentUser = { uid: 'admin1', role: 'admin' }; });

  test('400 when neither ids nor status provided', async () => {
    const res = await supertest(buildApp())
      .post('/api/v1/notifications/outbox/retry')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ids.*or.*status/i);
    expect(mockDb.query).not.toHaveBeenCalled();
  });

  test('400 when ids and status both provided', async () => {
    const res = await supertest(buildApp())
      .post('/api/v1/notifications/outbox/retry')
      .send({ ids: ['a'], status: 'dead' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/mutually exclusive/i);
    expect(mockDb.query).not.toHaveBeenCalled();
  });

  test('400 when status is not dead|failed', async () => {
    const res = await supertest(buildApp())
      .post('/api/v1/notifications/outbox/retry')
      .send({ status: 'sent' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/must be one of/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// happy path
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/v1/notifications/outbox/retry — happy path', () => {
  beforeEach(() => { mockCurrentUser = { uid: 'admin1', role: 'admin' }; });

  test('200 with { ok, revived, revivedIds } on bulk retry', async () => {
    mockDb.query.mockResolvedValue({
      rows: [{ id: 'row-1' }, { id: 'row-2' }, { id: 'row-3' }],
    });
    const res = await supertest(buildApp())
      .post('/api/v1/notifications/outbox/retry')
      .send({ status: 'dead', limit: 10 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      revived: 3,
      revivedIds: ['row-1', 'row-2', 'row-3'],
    });
    // SQL must hit notifications_outbox with SET status='pending'.
    const sql = mockDb.query.mock.calls[0][0];
    expect(sql).toMatch(/UPDATE\s+notifications_outbox/i);
    expect(sql).toMatch(/status\s*=\s*'pending'/i);
  });

  test('200 with 0 revived when no rows match', async () => {
    mockDb.query.mockResolvedValue({ rows: [] });
    const res = await supertest(buildApp())
      .post('/api/v1/notifications/outbox/retry')
      .send({ ids: [UUID_1] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, revived: 0, revivedIds: [] });
  });

  test('shared-pool retry is scoped by user property_id when present', async () => {
    mockCurrentUser = { uid: 'admin1', role: 'admin', property_id: 'property-1' };
    mockDb.query.mockResolvedValue({ rows: [] });
    const res = await supertest(buildApp())
      .post('/api/v1/notifications/outbox/retry')
      .send({ status: 'dead', limit: 10 });
    expect(res.status).toBe(200);
    const [sql, args] = mockDb.query.mock.calls[0];
    expect(sql).toMatch(/AND property_id = \$3/);
    expect(args).toEqual(['dead', 10, 'property-1']);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// error handling
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/v1/notifications/outbox/retry — errors', () => {
  beforeEach(() => { mockCurrentUser = { uid: 'admin1', role: 'admin' }; });

  test('503 ok:false when UPDATE rejects', async () => {
    mockDb.query.mockRejectedValue(new Error('connection terminated'));
    const res = await supertest(buildApp())
      .post('/api/v1/notifications/outbox/retry')
      .send({ status: 'dead' });
    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/temporarily unavailable/);
  });
});
