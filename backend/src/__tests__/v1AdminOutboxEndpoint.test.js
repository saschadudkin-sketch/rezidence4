'use strict';

/**
 * Phase 5 (platform-v1) — /api/v1/admin/outbox HTTP endpoint tests.
 * Spec: notifications-outbox-spec.md §4.2.
 *
 * Scope:
 *   • Auth matrix — 401 unauth, 403 non-admin (resident/concierge/security) на всех 5 ручках.
 *   • GET /          — list happy, фильтры, валидация from/to, 503 on DB error.
 *   • GET /metrics   — JSON default, ?format=prometheus → text/plain v0.0.4.
 *   • GET /:id       — bad UUID 400, 404 miss, 200 happy, 503 DB error.
 *   • POST /:id/requeue — 400 bad UUID, 404 not_found, 409 not_retryable,
 *                         200 happy + audit fire-and-forget, 503 DB error.
 *   • POST /:id/cancel  — 400 bad UUID, 404 not_found, 409 not_cancellable,
 *                         200 happy + audit fire-and-forget, 503 DB error.
 *
 * Мок-стратегия:
 *   • requireAuth — pass-through с mockCurrentUser (null → 401).
 *   • db module   — { query, pool }; pool.query обслуживает service-layer,
 *                   db.query обслуживает audit INSERT (fire-and-forget).
 *     Две разные mock-функции — потому что audit НЕ должен блокировать ответ;
 *     если бы мы шарили одну, асинхронный audit мог бы добавить шум после
 *     супертест-ответа и вызвать leaked-promise warning'и.
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

const mockPool = { query: jest.fn() };
const mockDb = {
  query: jest.fn(),        // audit_log INSERT лежит через db.query (не req.db)
  pool: mockPool,          // service-layer берёт req.db || db.pool → mockPool
};
jest.mock('../db', () => mockDb);

const adminOutboxRouter = require('../v1/routes/adminOutbox');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/admin/outbox', adminOutboxRouter);
  return app;
}

beforeEach(() => {
  mockCurrentUser = null;
  mockPool.query.mockReset();
  mockDb.query.mockReset();
  // audit fire-and-forget: если db.query не mock'нут, .catch() съест ошибку,
  // но всё равно дадим ему разрешающуюся промис-заглушку.
  mockDb.query.mockResolvedValue({ rows: [] });
});

function dispatch(handlers) {
  mockPool.query.mockImplementation((sql, args) => {
    for (const [needle, handler] of handlers) {
      if (typeof needle === 'string' && sql.includes(needle)) {
        return Promise.resolve(handler(sql, args));
      }
      if (needle instanceof RegExp && needle.test(sql)) {
        return Promise.resolve(handler(sql, args));
      }
    }
    return Promise.resolve({ rows: [] });
  });
}

const UUID  = '11111111-2222-3333-4444-555555555555';
const UUID2 = '22222222-2222-3333-4444-555555555555';
const BAD_UUID = 'not-a-uuid';

// ══════════════════════════════════════════════════════════════════════════════
// 401 auth matrix
// ══════════════════════════════════════════════════════════════════════════════

describe('auth — 401 when not authenticated', () => {
  const cases = [
    ['get',  '/api/v1/admin/outbox'],
    ['get',  '/api/v1/admin/outbox/metrics'],
    ['get',  '/api/v1/admin/outbox/sla'],
    ['get',  `/api/v1/admin/outbox/${UUID}`],
    ['post', `/api/v1/admin/outbox/${UUID}/requeue`],
    ['post', `/api/v1/admin/outbox/${UUID}/cancel`],
  ];
  for (const [method, url] of cases) {
    test(`${method.toUpperCase()} ${url} → 401`, async () => {
      const res = await supertest(buildApp())[method](url).send({});
      expect(res.status).toBe(401);
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 403 non-admin matrix
// ══════════════════════════════════════════════════════════════════════════════

describe('auth — 403 for non-admin roles', () => {
  const roles = ['resident', 'concierge', 'security'];
  const endpoints = [
    ['get',  '/api/v1/admin/outbox'],
    ['get',  '/api/v1/admin/outbox/metrics'],
    ['get',  '/api/v1/admin/outbox/sla'],
    ['get',  `/api/v1/admin/outbox/${UUID}`],
    ['post', `/api/v1/admin/outbox/${UUID}/requeue`],
    ['post', `/api/v1/admin/outbox/${UUID}/cancel`],
  ];
  for (const role of roles) {
    for (const [method, url] of endpoints) {
      test(`${role} ${method.toUpperCase()} ${url} → 403`, async () => {
        mockCurrentUser = { uid: 'u1', role };
        const res = await supertest(buildApp())[method](url).send({});
        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/admin/i);
      });
    }
  }

  test('403 with unknown role тоже гейтится', async () => {
    mockCurrentUser = { uid: 'u1', role: 'wildcard' };
    const res = await supertest(buildApp()).get('/api/v1/admin/outbox');
    expect(res.status).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/v1/admin/outbox (list)
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/v1/admin/outbox — list', () => {
  beforeEach(() => { mockCurrentUser = { uid: 'admin1', role: 'admin' }; });

  test('200 happy — пустой список', async () => {
    dispatch([[/FROM notifications_outbox/, () => ({ rows: [] })]]);
    const res = await supertest(buildApp()).get('/api/v1/admin/outbox');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      items: [],
      count: 0,
      limit: 100,    // LIMIT_DEFAULT
      offset: 0,
    });
  });

  test('200 happy — возвращает items', async () => {
    dispatch([
      [/FROM notifications_outbox/, () => ({ rows: [
        { id: UUID,  event_type: 'request.created', channel: 'web_push', status: 'sent' },
        { id: UUID2, event_type: 'announcement.published', channel: 'telegram', status: 'pending' },
      ] })],
    ]);
    const res = await supertest(buildApp()).get('/api/v1/admin/outbox');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.count).toBe(2);
  });

  test('фильтр status=pending прокидывается в SQL', async () => {
    let capturedArgs = null;
    dispatch([
      [/FROM notifications_outbox/, (_sql, args) => {
        capturedArgs = args;
        return { rows: [] };
      }],
    ]);
    const res = await supertest(buildApp()).get('/api/v1/admin/outbox?status=pending');
    expect(res.status).toBe(200);
    expect(capturedArgs).toContain('pending');
  });

  test('фильтр channel=web_push прокидывается в SQL', async () => {
    let capturedArgs = null;
    dispatch([
      [/FROM notifications_outbox/, (_sql, args) => {
        capturedArgs = args;
        return { rows: [] };
      }],
    ]);
    const res = await supertest(buildApp()).get('/api/v1/admin/outbox?channel=web_push');
    expect(res.status).toBe(200);
    expect(capturedArgs).toContain('web_push');
  });

  test('scopes list by authenticated property_id and ignores query override', async () => {
    mockCurrentUser = { uid: 'admin1', role: 'admin', property_id: UUID2 };
    let capturedSql = '';
    let capturedArgs = null;
    dispatch([
      [/FROM notifications_outbox/, (sql, args) => {
        capturedSql = sql;
        capturedArgs = args;
        return { rows: [] };
      }],
    ]);
    const res = await supertest(buildApp()).get(`/api/v1/admin/outbox?property_id=${UUID}`);
    expect(res.status).toBe(200);
    expect(capturedSql).toMatch(/WHERE property_id = \$1/);
    expect(capturedArgs).toEqual([UUID2, 100, 0]);
  });

  test('невалидный status молча игнорируется (не 400)', async () => {
    let capturedArgs = null;
    dispatch([
      [/FROM notifications_outbox/, (_sql, args) => {
        capturedArgs = args;
        return { rows: [] };
      }],
    ]);
    const res = await supertest(buildApp()).get('/api/v1/admin/outbox?status=INVALID');
    expect(res.status).toBe(200);
    // В args должны быть только limit + offset (никакого 'INVALID').
    expect(capturedArgs).not.toContain('INVALID');
  });

  test('400 когда from невалидный ISO', async () => {
    const res = await supertest(buildApp()).get('/api/v1/admin/outbox?from=not-a-date');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/from/i);
  });

  test('400 когда to невалидный ISO', async () => {
    const res = await supertest(buildApp()).get('/api/v1/admin/outbox?to=xxx');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/to/i);
  });

  test('400 когда from > to', async () => {
    const res = await supertest(buildApp()).get(
      '/api/v1/admin/outbox?from=2026-05-01T00:00:00Z&to=2026-04-01T00:00:00Z',
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/from must be <= to/i);
  });

  test('валидный from+to пропускается', async () => {
    dispatch([[/FROM notifications_outbox/, () => ({ rows: [] })]]);
    const res = await supertest(buildApp()).get(
      '/api/v1/admin/outbox?from=2026-04-01T00:00:00Z&to=2026-04-30T23:59:59Z',
    );
    expect(res.status).toBe(200);
  });

  test('q-параметр прокидывается в ILIKE', async () => {
    let capturedArgs = null;
    let capturedSql = '';
    dispatch([
      [/FROM notifications_outbox/, (sql, args) => {
        capturedSql = sql;
        capturedArgs = args;
        return { rows: [] };
      }],
    ]);
    const res = await supertest(buildApp()).get('/api/v1/admin/outbox?q=test@example.com');
    expect(res.status).toBe(200);
    expect(capturedSql).toMatch(/ILIKE/i);
    expect(capturedArgs.some((a) => typeof a === 'string' && a.includes('test@example.com')))
      .toBe(true);
  });

  test('limit/offset пробрасываются и клампятся', async () => {
    let capturedArgs = null;
    dispatch([
      [/FROM notifications_outbox/, (_sql, args) => {
        capturedArgs = args;
        return { rows: [] };
      }],
    ]);
    const res = await supertest(buildApp()).get('/api/v1/admin/outbox?limit=25&offset=50');
    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(25);
    expect(res.body.offset).toBe(50);
    // Args = [limit, offset] (нет filter'ов).
    expect(capturedArgs).toEqual([25, 50]);
  });

  test('limit выше 500 клампится до 500', async () => {
    dispatch([[/FROM notifications_outbox/, () => ({ rows: [] })]]);
    const res = await supertest(buildApp()).get('/api/v1/admin/outbox?limit=99999');
    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(500);
  });

  test('503 на ошибку БД', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('pg connection lost'));
    const res = await supertest(buildApp()).get('/api/v1/admin/outbox');
    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/temporarily unavailable/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/v1/admin/outbox/metrics
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/v1/admin/outbox/metrics', () => {
  beforeEach(() => { mockCurrentUser = { uid: 'admin1', role: 'admin' }; });

  test('200 JSON default', async () => {
    // Важно: порядок handlers от более-специфичных к более-общим.  Queries #2/#3
    // (GROUP BY channel / GROUP BY event_type) matchатся ПЕРВЫМИ, query #1 ловит
    // последний (EXTRACT EPOCH уникален для aggregate SQL).
    dispatch([
      [/GROUP BY channel/, () => ({ rows: [
        { channel: 'web_push', pending: 2, in_flight: 1, sent: 50, failed: 1, dead: 2 },
        { channel: 'sms',      pending: 1, in_flight: 0, sent: 50, failed: 1, dead: 2 },
      ] })],
      [/GROUP BY event_type/, () => ({ rows: [
        { event_type: 'request.created',   total: 80 },
        { event_type: 'announcement.published', total: 20 },
      ] })],
      [/EXTRACT\(EPOCH FROM/, () => ({ rows: [{
        pending: 3, in_flight: 1, sent: 100, failed: 2, dead: 4,
        oldest_pending_age_seconds: 120,
      }] })],
    ]);
    const res = await supertest(buildApp()).get('/api/v1/admin/outbox/metrics');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.counts).toEqual({
      pending: 3, in_flight: 1, sent: 100, failed: 2, dead: 4,
    });
    expect(res.body.per_channel).toHaveLength(5); // все 5 каналов (web_push/sms/telegram/webhook/email)
    expect(res.body.per_event_type).toHaveLength(2);
    expect(res.body.oldest_pending_age_seconds).toBe(120);
    expect(typeof res.body.generated_at).toBe('string');
  });

  test('JSON default не возвращает text/plain Prometheus формат', async () => {
    dispatch([
      [/EXTRACT\(EPOCH FROM/, () => ({ rows: [{
        pending: 0, in_flight: 0, sent: 0, failed: 0, dead: 0,
        oldest_pending_age_seconds: null,
      }] })],
      [/GROUP BY channel/, () => ({ rows: [] })],
      [/GROUP BY event_type/, () => ({ rows: [] })],
    ]);
    const res = await supertest(buildApp()).get('/api/v1/admin/outbox/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    // oldest=null в JSON означает «очередь пуста».
    expect(res.body.oldest_pending_age_seconds).toBeNull();
  });

  test('?format=prometheus → text/plain v0.0.4', async () => {
    dispatch([
      [/EXTRACT\(EPOCH FROM/, () => ({ rows: [{
        pending: 5, in_flight: 0, sent: 0, failed: 0, dead: 0,
        oldest_pending_age_seconds: 60,
      }] })],
      [/GROUP BY channel/, () => ({ rows: [
        { channel: 'web_push', pending: 5, in_flight: 0, sent: 0, failed: 0, dead: 0 },
      ] })],
      [/GROUP BY event_type/, () => ({ rows: [] })],
    ]);
    const res = await supertest(buildApp()).get('/api/v1/admin/outbox/metrics?format=prometheus');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.headers['content-type']).toMatch(/version=0\.0\.4/);
    // HELP/TYPE + gauge families.
    expect(res.text).toMatch(/# HELP notifications_outbox_pending/);
    expect(res.text).toMatch(/# TYPE notifications_outbox_pending gauge/);
    expect(res.text).toMatch(/notifications_outbox_pending\{channel="web_push"\} 5/);
    // Oldest-pending scalar.
    expect(res.text).toMatch(/notifications_outbox_oldest_pending_age_seconds\s+60/);
  });

  test('?format=PROMETHEUS (case-insensitive) тоже триггерит text/plain', async () => {
    dispatch([
      [/EXTRACT\(EPOCH FROM/, () => ({ rows: [{
        pending: 0, in_flight: 0, sent: 0, failed: 0, dead: 0,
        oldest_pending_age_seconds: null,
      }] })],
      [/GROUP BY channel/, () => ({ rows: [] })],
      [/GROUP BY event_type/, () => ({ rows: [] })],
    ]);
    const res = await supertest(buildApp())
      .get('/api/v1/admin/outbox/metrics?format=PROMETHEUS');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
  });

  test('?format=unknown → JSON (не 400)', async () => {
    dispatch([
      [/EXTRACT\(EPOCH FROM/, () => ({ rows: [{
        pending: 0, in_flight: 0, sent: 0, failed: 0, dead: 0,
        oldest_pending_age_seconds: null,
      }] })],
      [/GROUP BY channel/, () => ({ rows: [] })],
      [/GROUP BY event_type/, () => ({ rows: [] })],
    ]);
    const res = await supertest(buildApp()).get('/api/v1/admin/outbox/metrics?format=xml');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  test('prometheus: пустой oldest_pending_age_seconds → 0 (а не NaN)', async () => {
    dispatch([
      [/EXTRACT\(EPOCH FROM/, () => ({ rows: [{
        pending: 0, in_flight: 0, sent: 0, failed: 0, dead: 0,
        oldest_pending_age_seconds: null,
      }] })],
      [/GROUP BY channel/, () => ({ rows: [] })],
      [/GROUP BY event_type/, () => ({ rows: [] })],
    ]);
    const res = await supertest(buildApp()).get('/api/v1/admin/outbox/metrics?format=prometheus');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/notifications_outbox_oldest_pending_age_seconds\s+0/);
    expect(res.text).not.toMatch(/NaN/);
  });

  test('503 на ошибку БД', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('db down'));
    const res = await supertest(buildApp()).get('/api/v1/admin/outbox/metrics');
    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/temporarily unavailable/);
  });

  test('префикс /metrics matchается ДО /:id (не в parse как id)', async () => {
    // Если бы регистрация была в неправильном порядке, express попытался бы
    // matchнуть «metrics» как :id → isValidUuid('metrics') === false → 400.
    // Мы ожидаем 200 JSON → значит /metrics обработан правильной ручкой.
    dispatch([
      [/EXTRACT\(EPOCH FROM/, () => ({ rows: [{
        pending: 0, in_flight: 0, sent: 0, failed: 0, dead: 0,
        oldest_pending_age_seconds: null,
      }] })],
      [/GROUP BY channel/, () => ({ rows: [] })],
      [/GROUP BY event_type/, () => ({ rows: [] })],
    ]);
    const res = await supertest(buildApp()).get('/api/v1/admin/outbox/metrics');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/v1/admin/outbox/sla
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/v1/admin/outbox/sla', () => {
  beforeEach(() => { mockCurrentUser = { uid: 'admin1', role: 'admin', property_id: UUID2 }; });

  test('scopes package SLA metrics by authenticated property_id', async () => {
    dispatch([
      [/FROM packages_v2/, () => ({ rows: [{
        awaiting_pickup_total: 1,
        awaiting_pickup_over_remind: 0,
        awaiting_pickup_over_followup: 0,
        awaiting_pickup_over_admin_alert: 0,
        received_24h: 1,
      }] })],
      [/FROM notifications_outbox/, () => ({ rows: [{
        reminders_sent_24h: 0,
        followups_sent_24h: 0,
        admin_alerts_sent_24h: 0,
      }] })],
    ]);

    const res = await supertest(buildApp()).get('/api/v1/admin/outbox/sla');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const [packagesSql, packagesArgs] = mockPool.query.mock.calls[0];
    expect(packagesSql).toMatch(/FROM packages_v2/);
    expect(packagesSql).toMatch(/WHERE property_id = \$4/);
    expect(packagesArgs).toEqual(['7', '14', '30', UUID2]);

    const [outboxSql, outboxArgs] = mockPool.query.mock.calls[1];
    expect(outboxSql).toMatch(/FROM notifications_outbox/);
    expect(outboxSql).toMatch(/AND property_id = \$5/);
    expect(outboxArgs[4]).toBe(UUID2);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/v1/admin/outbox/:id
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/v1/admin/outbox/:id', () => {
  beforeEach(() => { mockCurrentUser = { uid: 'admin1', role: 'admin' }; });

  test('400 на невалидный UUID', async () => {
    const res = await supertest(buildApp()).get(`/api/v1/admin/outbox/${BAD_UUID}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid id/i);
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  test('404 когда строка не найдена', async () => {
    dispatch([[/FROM notifications_outbox WHERE id = \$1/, () => ({ rows: [] })]]);
    const res = await supertest(buildApp()).get(`/api/v1/admin/outbox/${UUID}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  test('200 happy с item', async () => {
    dispatch([[/FROM notifications_outbox WHERE id = \$1/, () => ({ rows: [{
      id: UUID, event_type: 'request.created', channel: 'web_push', status: 'sent',
      payload: { request_id: 'abc' },
    }] })]]);
    const res = await supertest(buildApp()).get(`/api/v1/admin/outbox/${UUID}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.item.id).toBe(UUID);
    expect(res.body.item.event_type).toBe('request.created');
  });

  test('503 на ошибку БД', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('timeout'));
    const res = await supertest(buildApp()).get(`/api/v1/admin/outbox/${UUID}`);
    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/v1/admin/outbox/:id/requeue
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/v1/admin/outbox/:id/requeue', () => {
  beforeEach(() => { mockCurrentUser = { uid: 'admin1', role: 'admin' }; });

  test('400 на невалидный UUID', async () => {
    const res = await supertest(buildApp())
      .post(`/api/v1/admin/outbox/${BAD_UUID}/requeue`).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid id/i);
  });

  test('404 not_found (строка не существует)', async () => {
    dispatch([[/FROM notifications_outbox WHERE id = \$1/, () => ({ rows: [] })]]);
    const res = await supertest(buildApp())
      .post(`/api/v1/admin/outbox/${UUID}/requeue`).send({});
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  test('200 happy — dead → pending, ответ с previous_status', async () => {
    // SELECT FROM notifications_outbox WHERE id = $1   (getOutboxById)
    // UPDATE notifications_outbox ... WHERE id = ANY($1::uuid[]) ... (resurrect)
    dispatch([
      [/^\s*SELECT[\s\S]*FROM notifications_outbox\s+WHERE id = \$1/, () => ({ rows: [{
        id: UUID, status: 'dead', event_type: 'request.created', channel: 'web_push',
      }] })],
      [/UPDATE\s+notifications_outbox/i, () => ({ rows: [{ id: UUID }] })],
    ]);
    const res = await supertest(buildApp())
      .post(`/api/v1/admin/outbox/${UUID}/requeue`).send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      id: UUID,
      previous_status: 'dead',
    });
  });

  test('200 happy — failed → pending (тоже retryable)', async () => {
    dispatch([
      [/^\s*SELECT[\s\S]*FROM notifications_outbox\s+WHERE id = \$1/, () => ({ rows: [{
        id: UUID, status: 'failed',
      }] })],
      [/UPDATE\s+notifications_outbox/i, () => ({ rows: [{ id: UUID }] })],
    ]);
    const res = await supertest(buildApp())
      .post(`/api/v1/admin/outbox/${UUID}/requeue`).send({});
    expect(res.status).toBe(200);
    expect(res.body.previous_status).toBe('failed');
  });

  test('409 not_retryable когда status=sent', async () => {
    dispatch([
      [/^\s*SELECT[\s\S]*FROM notifications_outbox\s+WHERE id = \$1/, () => ({ rows: [{
        id: UUID, status: 'sent',
      }] })],
      [/UPDATE\s+notifications_outbox/i, () => ({ rows: [] })],  // не тронул
    ]);
    const res = await supertest(buildApp())
      .post(`/api/v1/admin/outbox/${UUID}/requeue`).send({});
    expect(res.status).toBe(409);
    expect(res.body.status).toBe('sent');
    expect(res.body.error).toMatch(/cannot requeue/i);
  });

  test('409 not_retryable когда status=pending', async () => {
    dispatch([
      [/^\s*SELECT[\s\S]*FROM notifications_outbox\s+WHERE id = \$1/, () => ({ rows: [{
        id: UUID, status: 'pending',
      }] })],
      [/UPDATE\s+notifications_outbox/i, () => ({ rows: [] })],
    ]);
    const res = await supertest(buildApp())
      .post(`/api/v1/admin/outbox/${UUID}/requeue`).send({});
    expect(res.status).toBe(409);
    expect(res.body.status).toBe('pending');
  });

  test('409 not_retryable когда status=in_flight', async () => {
    dispatch([
      [/^\s*SELECT[\s\S]*FROM notifications_outbox\s+WHERE id = \$1/, () => ({ rows: [{
        id: UUID, status: 'in_flight',
      }] })],
      [/UPDATE\s+notifications_outbox/i, () => ({ rows: [] })],
    ]);
    const res = await supertest(buildApp())
      .post(`/api/v1/admin/outbox/${UUID}/requeue`).send({});
    expect(res.status).toBe(409);
    expect(res.body.status).toBe('in_flight');
  });

  test('audit_log INSERT вызывается в успешной ветке', async () => {
    dispatch([
      [/^\s*SELECT[\s\S]*FROM notifications_outbox\s+WHERE id = \$1/, () => ({ rows: [{
        id: UUID, status: 'dead',
      }] })],
      [/UPDATE\s+notifications_outbox/i, () => ({ rows: [{ id: UUID }] })],
    ]);
    const res = await supertest(buildApp())
      .post(`/api/v1/admin/outbox/${UUID}/requeue`).send({});
    expect(res.status).toBe(200);
    // audit INSERT — fire-and-forget через mockDb.query (не mockPool).
    expect(mockDb.query).toHaveBeenCalled();
    const auditSql = mockDb.query.mock.calls[0][0];
    expect(auditSql).toMatch(/INSERT INTO property_audit_log/i);
    const auditArgs = mockDb.query.mock.calls[0][1];
    // actor_uid, actor_role, action, resource_id, ...
    expect(auditArgs[0]).toBe('admin1');         // actor_uid
    expect(auditArgs[1]).toBe('admin');          // actor_role
    expect(auditArgs[2]).toBe('outbox.requeued'); // action
    expect(auditArgs[3]).toBe(UUID);              // resource_id
  });

  test('503 на ошибку БД в SELECT', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('pool exhausted'));
    const res = await supertest(buildApp())
      .post(`/api/v1/admin/outbox/${UUID}/requeue`).send({});
    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
  });

  test('audit-ошибка не ломает 200-ответ (fire-and-forget)', async () => {
    dispatch([
      [/^\s*SELECT[\s\S]*FROM notifications_outbox\s+WHERE id = \$1/, () => ({ rows: [{
        id: UUID, status: 'dead',
      }] })],
      [/UPDATE\s+notifications_outbox/i, () => ({ rows: [{ id: UUID }] })],
    ]);
    // audit INSERT кинется, но .catch(warn) должен съесть.
    mockDb.query.mockRejectedValueOnce(new Error('audit_log offline'));
    const res = await supertest(buildApp())
      .post(`/api/v1/admin/outbox/${UUID}/requeue`).send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/v1/admin/outbox/:id/cancel
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/v1/admin/outbox/:id/cancel', () => {
  beforeEach(() => { mockCurrentUser = { uid: 'admin1', role: 'admin' }; });

  test('400 на невалидный UUID', async () => {
    const res = await supertest(buildApp())
      .post(`/api/v1/admin/outbox/${BAD_UUID}/cancel`).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid id/i);
  });

  test('200 happy — pending → dead', async () => {
    dispatch([
      [/UPDATE notifications_outbox/i, () => ({ rows: [{
        id: UUID, status: 'dead', last_error: 'cancelled_by_admin',
        event_type: 'request.created', channel: 'web_push',
      }] })],
    ]);
    const res = await supertest(buildApp())
      .post(`/api/v1/admin/outbox/${UUID}/cancel`).send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.item.id).toBe(UUID);
    expect(res.body.item.status).toBe('dead');
    expect(res.body.item.last_error).toBe('cancelled_by_admin');
  });

  test('200 happy — failed → dead', async () => {
    dispatch([
      [/UPDATE notifications_outbox/i, () => ({ rows: [{
        id: UUID, status: 'dead', last_error: 'cancelled_by_admin',
      }] })],
    ]);
    const res = await supertest(buildApp())
      .post(`/api/v1/admin/outbox/${UUID}/cancel`).send({});
    expect(res.status).toBe(200);
  });

  test('404 not_found (строки нет в БД)', async () => {
    dispatch([
      [/UPDATE notifications_outbox/i, () => ({ rows: [] })],
      [/FROM notifications_outbox WHERE id = \$1/, () => ({ rows: [] })],
    ]);
    const res = await supertest(buildApp())
      .post(`/api/v1/admin/outbox/${UUID}/cancel`).send({});
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  test('409 not_cancellable когда status=sent', async () => {
    dispatch([
      [/UPDATE notifications_outbox/i, () => ({ rows: [] })],
      [/FROM notifications_outbox WHERE id = \$1/, () => ({ rows: [{
        id: UUID, status: 'sent',
      }] })],
    ]);
    const res = await supertest(buildApp())
      .post(`/api/v1/admin/outbox/${UUID}/cancel`).send({});
    expect(res.status).toBe(409);
    expect(res.body.status).toBe('sent');
    expect(res.body.error).toMatch(/cannot cancel/i);
  });

  test('409 not_cancellable когда status=dead (уже мёртв)', async () => {
    dispatch([
      [/UPDATE notifications_outbox/i, () => ({ rows: [] })],
      [/FROM notifications_outbox WHERE id = \$1/, () => ({ rows: [{
        id: UUID, status: 'dead',
      }] })],
    ]);
    const res = await supertest(buildApp())
      .post(`/api/v1/admin/outbox/${UUID}/cancel`).send({});
    expect(res.status).toBe(409);
    expect(res.body.status).toBe('dead');
  });

  test('409 not_cancellable когда status=in_flight (worker обрабатывает)', async () => {
    dispatch([
      [/UPDATE notifications_outbox/i, () => ({ rows: [] })],
      [/FROM notifications_outbox WHERE id = \$1/, () => ({ rows: [{
        id: UUID, status: 'in_flight',
      }] })],
    ]);
    const res = await supertest(buildApp())
      .post(`/api/v1/admin/outbox/${UUID}/cancel`).send({});
    expect(res.status).toBe(409);
    expect(res.body.status).toBe('in_flight');
  });

  test('audit_log INSERT вызывается в успешной ветке', async () => {
    dispatch([
      [/UPDATE notifications_outbox/i, () => ({ rows: [{
        id: UUID, status: 'dead', last_error: 'cancelled_by_admin',
      }] })],
    ]);
    const res = await supertest(buildApp())
      .post(`/api/v1/admin/outbox/${UUID}/cancel`).send({});
    expect(res.status).toBe(200);
    expect(mockDb.query).toHaveBeenCalled();
    const auditCall = mockDb.query.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('audit_log'),
    );
    expect(auditCall).toBeDefined();
    expect(auditCall[1][2]).toBe('outbox.cancelled');
    expect(auditCall[1][3]).toBe(UUID);
  });

  test('503 на ошибку БД', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('connection reset'));
    const res = await supertest(buildApp())
      .post(`/api/v1/admin/outbox/${UUID}/cancel`).send({});
    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/temporarily unavailable/);
  });

  test('audit-ошибка не ломает 200-ответ', async () => {
    dispatch([
      [/UPDATE notifications_outbox/i, () => ({ rows: [{
        id: UUID, status: 'dead', last_error: 'cancelled_by_admin',
      }] })],
    ]);
    mockDb.query.mockRejectedValueOnce(new Error('audit_log offline'));
    const res = await supertest(buildApp())
      .post(`/api/v1/admin/outbox/${UUID}/cancel`).send({});
    expect(res.status).toBe(200);
  });
});
