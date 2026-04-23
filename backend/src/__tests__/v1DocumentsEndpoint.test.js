'use strict';

/**
 * Phase 5 (platform-v1) — documents_v2 HTTP endpoint tests.
 * Spec: docs/product/specs/platform-v1/documents-v2-spec.md §3.
 *
 * Scope:
 *   • 401 matrix — main + admin sub-router protected; public sub-router open
 *   • GET /                 — resident/staff visibility, property_id param for staff
 *   • GET /:id              — staff all, resident own-property+published
 *   • POST /                — create draft/publishNow, staff_users resolve,
 *                             concierge blocked from legal/contracts
 *   • PATCH /:id            — whitelist + snapshot-on-PATCH (trusts service),
 *                             conflicts not_found/deleted, noop 400
 *   • POST /:id/publish     — idempotent 200, not_found, deleted, concierge
 *                             blocked from legal
 *   • POST /:id/unpublish   — admin only, conflict branches
 *   • DELETE /:id           — admin only, not_found, already_deleted
 *   • Admin sub-router      — /:id/versions list, /:id/versions/:version detail
 *   • Public sub-router     — /api/v1/public/:slug/documents (kiosk)
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
  req.user = mockCurrentUser;
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

const documentsRouter = require('../v1/routes/documents');
const { adminRouter, publicRouter } = documentsRouter;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/documents', documentsRouter);
  app.use('/api/v1/admin/documents', adminRouter);
  app.use('/api/v1/public/:slug/documents', publicRouter);
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
      ['get', '/api/v1/documents'],
      ['get', `/api/v1/documents/${UUID}`],
      ['post', '/api/v1/documents'],
      ['patch', `/api/v1/documents/${UUID}`],
      ['post', `/api/v1/documents/${UUID}/publish`],
      ['post', `/api/v1/documents/${UUID}/unpublish`],
      ['delete', `/api/v1/documents/${UUID}`],
    ]) {
      const res = await supertest(app)[m[0]](m[1]);
      expect(res.status).toBe(401);
    }
  });
  test('401 on admin sub-router without auth', async () => {
    const res = await supertest(buildApp()).get(`/api/v1/admin/documents/${UUID}/versions`);
    expect(res.status).toBe(401);
  });
  test('public sub-router does not require auth', async () => {
    dispatch([
      [/FROM properties WHERE slug/, () => ({ rows: [{ id: UUID }] })],
      [/FROM documents_v2/, () => ({ rows: [] })],
    ]);
    const res = await supertest(buildApp()).get('/api/v1/public/zamosk/documents');
    expect(res.status).toBe(200);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/v1/documents
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/v1/documents', () => {
  test('403 on unrecognized role', async () => {
    mockCurrentUser = { uid: 'x', role: 'bogus' };
    const res = await supertest(buildApp()).get('/api/v1/documents');
    expect(res.status).toBe(403);
  });

  test('resident: empty when not in residents', async () => {
    mockCurrentUser = { uid: 'legacy', role: 'resident' };
    dispatch([[/FROM residents/, () => ({ rows: [] })]]);
    const res = await supertest(buildApp()).get('/api/v1/documents');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, documents: [], count: 0 });
  });

  test('resident happy: published list scoped to their property', async () => {
    mockCurrentUser = { uid: 'r1', role: 'resident' };
    dispatch([
      [/FROM residents/, () => ({ rows: [{ property_id: UUID2 }] })],
      [/FROM documents_v2/, () => ({ rows: [
        { id: UUID, title: 'Rules', category: 'rules', published_at: new Date().toISOString() },
      ] })],
    ]);
    const res = await supertest(buildApp()).get('/api/v1/documents');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
  });

  test('staff: requires property_id query', async () => {
    mockCurrentUser = { uid: 's1', role: 'concierge' };
    const res = await supertest(buildApp()).get('/api/v1/documents');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/property_id/);
  });

  test('staff: with property_id lists (default hides draft + deleted)', async () => {
    mockCurrentUser = { uid: 's1', role: 'concierge' };
    let gotSql = '';
    dispatch([
      [/FROM documents_v2/, (sql) => {
        gotSql = sql;
        return { rows: [{ id: UUID, title: 'x' }] };
      }],
    ]);
    const res = await supertest(buildApp())
      .get(`/api/v1/documents?property_id=${UUID2}`);
    expect(res.status).toBe(200);
    expect(gotSql).toContain('published_at IS NOT NULL');
    expect(gotSql).toContain('deleted_at IS NULL');
  });

  test('staff: ?include_draft=1 turns off published filter', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin' };
    let gotSql = '';
    dispatch([
      [/FROM documents_v2/, (sql) => { gotSql = sql; return { rows: [] }; }],
    ]);
    await supertest(buildApp()).get(`/api/v1/documents?property_id=${UUID2}&include_draft=1`);
    expect(gotSql).not.toContain('published_at IS NOT NULL');
  });

  test('staff: ?include_deleted=1 turns off deleted filter', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin' };
    let gotSql = '';
    dispatch([
      [/FROM documents_v2/, (sql) => { gotSql = sql; return { rows: [] }; }],
    ]);
    await supertest(buildApp()).get(`/api/v1/documents?property_id=${UUID2}&include_deleted=1`);
    expect(gotSql).not.toContain('deleted_at IS NULL');
  });

  test('503 on DB error', async () => {
    mockCurrentUser = { uid: 'r1', role: 'resident' };
    dispatch([[/FROM residents/, () => { throw new Error('boom'); }]]);
    const res = await supertest(buildApp()).get('/api/v1/documents');
    expect(res.status).toBe(503);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/v1/documents/:id
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/v1/documents/:id', () => {
  test('400 on bad id', async () => {
    mockCurrentUser = { uid: 's1', role: 'concierge' };
    const res = await supertest(buildApp()).get('/api/v1/documents/not-a-uuid');
    expect(res.status).toBe(400);
  });

  test('404 on miss', async () => {
    mockCurrentUser = { uid: 's1', role: 'concierge' };
    dispatch([[/FROM documents_v2/, () => ({ rows: [] })]]);
    const res = await supertest(buildApp()).get(`/api/v1/documents/${UUID}`);
    expect(res.status).toBe(404);
  });

  test('404 on soft-deleted', async () => {
    mockCurrentUser = { uid: 's1', role: 'concierge' };
    dispatch([[/FROM documents_v2/, () => ({ rows: [{
      id: UUID, deleted_at: new Date(), published_at: null,
    }] })]]);
    const res = await supertest(buildApp()).get(`/api/v1/documents/${UUID}`);
    expect(res.status).toBe(404);
  });

  test('staff sees draft', async () => {
    mockCurrentUser = { uid: 's1', role: 'concierge' };
    dispatch([[/FROM documents_v2/, () => ({ rows: [{
      id: UUID, title: 'draft', deleted_at: null, published_at: null,
    }] })]]);
    const res = await supertest(buildApp()).get(`/api/v1/documents/${UUID}`);
    expect(res.status).toBe(200);
    expect(res.body.document.id).toBe(UUID);
  });

  test('resident 404 on unpublished', async () => {
    mockCurrentUser = { uid: 'r1', role: 'resident' };
    dispatch([[/FROM documents_v2/, () => ({ rows: [{
      id: UUID, deleted_at: null, published_at: null, property_id: UUID2,
    }] })]]);
    const res = await supertest(buildApp()).get(`/api/v1/documents/${UUID}`);
    expect(res.status).toBe(404);
  });

  test('resident 404 when document belongs to another property', async () => {
    mockCurrentUser = { uid: 'r1', role: 'resident' };
    dispatch([
      [/FROM documents_v2/, () => ({ rows: [{
        id: UUID, deleted_at: null, published_at: new Date(),
        property_id: 'other-property-uuid',
      }] })],
      [/FROM residents/, () => ({ rows: [{ property_id: UUID2 }] })],
    ]);
    const res = await supertest(buildApp()).get(`/api/v1/documents/${UUID}`);
    expect(res.status).toBe(404);
  });

  test('resident 200 on published in their property', async () => {
    mockCurrentUser = { uid: 'r1', role: 'resident' };
    dispatch([
      [/FROM documents_v2/, () => ({ rows: [{
        id: UUID, deleted_at: null, published_at: new Date().toISOString(),
        property_id: UUID2,
      }] })],
      [/FROM residents/, () => ({ rows: [{ property_id: UUID2 }] })],
    ]);
    const res = await supertest(buildApp()).get(`/api/v1/documents/${UUID}`);
    expect(res.status).toBe(200);
  });

  test('503 on DB error', async () => {
    mockCurrentUser = { uid: 's1', role: 'concierge' };
    dispatch([[/FROM documents_v2/, () => { throw new Error('boom'); }]]);
    const res = await supertest(buildApp()).get(`/api/v1/documents/${UUID}`);
    expect(res.status).toBe(503);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/v1/documents
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/v1/documents', () => {
  beforeEach(() => { mockCurrentUser = { uid: 's1', role: 'concierge' }; });

  test('403 for resident', async () => {
    mockCurrentUser = { uid: 'r1', role: 'resident' };
    const res = await supertest(buildApp()).post('/api/v1/documents').send({
      property_id: UUID, title: 't', category: 'rules', body_md: 'b',
    });
    expect(res.status).toBe(403);
  });

  test('400 without property_id', async () => {
    const res = await supertest(buildApp()).post('/api/v1/documents').send({
      title: 't', category: 'rules', body_md: 'b',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/property_id/);
  });

  test('400 when staff not in staff_users', async () => {
    dispatch([[/FROM staff_users WHERE external_uid/, () => ({ rows: [] })]], 'pool');
    const res = await supertest(buildApp()).post('/api/v1/documents').send({
      property_id: UUID, title: 't', category: 'rules', body_md: 'b',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/staff_users/);
  });

  test('400 on missing title', async () => {
    dispatch([[/FROM staff_users/, () => ({ rows: [{ id: UUID2 }] })]], 'pool');
    const res = await supertest(buildApp()).post('/api/v1/documents').send({
      property_id: UUID, category: 'rules', body_md: 'b',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/title/);
  });

  test('400 on missing category', async () => {
    dispatch([[/FROM staff_users/, () => ({ rows: [{ id: UUID2 }] })]], 'pool');
    const res = await supertest(buildApp()).post('/api/v1/documents').send({
      property_id: UUID, title: 't', body_md: 'b',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/category/);
  });

  test('400 when body_md and file_url both absent', async () => {
    dispatch([[/FROM staff_users/, () => ({ rows: [{ id: UUID2 }] })]], 'pool');
    const res = await supertest(buildApp()).post('/api/v1/documents').send({
      property_id: UUID, title: 't', category: 'rules',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/body_md or file_url/);
  });

  test('400 on external file_url', async () => {
    dispatch([[/FROM staff_users/, () => ({ rows: [{ id: UUID2 }] })]], 'pool');
    const res = await supertest(buildApp()).post('/api/v1/documents').send({
      property_id: UUID, title: 't', category: 'rules',
      file_url: 'https://evil.com/x.pdf', file_mime: 'application/pdf', file_size_bytes: 100,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/\/uploads\//);
  });

  test('403-via-400 concierge cannot create legal category', async () => {
    // Service throws "invalid category for concierge" → 400 (regex /invalid /i).
    dispatch([[/FROM staff_users/, () => ({ rows: [{ id: UUID2 }] })]], 'pool');
    const res = await supertest(buildApp()).post('/api/v1/documents').send({
      property_id: UUID, title: 't', category: 'legal', body_md: 'b',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/concierge/);
  });

  test('201 happy — creates draft by default (concierge в contacts)', async () => {
    // Concierge ограничен contacts/instructions — использу ем contacts.
    dispatch([
      [/FROM staff_users/, () => ({ rows: [{ id: UUID2 }] })],
      [/INSERT INTO documents_v2/, () => ({ rows: [{
        id: UUID3, title: 't', category: 'contacts', published_at: null, tag: null,
      }] })],
    ], 'pool');
    const res = await supertest(buildApp()).post('/api/v1/documents').send({
      property_id: UUID, title: 't', category: 'contacts', body_md: 'b',
    });
    expect(res.status).toBe(201);
    expect(res.body.document.id).toBe(UUID3);
    expect(res.body.document.published_at).toBeNull();
  });

  test('201 with publish_now=true (concierge в instructions)', async () => {
    let insertSql = '';
    dispatch([
      [/FROM staff_users/, () => ({ rows: [{ id: UUID2 }] })],
      [/INSERT INTO documents_v2/, (sql) => {
        insertSql = sql;
        return { rows: [{ id: UUID3, title: 't', category: 'instructions', published_at: new Date() }] };
      }],
    ], 'pool');
    const res = await supertest(buildApp()).post('/api/v1/documents').send({
      property_id: UUID, title: 't', category: 'instructions', body_md: 'b',
      publish_now: true,
    });
    expect(res.status).toBe(201);
    expect(insertSql).toContain('NOW()');
  });

  test('admin can create legal category', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin' };
    dispatch([
      [/FROM staff_users/, () => ({ rows: [{ id: UUID2 }] })],
      [/INSERT INTO documents_v2/, () => ({ rows: [{
        id: UUID3, title: 't', category: 'legal', published_at: null,
      }] })],
    ], 'pool');
    const res = await supertest(buildApp()).post('/api/v1/documents').send({
      property_id: UUID, title: 'Договор', category: 'legal', body_md: 'b',
    });
    expect(res.status).toBe(201);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PATCH /api/v1/documents/:id
// ══════════════════════════════════════════════════════════════════════════════

describe('PATCH /api/v1/documents/:id', () => {
  beforeEach(() => { mockCurrentUser = { uid: 'a1', role: 'admin' }; });

  test('400 on bad id', async () => {
    const res = await supertest(buildApp()).patch('/api/v1/documents/bad').send({ title: 'x' });
    expect(res.status).toBe(400);
  });

  test('403 for resident', async () => {
    mockCurrentUser = { uid: 'r1', role: 'resident' };
    const res = await supertest(buildApp()).patch(`/api/v1/documents/${UUID}`).send({ title: 'x' });
    expect(res.status).toBe(403);
  });

  test('400 on empty patch', async () => {
    dispatch([[/FROM staff_users/, () => ({ rows: [{ id: UUID2 }] })]], 'pool');
    const res = await supertest(buildApp()).patch(`/api/v1/documents/${UUID}`).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No fields/);
  });

  test('404 when not found', async () => {
    dispatch([[/FROM staff_users/, () => ({ rows: [{ id: UUID2 }] })]], 'pool');
    dispatch([
      ['BEGIN', () => ({})],
      [/FROM documents_v2 WHERE id = \$1/, () => ({ rows: [] })],
      ['ROLLBACK', () => ({})],
    ], 'client');
    const res = await supertest(buildApp()).patch(`/api/v1/documents/${UUID}`).send({ title: 'x' });
    expect(res.status).toBe(404);
  });

  test('404 when soft-deleted', async () => {
    dispatch([[/FROM staff_users/, () => ({ rows: [{ id: UUID2 }] })]], 'pool');
    const cur = { id: UUID, title: 't', body_md: 'b', file_url: null, category: 'rules', deleted_at: new Date() };
    dispatch([
      ['BEGIN', () => ({})],
      [/FROM documents_v2 WHERE id = \$1/, () => ({ rows: [cur] })],
      ['ROLLBACK', () => ({})],
    ], 'client');
    const res = await supertest(buildApp()).patch(`/api/v1/documents/${UUID}`).send({ title: 'x' });
    expect(res.status).toBe(404);
  });

  test('200 happy patch (tag only, no snapshot)', async () => {
    dispatch([[/FROM staff_users/, () => ({ rows: [{ id: UUID2 }] })]], 'pool');
    const cur = { id: UUID, title: 't', body_md: 'b', file_url: null, category: 'contacts', deleted_at: null };
    const upd = { ...cur, tag: 'fire' };
    dispatch([
      ['BEGIN', () => ({})],
      [/FROM documents_v2 WHERE id = \$1/, () => ({ rows: [cur] })],
      [/UPDATE documents_v2/, () => ({ rows: [upd] })],
      ['COMMIT', () => ({})],
    ], 'client');
    const res = await supertest(buildApp()).patch(`/api/v1/documents/${UUID}`).send({ tag: 'fire' });
    expect(res.status).toBe(200);
    expect(res.body.document.tag).toBe('fire');
  });

  test('200 happy patch with title change triggers snapshot', async () => {
    dispatch([[/FROM staff_users/, () => ({ rows: [{ id: UUID2 }] })]], 'pool');
    const cur = { id: UUID, title: 'OLD', body_md: 'b', file_url: null, category: 'contacts', deleted_at: null };
    const upd = { ...cur, title: 'NEW' };
    let insertedVersion = false;
    dispatch([
      ['BEGIN', () => ({})],
      [/FROM documents_v2 WHERE id = \$1/, () => ({ rows: [cur] })],
      [/SELECT COALESCE\(MAX\(version\)/, () => ({ rows: [{ next_version: 1 }] })],
      [/INSERT INTO document_versions/, () => { insertedVersion = true; return { rows: [] }; }],
      [/UPDATE documents_v2/, () => ({ rows: [upd] })],
      ['COMMIT', () => ({})],
    ], 'client');
    const res = await supertest(buildApp()).patch(`/api/v1/documents/${UUID}`).send({
      title: 'NEW', reason: 'typo fix',
    });
    expect(res.status).toBe(200);
    expect(insertedVersion).toBe(true);
  });

  test('400 on invalid category', async () => {
    dispatch([[/FROM staff_users/, () => ({ rows: [{ id: UUID2 }] })]], 'pool');
    const res = await supertest(buildApp()).patch(`/api/v1/documents/${UUID}`).send({
      category: 'gossip',
    });
    expect(res.status).toBe(400);
  });

  test('400 on external file_url', async () => {
    dispatch([[/FROM staff_users/, () => ({ rows: [{ id: UUID2 }] })]], 'pool');
    const res = await supertest(buildApp()).patch(`/api/v1/documents/${UUID}`).send({
      file_url: 'https://evil.com/x.pdf',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/\/uploads\//);
  });

  test('concierge blocked from patching legal doc', async () => {
    mockCurrentUser = { uid: 's1', role: 'concierge' };
    dispatch([[/FROM staff_users/, () => ({ rows: [{ id: UUID2 }] })]], 'pool');
    const cur = { id: UUID, title: 't', body_md: 'b', file_url: null, category: 'legal', deleted_at: null };
    dispatch([
      ['BEGIN', () => ({})],
      [/FROM documents_v2 WHERE id = \$1/, () => ({ rows: [cur] })],
      ['ROLLBACK', () => ({})],
    ], 'client');
    const res = await supertest(buildApp()).patch(`/api/v1/documents/${UUID}`).send({
      title: 'новое название',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/concierge/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/v1/documents/:id/publish
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /:id/publish', () => {
  test('403 for resident', async () => {
    mockCurrentUser = { uid: 'r1', role: 'resident' };
    const res = await supertest(buildApp()).post(`/api/v1/documents/${UUID}/publish`).send({});
    expect(res.status).toBe(403);
  });

  test('400 on bad id', async () => {
    mockCurrentUser = { uid: 's1', role: 'concierge' };
    const res = await supertest(buildApp()).post('/api/v1/documents/bad/publish').send({});
    expect(res.status).toBe(400);
  });

  test('404 when not found', async () => {
    mockCurrentUser = { uid: 's1', role: 'concierge' };
    dispatch([
      [/FROM staff_users/, () => ({ rows: [{ id: UUID2 }] })],
      [/FROM documents_v2 WHERE id = \$1/, () => ({ rows: [] })],
    ], 'pool');
    const res = await supertest(buildApp()).post(`/api/v1/documents/${UUID}/publish`).send({});
    expect(res.status).toBe(404);
  });

  test('404 when deleted', async () => {
    mockCurrentUser = { uid: 's1', role: 'concierge' };
    dispatch([
      [/FROM staff_users/, () => ({ rows: [{ id: UUID2 }] })],
      [/FROM documents_v2 WHERE id = \$1/, () => ({ rows: [{
        id: UUID, category: 'rules', deleted_at: new Date(), published_at: null,
      }] })],
    ], 'pool');
    const res = await supertest(buildApp()).post(`/api/v1/documents/${UUID}/publish`).send({});
    expect(res.status).toBe(404);
  });

  test('200 happy publish', async () => {
    mockCurrentUser = { uid: 's1', role: 'concierge' };
    const draft = { id: UUID, category: 'contacts', deleted_at: null, published_at: null };
    const published = { ...draft, published_at: new Date().toISOString() };
    dispatch([
      [/FROM staff_users/, () => ({ rows: [{ id: UUID2 }] })],
      [/FROM documents_v2 WHERE id = \$1/, () => ({ rows: [draft] })],
      [/UPDATE documents_v2/, () => ({ rows: [published] })],
    ], 'pool');
    const res = await supertest(buildApp()).post(`/api/v1/documents/${UUID}/publish`).send({});
    expect(res.status).toBe(200);
    expect(res.body.document.published_at).toBeTruthy();
    expect(res.body.idempotent).toBeUndefined();
  });

  test('200 idempotent already-published', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin' };
    const existing = { id: UUID, category: 'rules', deleted_at: null, published_at: new Date() };
    dispatch([
      [/FROM staff_users/, () => ({ rows: [{ id: UUID2 }] })],
      [/FROM documents_v2 WHERE id = \$1/, () => ({ rows: [existing] })],
    ], 'pool');
    const res = await supertest(buildApp()).post(`/api/v1/documents/${UUID}/publish`).send({});
    expect(res.status).toBe(200);
    expect(res.body.idempotent).toBe(true);
  });

  test('concierge blocked from publishing legal doc', async () => {
    mockCurrentUser = { uid: 's1', role: 'concierge' };
    dispatch([
      [/FROM staff_users/, () => ({ rows: [{ id: UUID2 }] })],
      [/FROM documents_v2 WHERE id = \$1/, () => ({ rows: [{
        id: UUID, category: 'legal', deleted_at: null, published_at: null,
      }] })],
    ], 'pool');
    const res = await supertest(buildApp()).post(`/api/v1/documents/${UUID}/publish`).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/concierge/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/v1/documents/:id/unpublish
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /:id/unpublish', () => {
  test('403 for concierge (admin only)', async () => {
    mockCurrentUser = { uid: 's1', role: 'concierge' };
    const res = await supertest(buildApp()).post(`/api/v1/documents/${UUID}/unpublish`).send({});
    expect(res.status).toBe(403);
  });

  test('403 for resident', async () => {
    mockCurrentUser = { uid: 'r1', role: 'resident' };
    const res = await supertest(buildApp()).post(`/api/v1/documents/${UUID}/unpublish`).send({});
    expect(res.status).toBe(403);
  });

  test('400 on bad id', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin' };
    const res = await supertest(buildApp()).post('/api/v1/documents/bad/unpublish').send({});
    expect(res.status).toBe(400);
  });

  test('404 not found', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin' };
    dispatch([
      [/FROM staff_users/, () => ({ rows: [{ id: UUID2 }] })],
      [/UPDATE documents_v2/, () => ({ rows: [] })],
      [/SELECT id, published_at, deleted_at FROM documents_v2/, () => ({ rows: [] })],
    ], 'pool');
    const res = await supertest(buildApp()).post(`/api/v1/documents/${UUID}/unpublish`).send({});
    expect(res.status).toBe(404);
  });

  test('409 not_published', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin' };
    dispatch([
      [/FROM staff_users/, () => ({ rows: [{ id: UUID2 }] })],
      [/UPDATE documents_v2/, () => ({ rows: [] })],
      [/SELECT id, published_at, deleted_at FROM documents_v2/, () => ({ rows: [{
        id: UUID, published_at: null, deleted_at: null,
      }] })],
    ], 'pool');
    const res = await supertest(buildApp()).post(`/api/v1/documents/${UUID}/unpublish`).send({});
    expect(res.status).toBe(409);
  });

  test('200 happy', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin' };
    dispatch([
      [/FROM staff_users/, () => ({ rows: [{ id: UUID2 }] })],
      [/UPDATE documents_v2/, () => ({ rows: [{ id: UUID, published_at: null }] })],
    ], 'pool');
    const res = await supertest(buildApp()).post(`/api/v1/documents/${UUID}/unpublish`).send({});
    expect(res.status).toBe(200);
    expect(res.body.document.published_at).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// DELETE /api/v1/documents/:id
// ══════════════════════════════════════════════════════════════════════════════

describe('DELETE /:id', () => {
  test('403 for concierge (admin only)', async () => {
    mockCurrentUser = { uid: 's1', role: 'concierge' };
    const res = await supertest(buildApp()).delete(`/api/v1/documents/${UUID}`);
    expect(res.status).toBe(403);
  });

  test('403 for resident', async () => {
    mockCurrentUser = { uid: 'r1', role: 'resident' };
    const res = await supertest(buildApp()).delete(`/api/v1/documents/${UUID}`);
    expect(res.status).toBe(403);
  });

  test('400 on bad id', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin' };
    const res = await supertest(buildApp()).delete('/api/v1/documents/bad');
    expect(res.status).toBe(400);
  });

  test('404 not found', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin' };
    dispatch([
      [/UPDATE documents_v2/, () => ({ rows: [] })],
      [/SELECT id, deleted_at FROM documents_v2/, () => ({ rows: [] })],
    ], 'pool');
    const res = await supertest(buildApp()).delete(`/api/v1/documents/${UUID}`);
    expect(res.status).toBe(404);
  });

  test('409 already_deleted', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin' };
    dispatch([
      [/UPDATE documents_v2/, () => ({ rows: [] })],
      [/SELECT id, deleted_at FROM documents_v2/, () => ({ rows: [{
        id: UUID, deleted_at: new Date(),
      }] })],
    ], 'pool');
    const res = await supertest(buildApp()).delete(`/api/v1/documents/${UUID}`);
    expect(res.status).toBe(409);
  });

  test('200 happy', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin' };
    dispatch([
      [/UPDATE documents_v2/, () => ({ rows: [{ id: UUID, deleted_at: new Date() }] })],
    ], 'pool');
    const res = await supertest(buildApp()).delete(`/api/v1/documents/${UUID}`);
    expect(res.status).toBe(200);
    expect(res.body.document.deleted_at).toBeTruthy();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Admin sub-router — versions
// ══════════════════════════════════════════════════════════════════════════════

describe('admin sub-router /:id/versions', () => {
  test('403 for concierge', async () => {
    mockCurrentUser = { uid: 's1', role: 'concierge' };
    const res = await supertest(buildApp()).get(`/api/v1/admin/documents/${UUID}/versions`);
    expect(res.status).toBe(403);
  });

  test('400 on bad id', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin' };
    const res = await supertest(buildApp()).get('/api/v1/admin/documents/bad/versions');
    expect(res.status).toBe(400);
  });

  test('404 when document not found', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin' };
    dispatch([[/FROM documents_v2/, () => ({ rows: [] })]], 'pool');
    const res = await supertest(buildApp()).get(`/api/v1/admin/documents/${UUID}/versions`);
    expect(res.status).toBe(404);
  });

  test('200 with versions list', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin' };
    dispatch([
      [/FROM documents_v2/, () => ({ rows: [{ id: UUID, title: 't' }] })],
      [/FROM document_versions/, () => ({ rows: [
        { version: 3, title_snapshot: 'v3' },
        { version: 2, title_snapshot: 'v2' },
        { version: 1, title_snapshot: 'v1' },
      ] })],
    ], 'pool');
    const res = await supertest(buildApp()).get(`/api/v1/admin/documents/${UUID}/versions`);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(3);
  });
});

describe('admin sub-router /:id/versions/:version', () => {
  test('403 for concierge', async () => {
    mockCurrentUser = { uid: 's1', role: 'concierge' };
    const res = await supertest(buildApp()).get(`/api/v1/admin/documents/${UUID}/versions/1`);
    expect(res.status).toBe(403);
  });

  test('400 on invalid version', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin' };
    const res = await supertest(buildApp()).get(`/api/v1/admin/documents/${UUID}/versions/abc`);
    expect(res.status).toBe(400);
  });

  test('404 when document missing', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin' };
    dispatch([[/FROM documents_v2/, () => ({ rows: [] })]], 'pool');
    const res = await supertest(buildApp()).get(`/api/v1/admin/documents/${UUID}/versions/1`);
    expect(res.status).toBe(404);
  });

  test('404 when version missing', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin' };
    dispatch([
      [/FROM documents_v2/, () => ({ rows: [{ id: UUID }] })],
      [/FROM document_versions/, () => ({ rows: [] })],
    ], 'pool');
    const res = await supertest(buildApp()).get(`/api/v1/admin/documents/${UUID}/versions/9`);
    expect(res.status).toBe(404);
  });

  test('200 with snapshot', async () => {
    mockCurrentUser = { uid: 'a1', role: 'admin' };
    dispatch([
      [/FROM documents_v2/, () => ({ rows: [{ id: UUID }] })],
      [/FROM document_versions/, () => ({ rows: [{
        version: 2, title_snapshot: 'old', body_md_snapshot: 'old body',
      }] })],
    ], 'pool');
    const res = await supertest(buildApp()).get(`/api/v1/admin/documents/${UUID}/versions/2`);
    expect(res.status).toBe(200);
    expect(res.body.version.title_snapshot).toBe('old');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Public sub-router — /api/v1/public/:slug/documents
// ══════════════════════════════════════════════════════════════════════════════

describe('public sub-router', () => {
  test('400 on empty slug-path handled by route match — 404 when property not found', async () => {
    dispatch([[/FROM properties/, () => ({ rows: [] })]]);
    const res = await supertest(buildApp()).get('/api/v1/public/unknown-slug/documents');
    expect(res.status).toBe(404);
  });

  test('200 happy — returns public-visible documents', async () => {
    let listArgs = null;
    dispatch([
      [/FROM properties WHERE slug/, () => ({ rows: [{ id: UUID }] })],
      [/FROM documents_v2/, (_sql, args) => {
        listArgs = args;
        return { rows: [{ id: UUID2, category: 'rules', title: 'Rules' }] };
      }],
    ]);
    const res = await supertest(buildApp()).get('/api/v1/public/zamosk/documents');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    // Верифицируем что PUBLIC_CATEGORIES передан как ANY($2::text[]).
    expect(listArgs[1]).toEqual(['rules', 'contacts', 'safety']);
  });

  test('503 on DB error', async () => {
    dispatch([[/FROM properties/, () => { throw new Error('boom'); }]]);
    const res = await supertest(buildApp()).get('/api/v1/public/zamosk/documents');
    expect(res.status).toBe(503);
  });
});
