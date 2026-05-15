'use strict';

/**
 * Phase 1 (D-lite) — new-field validation on the properties route.
 *
 * The original platform/properties route file predates this refactor; this
 * suite specifically covers the fields added in migrations 004/005:
 *   - property_type (enum)
 *   - status (enum + lifecycle action / is_active mirror)
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
  test('accepts minimal valid payload and defaults plan to core_access', async () => {
    const db = makeDb();
    db.query
      .mockResolvedValueOnce({ rows: [] }) // slug uniqueness
      .mockResolvedValueOnce({ rows: [{ id: 'p-1', slug: 'some-zk', plan: 'core_access', status: 'active' }] }) // insert
      .mockResolvedValueOnce({ rows: [] }); // audit
    getPlatformDb.mockReturnValue(db);

    const res = await supertest(buildApp()).post('/platform/api/v1/properties').send(VALID_POST);

    expect(res.status).toBe(201);
    const insertCall = db.query.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO properties'),
    );
    expect(insertCall).toBeDefined();
    // plan is the 5th positional, but safer to assert on the values array
    // containing 'core_access' explicitly as the default.
    expect(insertCall[1]).toContain('core_access');
    expect(insertCall[1]).toContain('residential_complex'); // default property_type
    expect(insertCall[1]).toContain('active'); // default status
    expect(insertCall[1]).toContain(true); // default status mirrors is_active
  });

  test('rejects invalid plan ids', async () => {
    getPlatformDb.mockReturnValue(makeDb());
    const res = await supertest(buildApp())
      .post('/platform/api/v1/properties')
      .send({ ...VALID_POST, plan: 'gold' });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/plan/);
  });

  test('mirrors non-active create status to is_active=false', async () => {
    const db = makeDb();
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'p-1', slug: 'some-zk', status: 'maintenance', is_active: false }] })
      .mockResolvedValueOnce({ rows: [] });
    getPlatformDb.mockReturnValue(db);

    const res = await supertest(buildApp())
      .post('/platform/api/v1/properties')
      .send({ ...VALID_POST, status: 'maintenance' });

    expect(res.status).toBe(201);
    const insertCall = db.query.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO properties'),
    );
    expect(insertCall[1]).toContain('maintenance');
    expect(insertCall[1]).toContain(false);
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

describe('platform properties response redaction', () => {
  test('GET list never returns db_connection_url', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce({
      rows: [{
        id: 'p-1',
        slug: 'some-zk',
        name: 'Some ЖК',
        db_connection_url: 'postgresql://u:p@h/db',
      }],
    });
    getPlatformDb.mockReturnValue(db);

    const res = await supertest(buildApp()).get('/platform/api/v1/properties');

    expect(res.status).toBe(200);
    expect(res.body.properties[0].db_connection_url).toBeUndefined();
    expect(res.body.properties[0].db_connection_configured).toBe(true);
  });

  test('GET detail never returns db_connection_url', async () => {
    const db = makeDb();
    db.query
      .mockResolvedValueOnce({
        rows: [{
          id: 'p-1',
          slug: 'some-zk',
          name: 'Some ЖК',
          db_connection_url: 'postgresql://u:p@h/db',
        }],
      })
      .mockResolvedValueOnce({ rows: [] });
    getPlatformDb.mockReturnValue(db);

    const res = await supertest(buildApp()).get('/platform/api/v1/properties/some-zk');

    expect(res.status).toBe(200);
    expect(res.body.property.db_connection_url).toBeUndefined();
    expect(res.body.property.db_connection_configured).toBe(true);
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

  test('rejects direct status changes through generic PATCH', async () => {
    const db = makeDb();
    getPlatformDb.mockReturnValue(db);

    const res = await supertest(buildApp())
      .patch('/platform/api/v1/properties/some-zk')
      .send({ status: 'maintenance' });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/lifecycle/);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('normalizes legacy plan aliases on PATCH', async () => {
    const db = makeDb();
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'p-1', plan: 'operations' }] })
      .mockResolvedValueOnce({ rows: [] });
    getPlatformDb.mockReturnValue(db);

    const res = await supertest(buildApp())
      .patch('/platform/api/v1/properties/some-zk')
      .send({ plan: 'pro' });

    expect(res.status).toBe(200);
    const updateCall = db.query.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].startsWith('UPDATE properties'),
    );
    expect(updateCall[1]).toContain('operations');
  });

  test('rejects invalid plan ids on PATCH', async () => {
    getPlatformDb.mockReturnValue(makeDb());

    const res = await supertest(buildApp())
      .patch('/platform/api/v1/properties/some-zk')
      .send({ plan: 'gold' });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/plan/);
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

describe('POST /platform/api/v1/properties/:slug/lifecycle — lifecycle actions', () => {
  test('rejects invalid lifecycle status', async () => {
    const db = makeDb();
    getPlatformDb.mockReturnValue(db);

    const res = await supertest(buildApp())
      .post('/platform/api/v1/properties/some-zk/lifecycle')
      .send({ status: 'pending', reason: 'operator requested hold' });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/status/);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('requires an operator reason', async () => {
    const db = makeDb();
    getPlatformDb.mockReturnValue(db);

    const res = await supertest(buildApp())
      .post('/platform/api/v1/properties/some-zk/lifecycle')
      .send({ status: 'maintenance', reason: '  ' });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/reason/);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('returns 404 when property does not exist', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce({ rows: [] });
    getPlatformDb.mockReturnValue(db);

    const res = await supertest(buildApp())
      .post('/platform/api/v1/properties/missing-zk/lifecycle')
      .send({ status: 'maintenance', reason: 'planned maintenance window' });

    expect(res.status).toBe(404);
  });

  test('rejects no-op lifecycle transitions', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce({
      rows: [{ id: 'p-1', slug: 'some-zk', status: 'suspended', is_active: false }],
    });
    getPlatformDb.mockReturnValue(db);

    const res = await supertest(buildApp())
      .post('/platform/api/v1/properties/some-zk/lifecycle')
      .send({ status: 'suspended', reason: 'still waiting for contract update' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LIFECYCLE_NOOP');

    const updateCall = db.query.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].startsWith('UPDATE properties'),
    );
    expect(updateCall).toBeUndefined();
  });

  test('changes lifecycle status, mirrors is_active, and audits the reason', async () => {
    const db = makeDb();
    db.query
      .mockResolvedValueOnce({
        rows: [{ id: 'p-1', slug: 'some-zk', status: 'active', is_active: true }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'p-1', slug: 'some-zk', status: 'maintenance', is_active: false }],
      })
      .mockResolvedValueOnce({ rows: [] }); // audit
    getPlatformDb.mockReturnValue(db);

    const res = await supertest(buildApp())
      .post('/platform/api/v1/properties/some-zk/lifecycle')
      .send({ status: 'maintenance', reason: 'planned maintenance window' });

    expect(res.status).toBe(200);
    expect(res.body.lifecycle).toEqual({
      from_status: 'active',
      to_status: 'maintenance',
      from_is_active: true,
      to_is_active: false,
      reason: 'planned maintenance window',
    });

    const updateCall = db.query.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].startsWith('UPDATE properties'),
    );
    expect(updateCall[1]).toEqual(['some-zk', 'maintenance', false]);

    const auditCall = db.query.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO platform_audit_log'),
    );
    expect(auditCall[1][1]).toBe('property.lifecycle_changed');
    expect(JSON.parse(auditCall[1][3])).toEqual(res.body.lifecycle);
  });
});
