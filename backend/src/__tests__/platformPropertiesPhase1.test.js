'use strict';

/**
 * Phase 1 (D-lite) — new-field validation on the properties route.
 *
 * The original platform/properties route file predates this refactor; this
 * suite specifically covers the fields added in migrations 004/005:
 *   - property_type (enum)
 *   - status (enum + is_active mirror)
 *   - logo_url (https URL)
 *   - primary_color (CSS color)
 *   - management_company_id (FK with existence + active check)
 *
 * We don't re-test the pre-existing slug / hostname / db_connection_url
 * validation — those live in the broader platform suite.  These are just
 * the Phase-1 deltas.
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
  app.use('/platform/api/v1/properties', require('../routes/platform/properties'));
  return app;
}

function makeDb() {
  return { query: jest.fn() };
}

// Shared minimal POST payload — callers override single fields per test.
const VALID_POST = {
  slug: 'some-zk',
  name: 'Some ЖК',
  db_connection_url: 'postgresql://u:p@h/db',
};

beforeEach(() => jest.clearAllMocks());

describe('POST /platform/api/v1/properties — Phase 1 field validation', () => {
  test('accepts minimal valid payload and defaults plan to core', async () => {
    const db = makeDb();
    db.query
      .mockResolvedValueOnce({ rows: [] }) // slug uniqueness
      .mockResolvedValueOnce({ rows: [{ id: 'p-1', slug: 'some-zk', plan: 'core', status: 'active' }] }) // insert
      .mockResolvedValueOnce({ rows: [] }); // audit
    getPlatformDb.mockReturnValue(db);

    const res = await supertest(buildApp()).post('/platform/api/v1/properties').send(VALID_POST);

    expect(res.status).toBe(201);
    const insertCall = db.query.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO properties'),
    );
    expect(insertCall).toBeDefined();
    // plan is the 5th positional, but safer to assert on the values array
    // containing 'core' explicitly as the default.
    expect(insertCall[1]).toContain('core');
    expect(insertCall[1]).toContain('residential_complex'); // default property_type
    expect(insertCall[1]).toContain('active'); // default status
  });

  test('rejects invalid property_type', async () => {
    getPlatformDb.mockReturnValue(makeDb());
    const res = await supertest(buildApp())
      .post('/platform/api/v1/properties')
      .send({ ...VALID_POST, property_type: 'warehouse' });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/property_type/);
  });

  test('rejects invalid status', async () => {
    getPlatformDb.mockReturnValue(makeDb());
    const res = await supertest(buildApp())
      .post('/platform/api/v1/properties')
      .send({ ...VALID_POST, status: 'pending' });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/status/);
  });

  test('rejects http:// logo_url', async () => {
    getPlatformDb.mockReturnValue(makeDb());
    const res = await supertest(buildApp())
      .post('/platform/api/v1/properties')
      .send({ ...VALID_POST, logo_url: 'http://example.com/logo.png' });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/logo_url/);
  });

  test('accepts valid https logo_url', async () => {
    const db = makeDb();
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'p-1' }] })
      .mockResolvedValueOnce({ rows: [] });
    getPlatformDb.mockReturnValue(db);

    const res = await supertest(buildApp())
      .post('/platform/api/v1/properties')
      .send({ ...VALID_POST, logo_url: 'https://cdn.example.com/logo.png' });

    expect(res.status).toBe(201);
  });

  test('rejects bad primary_color', async () => {
    getPlatformDb.mockReturnValue(makeDb());
    const res = await supertest(buildApp())
      .post('/platform/api/v1/properties')
      .send({ ...VALID_POST, primary_color: '<script>alert(1)</script>' });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/primary_color/);
  });

  test('accepts hex and named CSS colors', async () => {
    for (const color of ['#7c3aed', '#7C3AED', '#abc', '#abcdef12', 'slateblue', 'rebeccapurple']) {
      const db = makeDb();
      db.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'p-x' }] })
        .mockResolvedValueOnce({ rows: [] });
      getPlatformDb.mockReturnValue(db);

      const res = await supertest(buildApp())
        .post('/platform/api/v1/properties')
        .send({ ...VALID_POST, slug: `test-${color.replace(/[^a-z0-9]/gi, '')}`.toLowerCase(), primary_color: color });

      expect(res.status).toBe(201);
    }
  });

  test('rejects management_company_id that does not exist', async () => {
    const db = makeDb();
    db.query
      .mockResolvedValueOnce({ rows: [] }) // slug uniqueness
      .mockResolvedValueOnce({ rows: [] }); // MC lookup miss
    getPlatformDb.mockReturnValue(db);

    const res = await supertest(buildApp())
      .post('/platform/api/v1/properties')
      .send({
        ...VALID_POST,
        management_company_id: '00000000-0000-0000-0000-000000000000',
      });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/management_company_id/);
  });

  test('accepts an existing active management_company_id', async () => {
    const db = makeDb();
    db.query
      .mockResolvedValueOnce({ rows: [] }) // slug uniqueness
      .mockResolvedValueOnce({ rows: [{ id: 'mc-1' }] }) // MC exists & active
      .mockResolvedValueOnce({ rows: [{ id: 'p-1', management_company_id: 'mc-1' }] }) // insert
      .mockResolvedValueOnce({ rows: [] }); // audit
    getPlatformDb.mockReturnValue(db);

    const res = await supertest(buildApp())
      .post('/platform/api/v1/properties')
      .send({ ...VALID_POST, management_company_id: 'mc-1' });

    expect(res.status).toBe(201);
  });
});

describe('PATCH /platform/api/v1/properties/:slug — Phase 1 field validation', () => {
  test('rejects invalid property_type', async () => {
    getPlatformDb.mockReturnValue(makeDb());
    const res = await supertest(buildApp())
      .patch('/platform/api/v1/properties/some-zk')
      .send({ property_type: 'bogus' });

    expect(res.status).toBe(400);
  });

  test('status change mirrors is_active', async () => {
    const db = makeDb();
    // UPDATE query
    db.query
      .mockResolvedValueOnce({
        rows: [{ id: 'p-1', slug: 'some-zk', status: 'maintenance', is_active: false }],
      })
      .mockResolvedValueOnce({ rows: [] }); // audit
    getPlatformDb.mockReturnValue(db);

    const res = await supertest(buildApp())
      .patch('/platform/api/v1/properties/some-zk')
      .send({ status: 'maintenance' });

    expect(res.status).toBe(200);

    const updateCall = db.query.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].startsWith('UPDATE properties'),
    );
    expect(updateCall).toBeDefined();
    // Both status and is_active (set to false for non-active) should be in the values array
    expect(updateCall[1]).toContain('maintenance');
    expect(updateCall[1]).toContain(false);
  });

  test('logo_url=empty string clears the field', async () => {
    const db = makeDb();
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'p-1', logo_url: null }] })
      .mockResolvedValueOnce({ rows: [] });
    getPlatformDb.mockReturnValue(db);

    const res = await supertest(buildApp())
      .patch('/platform/api/v1/properties/some-zk')
      .send({ logo_url: '' });

    expect(res.status).toBe(200);
    const updateCall = db.query.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].startsWith('UPDATE properties'),
    );
    expect(updateCall[1]).toContain(null);
  });

  test('management_company_id=null clears without lookup', async () => {
    const db = makeDb();
    // Expect only UPDATE + audit calls — no MC lookup when clearing to null
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'p-1', management_company_id: null }] })
      .mockResolvedValueOnce({ rows: [] });
    getPlatformDb.mockReturnValue(db);

    const res = await supertest(buildApp())
      .patch('/platform/api/v1/properties/some-zk')
      .send({ management_company_id: null });

    expect(res.status).toBe(200);
    // The UPDATE call must carry null.  We also assert we did NOT run the
    // MC lookup query (which would start with 'SELECT id FROM management_companies').
    const mcLookup = db.query.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('FROM management_companies'),
    );
    expect(mcLookup).toBeUndefined();
  });

  test('management_company_id pointing to suspended MC is rejected', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce({ rows: [] }); // MC lookup returns nothing (status != 'active')
    getPlatformDb.mockReturnValue(db);

    const res = await supertest(buildApp())
      .patch('/platform/api/v1/properties/some-zk')
      .send({ management_company_id: '00000000-0000-0000-0000-000000000000' });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/management_company_id/);
  });
});
