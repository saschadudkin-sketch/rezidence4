'use strict';

/**
 * Phase 5 (platform-v1) — packages_v2 HTTP endpoint tests.
 * Spec: docs/product/specs/platform-v1/packages-v2-spec.md §4.
 *
 * Scope:
 *   • RBAC — residents/staff/admin per-endpoint (403 where disallowed)
 *   • /mine — empty when uid unknown in residents, payload shape
 *   • /metrics — period validation + RBAC
 *   • /:id     — 404 / 403 visibility rules (resident own-check via unit)
 *   • POST   — UUID-guards, staff_users resolution, outbox fan-out count
 *   • PATCH  — whitelist passthrough, 404 on miss
 *   • pickup — 400 on missing identity, 409 on wrong status, 200 happy
 *   • return — 409 terminal, 200 happy
 *   • mark-lost — admin only, confirm+reason required
 *   • remind  — 409 wrong status, 200 happy
 *
 * Wiring: mock `middleware/auth` + `db` + `express-rate-limit`.
 * Rate-limiter is stubbed so successive tests don't bump into its buckets.
 */

const { describe, test, expect, beforeEach } = require('@jest/globals');
const express = require('express');
const supertest = require('supertest');

jest.mock('../logger', () => require('../__mocks__/logger'));

// Rate-limit mock: pass-through, so per-test state не течёт между кейсами.
jest.mock('express-rate-limit', () => {
  const factory = () => (_req, _res, next) => next();
  factory.ipKeyGenerator = (req) => req.ip;
  return factory;
});

let mockCurrentUser = null;
jest.mock('../middleware/auth', () => (req, res, next) => {
  if (!mockCurrentUser) return res.status(401).json({ error: 'unauth' });
  req.user = { property_id: UUID, ...mockCurrentUser };
  next();
});

// Shared pg client that мы подменяем query-реализацию per-test.
const mockClient = { query: jest.fn(), release: jest.fn() };
const mockPool = {
  connect: jest.fn(async () => mockClient),
  query: jest.fn(),
};
const mockDb = {
  query: jest.fn(),  // unused (route uses db.pool), но audit пишет через db.query
  pool: mockPool,
};
jest.mock('../db', () => mockDb);

const packagesRouter = require('../v1/routes/packages');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/packages', packagesRouter);
  return app;
}

beforeEach(() => {
  mockCurrentUser = null;
  mockClient.query.mockReset();
  mockClient.release.mockReset();
  mockPool.connect.mockClear();
  mockPool.query.mockReset();
  mockDb.query.mockReset();
  // Default: audit writes succeed silently.
  mockDb.query.mockImplementation(() => Promise.resolve({ rows: [] }));
});

// dispatchQuery: route per-SQL substring, для и pool.query и client.query.
function dispatch(handlers, target = 'both') {
  const impl = (sql, args) => {
    for (const [needle, handler] of handlers) {
      if (typeof needle === 'string' && sql.includes(needle)) return Promise.resolve(handler(sql, args));
      if (needle instanceof RegExp && needle.test(sql)) return Promise.resolve(handler(sql, args));
    }
    return Promise.resolve({ rows: [] });
  };
  if (target === 'pool' || target === 'both') mockPool.query.mockImplementation(impl);
  if (target === 'client' || target === 'both') mockClient.query.mockImplementation(impl);
}

const UUID = '11111111-2222-3333-4444-555555555555';
const UUID2 = '22222222-2222-3333-4444-555555555555';
const UUID3 = '33333333-2222-3333-4444-555555555555';
const UUID4 = '44444444-2222-3333-4444-555555555555';

// ══════════════════════════════════════════════════════════════════════════════
// Auth defaults
// ══════════════════════════════════════════════════════════════════════════════

describe('authorization', () => {
  test('401 everywhere when no auth', async () => {
    const app = buildApp();
    for (const method of [
      ['get', '/api/v1/packages'],
      ['get', '/api/v1/packages/mine'],
      ['get', '/api/v1/packages/metrics?period=24h'],
      ['get', `/api/v1/packages/${UUID}`],
      ['post', '/api/v1/packages'],
      ['patch', `/api/v1/packages/${UUID}`],
      ['post', `/api/v1/packages/${UUID}/pickup`],
      ['post', `/api/v1/packages/${UUID}/return`],
      ['post', `/api/v1/packages/${UUID}/mark-lost`],
      ['post', `/api/v1/packages/${UUID}/remind`],
    ]) {
      const [verb, url] = method;
      const res = await supertest(app)[verb](url);
      expect(res.status).toBe(401);
    }
  });

  test('GET / rejects resident', async () => {
    mockCurrentUser = { uid: 'r1', role: 'resident' };
    const res = await supertest(buildApp()).get('/api/v1/packages');
    expect(res.status).toBe(403);
  });

  test('GET / rejects technician because packages are security/concierge/admin only', async () => {
    mockCurrentUser = { uid: 't1', role: 'technician' };
    const res = await supertest(buildApp()).get('/api/v1/packages');
    expect(res.status).toBe(403);
  });

  test('security can list, create, and pickup but cannot operate return/remind/patch', async () => {
    mockCurrentUser = { uid: 'guard-1', role: 'security' };
    dispatch([
      [/FROM packages_v2/, () => ({ rows: [] })],
    ]);

    const list = await supertest(buildApp()).get('/api/v1/packages');
    expect(list.status).toBe(200);

    const create = await supertest(buildApp()).post('/api/v1/packages').send({});
    expect(create.status).toBe(400);
    expect(create.body.error).toMatch(/property_id/);

    const pickup = await supertest(buildApp()).post('/api/v1/packages/not-a-uuid/pickup').send({});
    expect(pickup.status).toBe(400);
    expect(pickup.body.error).toMatch(/Invalid id/);

    const patch = await supertest(buildApp()).patch(`/api/v1/packages/${UUID}`).send({});
    expect(patch.status).toBe(403);
    const ret = await supertest(buildApp()).post(`/api/v1/packages/${UUID}/return`).send({});
    expect(ret.status).toBe(403);
    const remind = await supertest(buildApp()).post(`/api/v1/packages/${UUID}/remind`).send({});
    expect(remind.status).toBe(403);
  });

  test('GET /mine rejects staff', async () => {
    mockCurrentUser = { uid: 's1', role: 'concierge' };
    const res = await supertest(buildApp()).get('/api/v1/packages/mine');
    expect(res.status).toBe(403);
  });

  test('GET /metrics rejects staff (admin only)', async () => {
    mockCurrentUser = { uid: 's1', role: 'concierge' };
    const res = await supertest(buildApp()).get('/api/v1/packages/metrics?period=24h');
    expect(res.status).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/v1/packages/mine (resident)
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/v1/packages/mine', () => {
  beforeEach(() => { mockCurrentUser = { uid: 'legacy-uid', role: 'resident' }; });

  test('empty list for legacy user not in residents table', async () => {
    dispatch([
      [/FROM residents WHERE external_uid/, () => ({ rows: [] })],
    ]);
    const res = await supertest(buildApp()).get('/api/v1/packages/mine');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, packages: [], count: 0 });
  });

  test('happy path — resolves residentId + units, returns rows', async () => {
    dispatch([
      [/FROM residents WHERE external_uid/, () => ({ rows: [{ id: UUID }] })],
      [/FROM resident_unit_links[\s\S]*WHERE resident_id/, () => ({ rows: [{ unit_id: UUID2 }] })],
      [/FROM packages_v2/, () => ({ rows: [
        { id: UUID3, status: 'awaiting_pickup', recipient_resident_id: UUID },
      ] })],
    ]);
    const res = await supertest(buildApp()).get('/api/v1/packages/mine');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.packages[0].id).toBe(UUID3);
  });

  test('503 when DB rejects', async () => {
    dispatch([
      [/FROM residents WHERE external_uid/, () => { throw new Error('pool down'); }],
    ]);
    const res = await supertest(buildApp()).get('/api/v1/packages/mine');
    expect(res.status).toBe(503);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/v1/packages/metrics
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/v1/packages/metrics', () => {
  beforeEach(() => { mockCurrentUser = { uid: 'a1', role: 'admin' }; });

  test('400 on invalid period', async () => {
    const res = await supertest(buildApp()).get('/api/v1/packages/metrics?period=forever');
    expect(res.status).toBe(400);
  });

  test('happy with 7d default', async () => {
    dispatch([
      [/status = 'awaiting_pickup'/, () => ({ rows: [{ open_count: 5 }] })],
      [/AVG\(EXTRACT/, () => ({ rows: [{ avg_hours: 12.5 }] })],
      [/FILTER \(WHERE status = 'returned'\)/, () => ({ rows: [{ returned: 1, closed: 4 }] })],
      [/GROUP BY carrier/, () => ({ rows: [{ carrier: 'CDEK', total: 3 }] })],
    ]);
    const res = await supertest(buildApp()).get('/api/v1/packages/metrics?period=7d');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.period).toBe('7d');
    expect(res.body.open_count).toBe(5);
    expect(res.body.returned_rate).toBeCloseTo(0.25, 3);
    expect(res.body.top_carriers[0].carrier).toBe('CDEK');
  });

  test('route order: /metrics не поглощается /:id', async () => {
    // Если бы /metrics попал в /:id, был бы 400 Invalid id (metrics — не UUID).
    // Дополняем тест: путь /metrics с невалидным period падает с 400
    // именно metrics-validation, а не id-validation.
    const res = await supertest(buildApp()).get('/api/v1/packages/metrics?period=forever');
    expect(res.body.error).toMatch(/Allowed: 24h, 7d, 30d/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/v1/packages (staff/admin)
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/v1/packages (list)', () => {
  beforeEach(() => { mockCurrentUser = { uid: 's1', role: 'concierge' }; });

  test('happy list', async () => {
    dispatch([
      [/FROM packages_v2/, () => ({ rows: [
        { id: UUID, status: 'awaiting_pickup' }, { id: UUID2, status: 'picked_up' },
      ] })],
    ]);
    const res = await supertest(buildApp()).get('/api/v1/packages');
    expect(res.status).toBe(200);
    expect(res.body.packages).toHaveLength(2);
    expect(res.body.count).toBe(2);
  });

  test('400 on invalid filter', async () => {
    const res = await supertest(buildApp()).get('/api/v1/packages?status=bogus');
    expect(res.status).toBe(400);
  });

  test('passes filters through to service (status, since, until)', async () => {
    let lastArgs = null;
    dispatch([
      [/FROM packages_v2/, (_sql, args) => { lastArgs = args; return { rows: [] }; }],
    ]);
    const res = await supertest(buildApp())
      .get('/api/v1/packages?status=awaiting_pickup&since=2026-01-01T00:00:00Z');
    expect(res.status).toBe(200);
    expect(lastArgs[0]).toBe('awaiting_pickup');
    expect(lastArgs[1]).toBe('2026-01-01T00:00:00Z');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/v1/packages/:id
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/v1/packages/:id', () => {
  test('400 on bad id', async () => {
    mockCurrentUser = { uid: 's1', role: 'concierge' };
    const res = await supertest(buildApp()).get('/api/v1/packages/not-a-uuid');
    expect(res.status).toBe(400);
  });

  test('404 when not found', async () => {
    mockCurrentUser = { uid: 's1', role: 'concierge' };
    dispatch([[/FROM packages_v2/, () => ({ rows: [] })]]);
    const res = await supertest(buildApp()).get(`/api/v1/packages/${UUID}`);
    expect(res.status).toBe(404);
  });

  test('staff sees any', async () => {
    mockCurrentUser = { uid: 's1', role: 'concierge' };
    dispatch([[/FROM packages_v2/, () => ({ rows: [{
      id: UUID, status: 'awaiting_pickup', recipient_resident_id: null, unit_id: UUID2,
    }] })]]);
    const res = await supertest(buildApp()).get(`/api/v1/packages/${UUID}`);
    expect(res.status).toBe(200);
    expect(res.body.package.id).toBe(UUID);
  });

  test('resident 403 when not their unit and not their recipient', async () => {
    mockCurrentUser = { uid: 'r1', role: 'resident' };
    dispatch([
      [/FROM packages_v2/, () => ({ rows: [{
        id: UUID, recipient_resident_id: UUID3, unit_id: 'some-other-unit',
      }] })],
      [/FROM residents WHERE external_uid/, () => ({ rows: [{ id: UUID4 }] })], // me
      [/FROM resident_unit_links/, () => ({ rows: [{ unit_id: UUID2 }] })],    // my units
    ]);
    const res = await supertest(buildApp()).get(`/api/v1/packages/${UUID}`);
    expect(res.status).toBe(403);
  });

  test('resident 200 when recipient matches', async () => {
    mockCurrentUser = { uid: 'r1', role: 'resident' };
    dispatch([
      [/FROM packages_v2/, () => ({ rows: [{
        id: UUID, recipient_resident_id: UUID4, unit_id: 'any',
      }] })],
      [/FROM residents WHERE external_uid/, () => ({ rows: [{ id: UUID4 }] })], // me
    ]);
    const res = await supertest(buildApp()).get(`/api/v1/packages/${UUID}`);
    expect(res.status).toBe(200);
  });

  test('resident 200 when package address is their unit (recipient null)', async () => {
    mockCurrentUser = { uid: 'r1', role: 'resident' };
    dispatch([
      [/FROM packages_v2/, () => ({ rows: [{
        id: UUID, recipient_resident_id: null, unit_id: UUID2,
      }] })],
      [/FROM residents WHERE external_uid/, () => ({ rows: [{ id: UUID4 }] })],
      [/FROM resident_unit_links/, () => ({ rows: [{ unit_id: UUID2 }] })], // my unit matches
    ]);
    const res = await supertest(buildApp()).get(`/api/v1/packages/${UUID}`);
    expect(res.status).toBe(200);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/v1/packages
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/v1/packages', () => {
  beforeEach(() => { mockCurrentUser = { uid: 's1', role: 'concierge' }; });

  test('403 for resident', async () => {
    mockCurrentUser = { uid: 'r1', role: 'resident' };
    const res = await supertest(buildApp()).post('/api/v1/packages').send({
      property_id: UUID, unit_id: UUID2,
    });
    expect(res.status).toBe(403);
  });

  test('400 on missing property_id', async () => {
    const res = await supertest(buildApp()).post('/api/v1/packages').send({
      unit_id: UUID2,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/property_id/);
  });

  test('400 on missing unit_id', async () => {
    const res = await supertest(buildApp()).post('/api/v1/packages').send({
      property_id: UUID,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unit_id/);
  });

  test('403 on cross-property intake scope', async () => {
    mockCurrentUser = { uid: 's1', role: 'security', property_id: UUID2 };
    const res = await supertest(buildApp()).post('/api/v1/packages').send({
      property_id: UUID, unit_id: UUID2,
    });
    expect(res.status).toBe(403);
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  test('400 when staff not registered in staff_users', async () => {
    dispatch([
      [/FROM staff_users WHERE external_uid/, () => ({ rows: [] })],
    ], 'pool');
    const res = await supertest(buildApp()).post('/api/v1/packages').send({
      property_id: UUID, unit_id: UUID2,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/staff_users/);
  });

  test('201 happy — INSERT + outbox + audit reports fan-out count', async () => {
    // pool.query handles resolveStaffIdByUid.
    dispatch([
      [/FROM staff_users WHERE external_uid/, () => ({ rows: [{ id: UUID3 }] })],
    ], 'pool');
    // client.query handles transaction + INSERT.
    mockClient.query.mockImplementation((sql, _args) => {
      if (sql.includes('BEGIN')) return Promise.resolve({});
      if (sql.includes('INSERT INTO packages_v2')) return Promise.resolve({ rows: [{
        id: UUID4, property_id: UUID, unit_id: UUID2, status: 'awaiting_pickup',
        sender_name: null, carrier: null, tracking_number: null, storage_location: null,
      }] });
      if (sql.includes('FROM resident_unit_links')) return Promise.resolve({ rows: [
        { resident_id: 'r1' }, { resident_id: 'r2' },
      ] });
      // Phase 6: notification_templates_v2 lookup в той же транзакции.
      if (sql.includes('FROM notification_templates_v2')) return Promise.resolve({ rows: [{
        template_key: 'package.received', channel: null, locale: 'ru',
        subject: 'Вам посылка', body: 'Посылка ожидает.', url_template: '/packages/x',
      }] });
      if (sql.includes('INSERT INTO notifications_outbox')) return Promise.resolve({
        rows: [{ id: 'o1' }, { id: 'o2' }, { id: 'o3' }, { id: 'o4' }],
      });
      if (sql.includes('COMMIT')) return Promise.resolve({});
      return Promise.resolve({ rows: [] });
    });

    const res = await supertest(buildApp()).post('/api/v1/packages').send({
      property_id: UUID, unit_id: UUID2,
    });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.outbox_fanout).toBe(4);  // 2 residents × 2 channels
    expect(res.body.package.id).toBe(UUID4);
  });

  test('400 on bad photo_url (not /uploads/)', async () => {
    dispatch([
      [/FROM staff_users WHERE external_uid/, () => ({ rows: [{ id: UUID3 }] })],
    ], 'pool');
    // Must not reach INSERT — validation throws before client.connect.
    mockClient.query.mockImplementation((sql) => {
      if (sql.includes('BEGIN')) return Promise.resolve({});
      if (sql.includes('ROLLBACK')) return Promise.resolve({});
      return Promise.resolve({ rows: [] });
    });
    const res = await supertest(buildApp()).post('/api/v1/packages').send({
      property_id: UUID, unit_id: UUID2, photo_url: 'https://evil.tld/a.png',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/uploads/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PATCH /api/v1/packages/:id
// ══════════════════════════════════════════════════════════════════════════════

describe('PATCH /api/v1/packages/:id', () => {
  beforeEach(() => { mockCurrentUser = { uid: 's1', role: 'concierge' }; });

  test('404 when no row and empty patch (no update)', async () => {
    dispatch([[/FROM packages_v2 WHERE id/, () => ({ rows: [] })]], 'pool');
    const res = await supertest(buildApp()).patch(`/api/v1/packages/${UUID}`).send({});
    expect(res.status).toBe(404);
  });

  test('200 happy patch', async () => {
    dispatch([
      [/FROM packages_v2 WHERE id/, () => ({ rows: [{ id: UUID, property_id: UUID }] })],
      [/UPDATE packages_v2/, () => ({ rows: [{ id: UUID, carrier: 'CDEK' }] })],
    ], 'pool');
    const res = await supertest(buildApp()).patch(`/api/v1/packages/${UUID}`).send({
      carrier: 'CDEK',
    });
    expect(res.status).toBe(200);
    expect(res.body.package.carrier).toBe('CDEK');
  });

  test('400 on bad photo_url', async () => {
    const res = await supertest(buildApp()).patch(`/api/v1/packages/${UUID}`).send({
      photo_url: 'http://evil.tld/x.jpg',
    });
    expect(res.status).toBe(400);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/v1/packages/:id/pickup
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /:id/pickup', () => {
  beforeEach(() => { mockCurrentUser = { uid: 's1', role: 'concierge' }; });

  test('400 on missing identity', async () => {
    dispatch([
      [/FROM staff_users WHERE external_uid/, () => ({ rows: [{ id: UUID3 }] })],
    ], 'pool');
    const res = await supertest(buildApp()).post(`/api/v1/packages/${UUID}/pickup`).send({});
    expect(res.status).toBe(400);
  });

  test('400 when both identity fields provided', async () => {
    dispatch([
      [/FROM staff_users WHERE external_uid/, () => ({ rows: [{ id: UUID3 }] })],
    ], 'pool');
    const res = await supertest(buildApp()).post(`/api/v1/packages/${UUID}/pickup`).send({
      picked_up_by_resident_id: UUID2,
      picked_up_by_name: 'Courier',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/mutually exclusive/);
  });

  test('404 when not found', async () => {
    dispatch([
      [/FROM staff_users WHERE external_uid/, () => ({ rows: [{ id: UUID3 }] })],
    ], 'pool');
    mockClient.query.mockImplementation((sql) => {
      if (sql.includes('BEGIN')) return Promise.resolve({});
      if (sql.includes('FOR UPDATE')) return Promise.resolve({ rows: [] });
      if (sql.includes('ROLLBACK')) return Promise.resolve({});
      return Promise.resolve({ rows: [] });
    });
    const res = await supertest(buildApp()).post(`/api/v1/packages/${UUID}/pickup`).send({
      picked_up_by_resident_id: UUID2,
    });
    expect(res.status).toBe(404);
  });

  test('409 when status already terminal', async () => {
    dispatch([
      [/FROM staff_users WHERE external_uid/, () => ({ rows: [{ id: UUID3 }] })],
      [/FROM packages_v2 WHERE id/, () => ({ rows: [{
        id: UUID, property_id: UUID, status: 'picked_up',
      }] })],
    ], 'pool');
    mockClient.query.mockImplementation((sql) => {
      if (sql.includes('BEGIN')) return Promise.resolve({});
      if (sql.includes('FOR UPDATE')) return Promise.resolve({ rows: [{
        id: UUID, property_id: UUID, status: 'picked_up',
      }] });
      if (sql.includes('ROLLBACK')) return Promise.resolve({});
      return Promise.resolve({ rows: [] });
    });
    const res = await supertest(buildApp()).post(`/api/v1/packages/${UUID}/pickup`).send({
      picked_up_by_resident_id: UUID2,
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/picked_up/);
  });

  test('200 happy with resident pickup', async () => {
    dispatch([
      [/FROM staff_users WHERE external_uid/, () => ({ rows: [{ id: UUID3 }] })],
      [/FROM packages_v2 WHERE id/, () => ({ rows: [{
        id: UUID, property_id: UUID, status: 'awaiting_pickup',
      }] })],
    ], 'pool');
    mockClient.query.mockImplementation((sql) => {
      if (sql.includes('BEGIN')) return Promise.resolve({});
      if (sql.includes('FOR UPDATE')) return Promise.resolve({ rows: [{
        id: UUID, property_id: UUID, status: 'awaiting_pickup',
      }] });
      if (sql.includes('UPDATE packages_v2')) return Promise.resolve({ rows: [{
        id: UUID, status: 'picked_up', picked_up_by_resident_id: UUID2,
        picked_up_by_name: null, picked_up_at: '2026-04-20T00:00:00Z',
      }] });
      if (sql.includes('FROM notification_templates_v2')) return Promise.resolve({ rows: [{
        template_key: 'package.picked_up_confirmation', channel: null, locale: 'ru',
        subject: 'Посылка получена', body: 'Вы получили посылку.',
        url_template: '/packages/{{package_id}}',
      }] });
      if (sql.includes('INSERT INTO notifications_outbox')) return Promise.resolve({
        rows: [{ id: 'o1' }],
      });
      if (sql.includes('COMMIT')) return Promise.resolve({});
      return Promise.resolve({ rows: [] });
    });
    const res = await supertest(buildApp()).post(`/api/v1/packages/${UUID}/pickup`).send({
      picked_up_by_resident_id: UUID2,
    });
    expect(res.status).toBe(200);
    expect(res.body.package.status).toBe('picked_up');
    expect(res.body.outbox_fanout).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /:id/return
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /:id/return', () => {
  beforeEach(() => { mockCurrentUser = { uid: 's1', role: 'concierge' }; });

  test('409 on terminal', async () => {
    // AUDIT #2: service теперь pool.connect() → client.query, не pool.query.
    // default target='both' чтобы и client.query отвечал.
    dispatch([
      [/FROM packages_v2 WHERE id/, () => ({ rows: [{ status: 'picked_up' }] })],
    ]);
    const res = await supertest(buildApp()).post(`/api/v1/packages/${UUID}/return`)
      .send({ reason: 'x' });
    expect(res.status).toBe(409);
  });

  test('200 happy', async () => {
    dispatch([
      [/FROM packages_v2 WHERE id/, () => ({ rows: [{ status: 'awaiting_pickup' }] })],
      [/UPDATE packages_v2/, () => ({ rows: [{ id: UUID, status: 'returned', returned_reason: 'gone' }] })],
    ]);
    const res = await supertest(buildApp()).post(`/api/v1/packages/${UUID}/return`)
      .send({ reason: 'gone' });
    expect(res.status).toBe(200);
    expect(res.body.package.status).toBe('returned');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /:id/mark-lost
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /:id/mark-lost', () => {
  test('403 for staff (admin only)', async () => {
    mockCurrentUser = { uid: 's1', role: 'concierge' };
    const res = await supertest(buildApp()).post(`/api/v1/packages/${UUID}/mark-lost`)
      .send({ confirm: true, reason: 'x' });
    expect(res.status).toBe(403);
  });

  test('400 without confirm:true', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin' };
    const res = await supertest(buildApp()).post(`/api/v1/packages/${UUID}/mark-lost`)
      .send({ reason: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/confirm/i);
  });

  test('400 without reason', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin' };
    const res = await supertest(buildApp()).post(`/api/v1/packages/${UUID}/mark-lost`)
      .send({ confirm: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reason/);
  });

  test('200 admin happy', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin' };
    // AUDIT #2: см. POST /:id/return — default target='both'.
    dispatch([
      [/FROM packages_v2 WHERE id/, () => ({ rows: [{ status: 'awaiting_pickup' }] })],
      [/UPDATE packages_v2/, () => ({ rows: [{ id: UUID, status: 'lost', returned_reason: 'stolen' }] })],
    ]);
    const res = await supertest(buildApp()).post(`/api/v1/packages/${UUID}/mark-lost`)
      .send({ confirm: true, reason: 'stolen' });
    expect(res.status).toBe(200);
    expect(res.body.package.status).toBe('lost');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /:id/remind
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /:id/remind', () => {
  beforeEach(() => { mockCurrentUser = { uid: 's1', role: 'concierge' }; });

  test('409 on wrong status', async () => {
    mockPool.query.mockImplementation((sql) => {
      if (sql.includes('FROM packages_v2 WHERE id')) return Promise.resolve({ rows: [{
        id: UUID, status: 'picked_up', received_at: '2026-01-01',
        property_id: UUID, unit_id: UUID2, recipient_resident_id: UUID3,
      }] });
      return Promise.resolve({ rows: [] });
    });
    mockClient.query.mockImplementation((sql) => {
      if (sql.includes('BEGIN')) return Promise.resolve({});
      if (sql.includes('FROM packages_v2 WHERE id')) return Promise.resolve({ rows: [{
        id: UUID, status: 'picked_up', received_at: '2026-01-01',
        property_id: UUID, unit_id: UUID2, recipient_resident_id: UUID3,
      }] });
      if (sql.includes('ROLLBACK')) return Promise.resolve({});
      return Promise.resolve({ rows: [] });
    });
    const res = await supertest(buildApp()).post(`/api/v1/packages/${UUID}/remind`);
    expect(res.status).toBe(409);
  });

  test('200 happy with fan-out count', async () => {
    mockPool.query.mockImplementation((sql) => {
      if (sql.includes('FROM packages_v2 WHERE id')) return Promise.resolve({ rows: [{
        id: UUID, status: 'awaiting_pickup', received_at: new Date().toISOString(),
        property_id: UUID, unit_id: UUID2, recipient_resident_id: UUID3,
      }] });
      return Promise.resolve({ rows: [] });
    });
    mockClient.query.mockImplementation((sql) => {
      if (sql.includes('BEGIN')) return Promise.resolve({});
      if (sql.includes('FROM packages_v2 WHERE id')) return Promise.resolve({ rows: [{
        id: UUID, status: 'awaiting_pickup', received_at: new Date().toISOString(),
        property_id: UUID, unit_id: UUID2, recipient_resident_id: UUID3,
      }] });
      if (sql.includes('FROM notification_templates_v2')) return Promise.resolve({ rows: [{
        template_key: 'package.pickup_reminder', channel: null, locale: 'ru',
        subject: 'Напоминание', body: 'Ваша посылка ждёт вас.',
        url_template: '/packages/{{package_id}}',
      }] });
      if (sql.includes('INSERT INTO notifications_outbox')) return Promise.resolve({
        rows: [{ id: 'o1' }, { id: 'o2' }],
      });
      if (sql.includes('COMMIT')) return Promise.resolve({});
      return Promise.resolve({ rows: [] });
    });
    const res = await supertest(buildApp()).post(`/api/v1/packages/${UUID}/remind`);
    expect(res.status).toBe(200);
    expect(res.body.outbox_fanout).toBe(2);
  });
});
