'use strict';

/**
 * Phase 5 (platform-v1) — announcements_v2 HTTP endpoint tests.
 * Spec: docs/product/specs/platform-v1/announcements-v2-spec.md §4.
 *
 * Scope:
 *   • 401 matrix — все endpoint'ы защищены auth middleware'ом
 *   • GET /          — resident feed, staff hint
 *   • GET /:id       — visibility (staff all; resident own-visibility)
 *   • POST /         — create draft, RBAC, validation, staff_users resolve
 *   • PATCH /:id     — draft-only 409 / no-op 400 / not_found
 *   • POST /:id/publish — RBAC (urgent → admin only), conflict branches
 *   • POST /:id/unpublish — admin only
 *   • DELETE /:id    — admin only
 *   • Admin sub-router — list, metrics
 *   • Public sub-router — kiosk with slug
 *
 * Wiring: mock middleware/auth + db + express-rate-limit (pass-through).
 */

const { describe, test, expect, beforeEach } = require('@jest/globals');
const express = require('express');
const supertest = require('supertest');

jest.mock('../logger', () => require('../__mocks__/logger'));

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

const mockClient = { query: jest.fn(), release: jest.fn() };
const mockPool = {
  connect: jest.fn(async () => mockClient),
  query: jest.fn(),
};
const mockDb = {
  query: jest.fn(),
  pool: mockPool,
};
jest.mock('../db', () => mockDb);

const announcementsRouter = require('../v1/routes/announcements');
const { adminRouter, publicRouter } = announcementsRouter;

function buildApp(options = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/announcements', announcementsRouter);
  app.use('/api/v1/admin/announcements', adminRouter);
  if (options.property) {
    app.use('/api/v1/public/:slug/announcements', (req, _res, next) => {
      req.property = options.property;
      next();
    });
  }
  app.use('/api/v1/public/:slug/announcements', publicRouter);
  return app;
}

beforeEach(() => {
  mockCurrentUser = null;
  mockClient.query.mockReset();
  mockClient.release.mockReset();
  mockPool.connect.mockClear();
  mockPool.query.mockReset();
  mockDb.query.mockReset();
  mockDb.query.mockImplementation(() => Promise.resolve({ rows: [] }));
});

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
// auth matrix
// ══════════════════════════════════════════════════════════════════════════════

describe('authorization', () => {
  test('401 on main router without auth', async () => {
    const app = buildApp();
    for (const m of [
      ['get', '/api/v1/announcements'],
      ['get', `/api/v1/announcements/${UUID}`],
      ['post', '/api/v1/announcements'],
      ['patch', `/api/v1/announcements/${UUID}`],
      ['post', `/api/v1/announcements/${UUID}/publish`],
      ['post', `/api/v1/announcements/${UUID}/unpublish`],
      ['delete', `/api/v1/announcements/${UUID}`],
    ]) {
      const res = await supertest(app)[m[0]](m[1]);
      expect(res.status).toBe(401);
    }
  });
  test('401 on admin sub-router without auth', async () => {
    const res = await supertest(buildApp()).get(`/api/v1/admin/announcements?property_id=${UUID}`);
    expect(res.status).toBe(401);
  });
  test('public sub-router does not require auth', async () => {
    dispatch([
      [/FROM properties WHERE slug/, () => ({ rows: [{ id: UUID }] })],
      [/FROM announcements_v2/, () => ({ rows: [] })],
    ]);
    const res = await supertest(buildApp()).get('/api/v1/public/zamosk/announcements');
    expect(res.status).toBe(200);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/v1/announcements (resident feed)
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/v1/announcements', () => {
  test('403 for non-resident, non-staff role', async () => {
    mockCurrentUser = { uid: 'x', role: 'bogus_role' };
    const res = await supertest(buildApp()).get('/api/v1/announcements');
    expect(res.status).toBe(403);
  });

  test('resident: empty list for legacy user not in residents', async () => {
    mockCurrentUser = { uid: 'legacy', role: 'resident' };
    dispatch([
      [/FROM residents r[\s\S]*JOIN units u/, () => ({ rows: [] })],
    ]);
    const res = await supertest(buildApp()).get('/api/v1/announcements');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, announcements: [], count: 0 });
  });

  test('resident happy: resolves context + lists matched', async () => {
    mockCurrentUser = { uid: 'r1', role: 'resident' };
    dispatch([
      [/FROM residents r[\s\S]*JOIN units u/, () => ({ rows: [{
        id: UUID, property_id: UUID2, unit_id: UUID3,
        building_id: UUID4, entrance_id: 'e1', resident_type: 'owner',
      }] })],
      [/FROM announcements_v2/, () => ({ rows: [
        { id: UUID, title: 'A', is_pinned: true, is_urgent: true, audience_type: 'all' },
        { id: UUID2, title: 'B', audience_type: 'building' },
      ] })],
    ]);
    const res = await supertest(buildApp()).get('/api/v1/announcements');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.announcements[0].id).toBe(UUID);
  });

  test('staff: returns hint pointing to admin endpoint', async () => {
    mockCurrentUser = { uid: 's1', role: 'concierge' };
    const res = await supertest(buildApp()).get('/api/v1/announcements');
    expect(res.status).toBe(200);
    expect(res.body.hint).toMatch(/admin\/announcements/);
  });

  test('403 for technician role', async () => {
    mockCurrentUser = { uid: 't1', role: 'technician' };
    const res = await supertest(buildApp()).get('/api/v1/announcements');
    expect(res.status).toBe(403);
  });

  test('503 when DB rejects', async () => {
    mockCurrentUser = { uid: 'r1', role: 'resident' };
    dispatch([[/FROM residents/, () => { throw new Error('db down'); }]]);
    const res = await supertest(buildApp()).get('/api/v1/announcements');
    expect(res.status).toBe(503);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/v1/announcements/:id
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/v1/announcements/:id', () => {
  test('400 on bad id', async () => {
    mockCurrentUser = { uid: 's1', role: 'concierge' };
    const res = await supertest(buildApp()).get('/api/v1/announcements/not-a-uuid');
    expect(res.status).toBe(400);
  });
  test('404 when row missing', async () => {
    mockCurrentUser = { uid: 's1', role: 'concierge' };
    dispatch([[/FROM announcements_v2/, () => ({ rows: [] })]]);
    const res = await supertest(buildApp()).get(`/api/v1/announcements/${UUID}`);
    expect(res.status).toBe(404);
  });
  test('404 when row soft-deleted', async () => {
    mockCurrentUser = { uid: 's1', role: 'concierge' };
    dispatch([[/FROM announcements_v2/, () => ({ rows: [{
      id: UUID, deleted_at: new Date(), published_at: null,
    }] })]]);
    const res = await supertest(buildApp()).get(`/api/v1/announcements/${UUID}`);
    expect(res.status).toBe(404);
  });
  test('staff sees any (including draft)', async () => {
    mockCurrentUser = { uid: 's1', role: 'concierge' };
    dispatch([[/FROM announcements_v2/, () => ({ rows: [{
      id: UUID, title: 'draft', deleted_at: null, published_at: null,
      audience_type: 'all', starts_at: new Date().toISOString(),
    }] })]]);
    const res = await supertest(buildApp()).get(`/api/v1/announcements/${UUID}`);
    expect(res.status).toBe(200);
    expect(res.body.announcement.id).toBe(UUID);
  });
  test('403 for technician even when row exists', async () => {
    mockCurrentUser = { uid: 't1', role: 'technician' };
    dispatch([[/FROM announcements_v2/, () => ({ rows: [{
      id: UUID, title: 'draft', deleted_at: null, published_at: null,
      audience_type: 'all', starts_at: new Date().toISOString(),
    }] })]]);
    const res = await supertest(buildApp()).get(`/api/v1/announcements/${UUID}`);
    expect(res.status).toBe(403);
  });
  test('resident 404 on unpublished', async () => {
    mockCurrentUser = { uid: 'r1', role: 'resident' };
    dispatch([[/FROM announcements_v2/, () => ({ rows: [{
      id: UUID, published_at: null, deleted_at: null,
    }] })]]);
    const res = await supertest(buildApp()).get(`/api/v1/announcements/${UUID}`);
    expect(res.status).toBe(404);
  });
  test('resident 404 when audience mismatch', async () => {
    mockCurrentUser = { uid: 'r1', role: 'resident' };
    dispatch([
      [/FROM announcements_v2/, () => ({ rows: [{
        id: UUID, published_at: new Date().toISOString(), deleted_at: null,
        audience_type: 'building', audience_building_id: 'other-building',
        starts_at: new Date(Date.now() - 1000).toISOString(),
        expires_at: null,
      }] })],
      [/FROM residents r[\s\S]*JOIN units u/, () => ({ rows: [{
        id: UUID2, property_id: UUID3, unit_id: UUID4,
        building_id: 'my-building', entrance_id: 'e1', resident_type: 'owner',
      }] })],
    ]);
    const res = await supertest(buildApp()).get(`/api/v1/announcements/${UUID}`);
    expect(res.status).toBe(404);
  });
  test('resident 200 on audience=all within time window', async () => {
    mockCurrentUser = { uid: 'r1', role: 'resident' };
    dispatch([
      [/FROM announcements_v2/, () => ({ rows: [{
        id: UUID, published_at: new Date().toISOString(), deleted_at: null,
        audience_type: 'all', audience_building_id: null, audience_entrance_id: null, audience_unit_type: null,
        starts_at: new Date(Date.now() - 1000).toISOString(), expires_at: null,
      }] })],
      [/FROM residents r[\s\S]*JOIN units u/, () => ({ rows: [{
        id: UUID2, property_id: UUID3, unit_id: UUID4,
        building_id: 'b1', entrance_id: 'e1', resident_type: 'owner',
      }] })],
    ]);
    const res = await supertest(buildApp()).get(`/api/v1/announcements/${UUID}`);
    expect(res.status).toBe(200);
  });
  test('resident 404 when starts_at in future', async () => {
    mockCurrentUser = { uid: 'r1', role: 'resident' };
    dispatch([
      [/FROM announcements_v2/, () => ({ rows: [{
        id: UUID, published_at: new Date().toISOString(), deleted_at: null,
        audience_type: 'all', audience_building_id: null, audience_entrance_id: null, audience_unit_type: null,
        starts_at: new Date(Date.now() + 3600_000).toISOString(),
        expires_at: null,
      }] })],
      [/FROM residents r[\s\S]*JOIN units u/, () => ({ rows: [{
        id: UUID2, building_id: 'b1', entrance_id: 'e1', resident_type: 'owner',
      }] })],
    ]);
    const res = await supertest(buildApp()).get(`/api/v1/announcements/${UUID}`);
    expect(res.status).toBe(404);
  });
  test('resident 404 when expired', async () => {
    mockCurrentUser = { uid: 'r1', role: 'resident' };
    dispatch([
      [/FROM announcements_v2/, () => ({ rows: [{
        id: UUID, published_at: new Date().toISOString(), deleted_at: null,
        audience_type: 'all', audience_building_id: null, audience_entrance_id: null, audience_unit_type: null,
        starts_at: new Date(Date.now() - 3600_000).toISOString(),
        expires_at: new Date(Date.now() - 1000).toISOString(),
      }] })],
      [/FROM residents r[\s\S]*JOIN units u/, () => ({ rows: [{
        id: UUID2, building_id: 'b1', entrance_id: 'e1', resident_type: 'owner',
      }] })],
    ]);
    const res = await supertest(buildApp()).get(`/api/v1/announcements/${UUID}`);
    expect(res.status).toBe(404);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/v1/announcements
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/v1/announcements', () => {
  beforeEach(() => { mockCurrentUser = { uid: 's1', role: 'concierge' }; });

  test('403 for resident', async () => {
    mockCurrentUser = { uid: 'r1', role: 'resident' };
    const res = await supertest(buildApp()).post('/api/v1/announcements').send({
      property_id: UUID, title: 't', body_md: 'b',
    });
    expect(res.status).toBe(403);
  });

  test.each(['security', 'technician'])('403 for %s', async (role) => {
    mockCurrentUser = { uid: `${role}-1`, role };
    const res = await supertest(buildApp()).post('/api/v1/announcements').send({
      property_id: UUID, title: 't', body_md: 'b',
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Concierge or admin/);
  });

  test('400 without property_id', async () => {
    const res = await supertest(buildApp()).post('/api/v1/announcements').send({
      title: 't', body_md: 'b',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/property_id/);
  });

  test('400 when staff not in staff_users', async () => {
    dispatch([[/FROM staff_users WHERE external_uid/, () => ({ rows: [] })]], 'pool');
    const res = await supertest(buildApp()).post('/api/v1/announcements').send({
      property_id: UUID, title: 't', body_md: 'b',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/staff_users/);
  });

  test('400 on invalid body_md (empty)', async () => {
    dispatch([[/FROM staff_users WHERE external_uid/, () => ({ rows: [{ id: UUID2 }] })]], 'pool');
    const res = await supertest(buildApp()).post('/api/v1/announcements').send({
      property_id: UUID, title: 't', body_md: '   ',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/body_md/);
  });

  test('201 happy — creates draft, audits, returns row', async () => {
    dispatch([
      [/FROM staff_users WHERE external_uid/, () => ({ rows: [{ id: UUID2 }] })],
      [/INSERT INTO announcements_v2/, () => ({ rows: [{
        id: UUID3, title: 't', body_md: 'b', category: 'general',
        audience_type: 'all', is_urgent: false, published_at: null,
      }] })],
    ], 'pool');
    const res = await supertest(buildApp()).post('/api/v1/announcements').send({
      property_id: UUID, title: 't', body_md: 'b',
    });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.announcement.id).toBe(UUID3);
  });

  test('400 on invalid audience', async () => {
    dispatch([[/FROM staff_users WHERE external_uid/, () => ({ rows: [{ id: UUID2 }] })]], 'pool');
    const res = await supertest(buildApp()).post('/api/v1/announcements').send({
      property_id: UUID, title: 't', body_md: 'b',
      audience_type: 'building', // no building_id
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/audience_building_id/);
  });

  test('400 on is_urgent without web_push channel', async () => {
    dispatch([[/FROM staff_users WHERE external_uid/, () => ({ rows: [{ id: UUID2 }] })]], 'pool');
    const res = await supertest(buildApp()).post('/api/v1/announcements').send({
      property_id: UUID, title: 't', body_md: 'b',
      is_urgent: true, notify_channels: ['sms'],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/web_push/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PATCH /api/v1/announcements/:id
// ══════════════════════════════════════════════════════════════════════════════

describe('PATCH /api/v1/announcements/:id', () => {
  beforeEach(() => { mockCurrentUser = { uid: 's1', role: 'concierge' }; });

  test('400 on bad id', async () => {
    const res = await supertest(buildApp()).patch('/api/v1/announcements/bad').send({ title: 'x' });
    expect(res.status).toBe(400);
  });

  test('403 for resident', async () => {
    mockCurrentUser = { uid: 'r1', role: 'resident' };
    const res = await supertest(buildApp()).patch(`/api/v1/announcements/${UUID}`).send({ title: 'x' });
    expect(res.status).toBe(403);
  });

  test.each(['security', 'technician'])('403 for %s', async (role) => {
    mockCurrentUser = { uid: `${role}-1`, role };
    const res = await supertest(buildApp()).patch(`/api/v1/announcements/${UUID}`).send({ title: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Concierge or admin/);
  });

  test('400 on noop (empty patch)', async () => {
    const res = await supertest(buildApp()).patch(`/api/v1/announcements/${UUID}`).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No fields/);
  });

  test('404 when not found', async () => {
    dispatch([
      [/UPDATE announcements_v2/, () => ({ rows: [] })],
      [/SELECT id, published_at, deleted_at/, () => ({ rows: [] })],
    ], 'pool');
    const res = await supertest(buildApp()).patch(`/api/v1/announcements/${UUID}`).send({ title: 'x' });
    expect(res.status).toBe(404);
  });

  test('409 when already published', async () => {
    dispatch([
      [/FROM announcements_v2 WHERE id = \$1/, () => ({ rows: [{
        id: UUID, published_at: new Date(), deleted_at: null,
      }] })],
      [/UPDATE announcements_v2/, () => ({ rows: [] })],
      [/SELECT id, published_at, deleted_at/, () => ({ rows: [{
        id: UUID, published_at: new Date(), deleted_at: null,
      }] })],
    ], 'pool');
    const res = await supertest(buildApp()).patch(`/api/v1/announcements/${UUID}`).send({ title: 'x' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Cannot edit/);
  });

  test('200 happy patch', async () => {
    dispatch([
      [/FROM announcements_v2 WHERE id = \$1/, () => ({ rows: [{
        id: UUID, title: 'old', published_at: null, deleted_at: null,
      }] })],
      [/UPDATE announcements_v2/, () => ({ rows: [{
        id: UUID, title: 'new', published_at: null,
      }] })],
    ], 'pool');
    const res = await supertest(buildApp()).patch(`/api/v1/announcements/${UUID}`).send({
      title: 'new', is_pinned: true, body_md: 'body',
    });
    expect(res.status).toBe(200);
    expect(res.body.announcement.title).toBe('new');
  });

  test('400 on invalid channel in patch', async () => {
    const res = await supertest(buildApp()).patch(`/api/v1/announcements/${UUID}`).send({
      notify_channels: ['carrier_pigeon'],
    });
    expect(res.status).toBe(400);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/v1/announcements/:id/publish
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /:id/publish', () => {
  test('403 for resident', async () => {
    mockCurrentUser = { uid: 'r1', role: 'resident' };
    const res = await supertest(buildApp()).post(`/api/v1/announcements/${UUID}/publish`).send({});
    expect(res.status).toBe(403);
  });

  test.each(['security', 'technician'])('403 for %s', async (role) => {
    mockCurrentUser = { uid: `${role}-1`, role };
    const res = await supertest(buildApp()).post(`/api/v1/announcements/${UUID}/publish`).send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Concierge or admin/);
  });

  test('400 on bad id', async () => {
    mockCurrentUser = { uid: 's1', role: 'concierge' };
    const res = await supertest(buildApp()).post('/api/v1/announcements/bad/publish').send({});
    expect(res.status).toBe(400);
  });

  test('404 when announcement missing', async () => {
    mockCurrentUser = { uid: 's1', role: 'concierge' };
    dispatch([[/FROM announcements_v2/, () => ({ rows: [] })]]);
    const res = await supertest(buildApp()).post(`/api/v1/announcements/${UUID}/publish`).send({});
    expect(res.status).toBe(404);
  });

  test('403 concierge cannot publish urgent', async () => {
    mockCurrentUser = { uid: 's1', role: 'concierge' };
    dispatch([[/FROM announcements_v2/, () => ({ rows: [{
      id: UUID, is_urgent: true, deleted_at: null, published_at: null,
    }] })]]);
    const res = await supertest(buildApp()).post(`/api/v1/announcements/${UUID}/publish`).send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/urgent/);
  });

  test('admin can publish urgent happy path', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin', property_id: UUID2 };
    // getById pre-check + pool.query + client.query for transaction.
    const draft = {
      id: UUID, property_id: UUID2, title: 't', body_md: 'b',
      is_urgent: true, category: 'emergency',
      audience_type: 'all', audience_building_id: null, audience_entrance_id: null, audience_unit_type: null,
      starts_at: new Date(Date.now() - 1000).toISOString(),
      expires_at: null, is_pinned: false,
      notify_channels: ['web_push', 'sms'],
      published_at: null, deleted_at: null,
    };
    const published = { ...draft, published_at: new Date().toISOString() };
    mockPool.query.mockImplementation((sql) => {
      if (sql.includes('FROM announcements_v2')) return Promise.resolve({ rows: [draft] });
      if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: UUID3 }] });
      return Promise.resolve({ rows: [] });
    });
    mockClient.query.mockImplementation((sql) => {
      if (sql.includes('BEGIN')) return Promise.resolve({});
      if (sql.includes('FOR UPDATE')) return Promise.resolve({ rows: [draft] });
      if (sql.includes('UPDATE announcements_v2')) return Promise.resolve({ rows: [published] });
      if (sql.includes('FROM residents WHERE property_id')) return Promise.resolve({
        rows: [{ id: 'r1' }, { id: 'r2' }],
      });
      if (sql.includes('INSERT INTO notifications_outbox')) return Promise.resolve({
        rows: [{ id: 'o1' }, { id: 'o2' }, { id: 'o3' }, { id: 'o4' }],
      });
      if (sql.includes('COMMIT')) return Promise.resolve({});
      return Promise.resolve({ rows: [] });
    });
    const res = await supertest(buildApp()).post(`/api/v1/announcements/${UUID}/publish`).send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.outbox_fanout).toBe(4);
  });

  test('concierge can publish non-urgent', async () => {
    mockCurrentUser = { uid: 's1', role: 'concierge', property_id: UUID2 };
    const draft = {
      id: UUID, property_id: UUID2, is_urgent: false,
      audience_type: 'all', starts_at: new Date(Date.now() - 1000).toISOString(),
      expires_at: null, notify_channels: ['web_push'],
      published_at: null, deleted_at: null,
      title: 't', body_md: 'b', category: 'general', is_pinned: false,
      audience_building_id: null, audience_entrance_id: null, audience_unit_type: null,
    };
    const published = { ...draft, published_at: new Date().toISOString() };
    mockPool.query.mockImplementation((sql) => {
      if (sql.includes('FROM announcements_v2')) return Promise.resolve({ rows: [draft] });
      if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: UUID3 }] });
      return Promise.resolve({ rows: [] });
    });
    mockClient.query.mockImplementation((sql) => {
      if (sql.includes('BEGIN')) return Promise.resolve({});
      if (sql.includes('FOR UPDATE')) return Promise.resolve({ rows: [draft] });
      if (sql.includes('UPDATE announcements_v2')) return Promise.resolve({ rows: [published] });
      if (sql.includes('FROM residents WHERE property_id')) return Promise.resolve({
        rows: [{ id: 'r1' }],
      });
      if (sql.includes('INSERT INTO notifications_outbox')) return Promise.resolve({
        rows: [{ id: 'o1' }],
      });
      if (sql.includes('COMMIT')) return Promise.resolve({});
      return Promise.resolve({ rows: [] });
    });
    const res = await supertest(buildApp()).post(`/api/v1/announcements/${UUID}/publish`).send({});
    expect(res.status).toBe(200);
    expect(res.body.outbox_fanout).toBe(1);
  });

  test('409 already_published (idempotency)', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin' };
    const published = {
      id: UUID, is_urgent: false, published_at: new Date().toISOString(), deleted_at: null,
      audience_type: 'all', starts_at: new Date().toISOString(),
    };
    mockPool.query.mockImplementation((sql) => {
      if (sql.includes('FROM announcements_v2')) return Promise.resolve({ rows: [published] });
      if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: UUID3 }] });
      return Promise.resolve({ rows: [] });
    });
    mockClient.query.mockImplementation((sql) => {
      if (sql.includes('BEGIN')) return Promise.resolve({});
      if (sql.includes('FOR UPDATE')) return Promise.resolve({ rows: [published] });
      if (sql.includes('ROLLBACK')) return Promise.resolve({});
      return Promise.resolve({ rows: [] });
    });
    const res = await supertest(buildApp()).post(`/api/v1/announcements/${UUID}/publish`).send({});
    expect(res.status).toBe(409);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /:id/unpublish (admin only)
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /:id/unpublish', () => {
  test('403 for concierge (admin only)', async () => {
    mockCurrentUser = { uid: 's1', role: 'concierge' };
    const res = await supertest(buildApp()).post(`/api/v1/announcements/${UUID}/unpublish`);
    expect(res.status).toBe(403);
  });
  test('200 admin happy', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin' };
    dispatch([
      [/FROM announcements_v2 WHERE id = \$1/, () => ({ rows: [{
        id: UUID, published_at: new Date(), deleted_at: null,
      }] })],
      [/UPDATE announcements_v2/, () => ({ rows: [{ id: UUID, published_at: null }] })],
    ], 'pool');
    const res = await supertest(buildApp()).post(`/api/v1/announcements/${UUID}/unpublish`);
    expect(res.status).toBe(200);
  });
  test('409 when not published', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin' };
    dispatch([
      [/FROM announcements_v2 WHERE id = \$1/, () => ({ rows: [{
        id: UUID, published_at: null, deleted_at: null,
      }] })],
      [/UPDATE announcements_v2/, () => ({ rows: [] })],
      [/SELECT id, published_at, deleted_at/, () => ({ rows: [{
        id: UUID, published_at: null, deleted_at: null,
      }] })],
    ], 'pool');
    const res = await supertest(buildApp()).post(`/api/v1/announcements/${UUID}/unpublish`);
    expect(res.status).toBe(409);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// DELETE /:id (admin only)
// ══════════════════════════════════════════════════════════════════════════════

describe('DELETE /:id', () => {
  test('403 for concierge', async () => {
    mockCurrentUser = { uid: 's1', role: 'concierge' };
    const res = await supertest(buildApp()).delete(`/api/v1/announcements/${UUID}`);
    expect(res.status).toBe(403);
  });
  test('200 admin happy', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin' };
    dispatch([
      [/FROM announcements_v2 WHERE id = \$1/, () => ({ rows: [{
        id: UUID, deleted_at: null,
      }] })],
      [/UPDATE announcements_v2/, () => ({ rows: [{ id: UUID, deleted_at: new Date() }] })],
    ], 'pool');
    const res = await supertest(buildApp()).delete(`/api/v1/announcements/${UUID}`);
    expect(res.status).toBe(200);
  });
  test('404 when not found', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin' };
    dispatch([
      [/UPDATE announcements_v2/, () => ({ rows: [] })],
      [/SELECT id, deleted_at FROM announcements_v2/, () => ({ rows: [] })],
    ], 'pool');
    const res = await supertest(buildApp()).delete(`/api/v1/announcements/${UUID}`);
    expect(res.status).toBe(404);
  });
  test('409 when already deleted', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin' };
    dispatch([
      [/FROM announcements_v2 WHERE id = \$1/, () => ({ rows: [{
        id: UUID, deleted_at: new Date(),
      }] })],
      [/UPDATE announcements_v2/, () => ({ rows: [] })],
      [/SELECT id, deleted_at FROM announcements_v2/, () => ({ rows: [{
        id: UUID, deleted_at: new Date(),
      }] })],
    ], 'pool');
    const res = await supertest(buildApp()).delete(`/api/v1/announcements/${UUID}`);
    expect(res.status).toBe(409);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Admin sub-router
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/v1/admin/announcements', () => {
  test('403 for resident', async () => {
    mockCurrentUser = { uid: 'r1', role: 'resident' };
    const res = await supertest(buildApp()).get(`/api/v1/admin/announcements?property_id=${UUID}`);
    expect(res.status).toBe(403);
  });
  test.each(['security', 'technician'])('403 for %s', async (role) => {
    mockCurrentUser = { uid: `${role}-1`, role };
    const res = await supertest(buildApp()).get(`/api/v1/admin/announcements?property_id=${UUID}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Concierge or admin/);
  });
  test('400 without property_id', async () => {
    mockCurrentUser = { uid: 's1', role: 'concierge' };
    const res = await supertest(buildApp()).get('/api/v1/admin/announcements');
    expect(res.status).toBe(400);
  });
  test('403 on cross-property admin list scope', async () => {
    mockCurrentUser = { uid: 's1', role: 'concierge', property_id: UUID };
    const res = await supertest(buildApp()).get(`/api/v1/admin/announcements?property_id=${UUID2}`);
    expect(res.status).toBe(403);
    expect(mockPool.query).not.toHaveBeenCalled();
  });
  test('400 on non-UUID property_id', async () => {
    mockCurrentUser = { uid: 's1', role: 'concierge' };
    const res = await supertest(buildApp()).get('/api/v1/admin/announcements?property_id=bad');
    expect(res.status).toBe(400);
  });
  test('200 happy with status filter', async () => {
    mockCurrentUser = { uid: 's1', role: 'concierge' };
    dispatch([[/FROM announcements_v2/, () => ({ rows: [
      { id: UUID, title: 'A', published_at: null }, { id: UUID2, title: 'B', published_at: null },
    ] })]]);
    const res = await supertest(buildApp())
      .get(`/api/v1/admin/announcements?property_id=${UUID}&status=draft`);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
  });
  test('400 on bad status filter', async () => {
    mockCurrentUser = { uid: 's1', role: 'concierge' };
    const res = await supertest(buildApp())
      .get(`/api/v1/admin/announcements?property_id=${UUID}&status=bogus`);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/admin/announcements/:id/metrics', () => {
  test('403 for concierge (admin only)', async () => {
    mockCurrentUser = { uid: 's1', role: 'concierge' };
    const res = await supertest(buildApp()).get(`/api/v1/admin/announcements/${UUID}/metrics`);
    expect(res.status).toBe(403);
  });
  test('404 when announcement missing', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin' };
    dispatch([[/SELECT id, property_id, audience_type/, () => ({ rows: [] })]]);
    const res = await supertest(buildApp()).get(`/api/v1/admin/announcements/${UUID}/metrics`);
    expect(res.status).toBe(404);
  });
  test('200 happy with metrics shape', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin', property_id: UUID2 };
    dispatch([
      [/SELECT property_id FROM announcements_v2 WHERE id = \$1/, () => ({ rows: [{ property_id: UUID2 }] })],
      [/SELECT id, property_id, audience_type/, () => ({ rows: [{
        id: UUID, property_id: UUID2, audience_type: 'all',
        audience_building_id: null, audience_entrance_id: null, audience_unit_type: null,
      }] })],
      [/SELECT COUNT\(\*\)::int AS n FROM residents WHERE property_id = \$1 AND is_active = true\s*$/,
        () => ({ rows: [{ n: 50 }] })],
      [/FROM notifications_outbox WHERE correlation_id/, () => ({ rows: [{ n: 100 }] })],
      [/FROM notification_log_v2/, () => ({ rows: [
        { status: 'delivered', n: 80 },
        { status: 'failed', n: 5 },
      ] })],
    ]);
    const res = await supertest(buildApp()).get(`/api/v1/admin/announcements/${UUID}/metrics`);
    expect(res.status).toBe(200);
    expect(res.body.metrics.audience_size).toBe(50);
    expect(res.body.metrics.outbox_count).toBe(100);
    expect(res.body.metrics.log_delivered).toBe(80);
    expect(res.body.metrics.log_failed).toBe(5);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Public sub-router
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/v1/public/:slug/announcements', () => {
  test('400 on invalid slug (too long)', async () => {
    const slug = 'a'.repeat(150);
    const res = await supertest(buildApp()).get(`/api/v1/public/${slug}/announcements`);
    expect(res.status).toBe(400);
  });
  test('404 when property unknown', async () => {
    dispatch([[/FROM properties WHERE slug/, () => ({ rows: [] })]]);
    const res = await supertest(buildApp()).get('/api/v1/public/unknown/announcements');
    expect(res.status).toBe(404);
  });
  test('200 happy with emergency/maintenance only', async () => {
    dispatch([
      [/FROM properties WHERE slug/, () => ({ rows: [{ id: UUID }] })],
      [/FROM announcements_v2/, () => ({ rows: [
        { id: UUID, title: 'Отключение воды', category: 'maintenance' },
      ] })],
    ]);
    const res = await supertest(buildApp()).get('/api/v1/public/zamosk/announcements');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.announcements[0].category).toBe('maintenance');
  });

  test('uses tenant middleware property context before slug lookup', async () => {
    dispatch([
      [/FROM announcements_v2/, () => ({ rows: [
        { id: UUID, title: 'Отключение воды', category: 'maintenance' },
      ] })],
    ]);
    const res = await supertest(buildApp({ property: { id: UUID } }))
      .get('/api/v1/public/zamosk/announcements');
    expect(res.status).toBe(200);
    expect(mockPool.query.mock.calls.some(([sql]) => String(sql).includes('FROM properties'))).toBe(false);
  });
});
