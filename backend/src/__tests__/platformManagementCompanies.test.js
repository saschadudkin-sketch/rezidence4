'use strict';

/**
 * Phase 1 (D-lite) — management-companies route tests.
 *
 * Scope:
 *   - Input validation on POST / PATCH
 *   - Uniqueness handling
 *   - Status filter on GET
 *   - Shape of GET :slug response (MC + properties + recent audit)
 *   - Audit log writes with actor_type='platform_admin'
 *
 * The tests mock getPlatformDb() to a chainable fake so we never hit a
 * real database; this keeps the suite fast and runnable in CI without
 * provisioning.  A thin auth middleware stub stands in for real JWT
 * verification — the route file wires real platformAuth but we override
 * it before require() to keep tests tight.
 */

jest.mock('../db', () => ({
  getPlatformDb: jest.fn(),
}));

jest.mock('../middleware/platformAuth', () => (req, _res, next) => {
  req.platformAdmin = { id: 'admin-1', email: 'admin@domhub.su', name: 'Admin' };
  next();
});

const express = require('express');
const supertest = require('supertest');
const { getPlatformDb } = require('../db');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/platform/api/v1/management-companies', require('../routes/platform/managementCompanies'));
  return app;
}

function makeDb() {
  const query = jest.fn();
  return { query };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /platform/api/v1/management-companies', () => {
  test('returns list with properties_count', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce({
      rows: [
        { id: 'mc-1', slug: 'zamoskv-uk', name: 'УК 1', properties_count: 2, status: 'active' },
      ],
    });
    getPlatformDb.mockReturnValue(db);

    const res = await supertest(buildApp()).get('/platform/api/v1/management-companies');

    expect(res.status).toBe(200);
    expect(res.body.managementCompanies).toHaveLength(1);
    expect(res.body.managementCompanies[0].properties_count).toBe(2);

    // The subquery for properties_count must be in the SQL
    const sql = db.query.mock.calls[0][0];
    expect(sql).toContain('properties_count');
  });

  test('accepts ?status=active', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce({ rows: [] });
    getPlatformDb.mockReturnValue(db);

    const res = await supertest(buildApp())
      .get('/platform/api/v1/management-companies?status=active');

    expect(res.status).toBe(200);
    expect(db.query.mock.calls[0][1]).toEqual(['active']);
  });

  test('rejects invalid status', async () => {
    const db = makeDb();
    getPlatformDb.mockReturnValue(db);

    const res = await supertest(buildApp())
      .get('/platform/api/v1/management-companies?status=bogus');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /platform/api/v1/management-companies/:slug', () => {
  test('returns MC with properties and recent audit', async () => {
    const db = makeDb();
    // MC lookup
    db.query.mockResolvedValueOnce({
      rows: [{ id: 'mc-1', slug: 'zamoskv-uk', name: 'УК', status: 'active' }],
    });
    // properties
    db.query.mockResolvedValueOnce({
      rows: [{ id: 'p-1', slug: 'zamoskv', name: 'Zamoskv', status: 'active', is_active: true }],
    });
    // audit
    db.query.mockResolvedValueOnce({ rows: [] });
    getPlatformDb.mockReturnValue(db);

    const res = await supertest(buildApp())
      .get('/platform/api/v1/management-companies/zamoskv-uk');

    expect(res.status).toBe(200);
    expect(res.body.managementCompany.slug).toBe('zamoskv-uk');
    expect(res.body.properties).toHaveLength(1);
    expect(res.body.recentAudit).toEqual([]);
  });

  test('returns 404 for unknown slug', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce({ rows: [] });
    getPlatformDb.mockReturnValue(db);

    const res = await supertest(buildApp())
      .get('/platform/api/v1/management-companies/ghost');

    expect(res.status).toBe(404);
  });
});

describe('POST /platform/api/v1/management-companies', () => {
  test('creates MC with minimal payload and writes audit', async () => {
    const db = makeDb();
    // uniqueness check
    db.query.mockResolvedValueOnce({ rows: [] });
    // insert
    db.query.mockResolvedValueOnce({
      rows: [{ id: 'mc-new', slug: 'new-uk', name: 'New УК', status: 'active' }],
    });
    // audit log (fire-and-forget)
    db.query.mockResolvedValueOnce({ rows: [] });
    getPlatformDb.mockReturnValue(db);

    const res = await supertest(buildApp())
      .post('/platform/api/v1/management-companies')
      .send({ slug: 'new-uk', name: 'New УК' });

    expect(res.status).toBe(201);
    expect(res.body.managementCompany.slug).toBe('new-uk');

    // Audit call is the last one (fire-and-forget); assert the SQL + actor_type
    const auditCall = db.query.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO platform_audit_log'),
    );
    expect(auditCall).toBeDefined();
    expect(auditCall[0]).toContain("'platform_admin'");
  });

  test('rejects invalid slug', async () => {
    getPlatformDb.mockReturnValue(makeDb());
    const res = await supertest(buildApp())
      .post('/platform/api/v1/management-companies')
      .send({ slug: 'BAD SLUG', name: 'X' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('rejects missing name', async () => {
    getPlatformDb.mockReturnValue(makeDb());
    const res = await supertest(buildApp())
      .post('/platform/api/v1/management-companies')
      .send({ slug: 'ok-slug', name: '   ' });

    expect(res.status).toBe(400);
  });

  test('rejects invalid INN', async () => {
    getPlatformDb.mockReturnValue(makeDb());
    const res = await supertest(buildApp())
      .post('/platform/api/v1/management-companies')
      .send({ slug: 'ok-slug', name: 'OK', inn: '123' });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/inn/);
  });

  test('accepts 10-digit and 12-digit INN', async () => {
    for (const inn of ['1234567890', '123456789012']) {
      const db = makeDb();
      db.query
        .mockResolvedValueOnce({ rows: [] }) // uniqueness
        .mockResolvedValueOnce({ rows: [{ id: 'mc-x', slug: 'ok', name: 'X', inn, status: 'active' }] }) // insert
        .mockResolvedValueOnce({ rows: [] }); // audit
      getPlatformDb.mockReturnValue(db);

      const res = await supertest(buildApp())
        .post('/platform/api/v1/management-companies')
        .send({ slug: `ok-${inn.length}`, name: 'X', inn });

      expect(res.status).toBe(201);
    }
  });

  test('rejects http:// URLs in website / logo_url', async () => {
    getPlatformDb.mockReturnValue(makeDb());
    const res = await supertest(buildApp())
      .post('/platform/api/v1/management-companies')
      .send({ slug: 'ok-slug', name: 'OK', website: 'http://insecure.example' });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/https/);
  });

  test('409 on slug collision', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce({ rows: [{ id: 'existing' }] }); // uniqueness hit
    getPlatformDb.mockReturnValue(db);

    const res = await supertest(buildApp())
      .post('/platform/api/v1/management-companies')
      .send({ slug: 'ok-slug', name: 'OK' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SLUG_EXISTS');
  });
});

describe('PATCH /platform/api/v1/management-companies/:slug', () => {
  test('rejects empty patch body', async () => {
    getPlatformDb.mockReturnValue(makeDb());
    const res = await supertest(buildApp())
      .patch('/platform/api/v1/management-companies/some-uk')
      .send({});

    expect(res.status).toBe(400);
  });

  test('updates status', async () => {
    const db = makeDb();
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'mc-1', slug: 'some-uk', status: 'suspended' }] }) // update
      .mockResolvedValueOnce({ rows: [] }); // audit
    getPlatformDb.mockReturnValue(db);

    const res = await supertest(buildApp())
      .patch('/platform/api/v1/management-companies/some-uk')
      .send({ status: 'suspended' });

    expect(res.status).toBe(200);
    expect(res.body.managementCompany.status).toBe('suspended');
  });

  test('rejects invalid status value', async () => {
    getPlatformDb.mockReturnValue(makeDb());
    const res = await supertest(buildApp())
      .patch('/platform/api/v1/management-companies/some-uk')
      .send({ status: 'deleted' });

    expect(res.status).toBe(400);
  });

  test('clears nullable fields when set to empty string', async () => {
    const db = makeDb();
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'mc-1', slug: 'some-uk', inn: null }] }) // update
      .mockResolvedValueOnce({ rows: [] }); // audit
    getPlatformDb.mockReturnValue(db);

    const res = await supertest(buildApp())
      .patch('/platform/api/v1/management-companies/some-uk')
      .send({ inn: '', contact_email: '' });

    expect(res.status).toBe(200);
    // The UPDATE query should have null values
    const updateCall = db.query.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('UPDATE management_companies'),
    );
    expect(updateCall).toBeDefined();
    // Values come after the slug; find the null markers
    const values = updateCall[1];
    expect(values).toContain(null);
  });

  test('returns 404 if slug not found', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce({ rows: [] }); // update returns nothing
    getPlatformDb.mockReturnValue(db);

    const res = await supertest(buildApp())
      .patch('/platform/api/v1/management-companies/ghost')
      .send({ name: 'New name' });

    expect(res.status).toBe(404);
  });
});

describe('GET /platform/api/v1/management-companies/:slug/admins', () => {
  test('returns admin list for existing MC', async () => {
    const db = makeDb();
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'mc-1' }] }) // MC lookup
      .mockResolvedValueOnce({ rows: [{ id: 'a-1', email: 'mc@uk.ru', is_active: true }] });
    getPlatformDb.mockReturnValue(db);

    const res = await supertest(buildApp())
      .get('/platform/api/v1/management-companies/some-uk/admins');

    expect(res.status).toBe(200);
    expect(res.body.admins).toHaveLength(1);
  });

  test('returns 404 when MC does not exist', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce({ rows: [] });
    getPlatformDb.mockReturnValue(db);

    const res = await supertest(buildApp())
      .get('/platform/api/v1/management-companies/ghost/admins');

    expect(res.status).toBe(404);
  });
});
