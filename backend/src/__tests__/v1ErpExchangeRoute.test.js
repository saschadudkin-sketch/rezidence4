'use strict';

const express = require('express');
const supertest = require('supertest');

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../logger', () => require('../__mocks__/logger'));

let mockCurrentUser = null;
jest.mock('../middleware/auth', () => (req, res, next) => {
  if (!mockCurrentUser) return res.status(401).json({ error: 'auth not set' });
  req.user = mockCurrentUser;
  next();
});

const db = require('../db');
const erpExchangeRouter = require('../v1/routes/erpExchange');

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111';
const PROVIDER_ID = '22222222-2222-4222-8222-222222222222';
const STAFF_ID = '33333333-3333-4333-8333-333333333333';
const JOB_ID = '44444444-4444-4444-8444-444444444444';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/erp', erpExchangeRouter);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    res.status(500).json({ error: String(err && err.message || err) });
  });
  return app;
}

function providerRow(overrides = {}) {
  return {
    id: PROVIDER_ID,
    property_id: PROPERTY_ID,
    provider: 'one_c_zhkh',
    display_name: '1C ЖКХ',
    status: 'active',
    sync_mode: 'import_only',
    base_url: 'https://1c.example/api',
    auth_ref: 'vault://erp/1c-main',
    config_json: {},
    capabilities: ['csv_import'],
    health_status: 'unknown',
    created_by: STAFF_ID,
    ...overrides,
  };
}

function jobRow(overrides = {}) {
  return {
    id: JOB_ID,
    property_id: PROPERTY_ID,
    provider_config_id: PROVIDER_ID,
    direction: 'import',
    dataset: 'resident_registry',
    source: 'csv',
    mode: 'dry_run',
    status: 'processing',
    summary: {},
    created_by: STAFF_ID,
    ...overrides,
  };
}

function recordRow(overrides = {}) {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    property_id: PROPERTY_ID,
    sync_job_id: JOB_ID,
    provider_config_id: PROVIDER_ID,
    row_index: 0,
    external_entity_type: 'resident',
    external_id: 'r-1',
    operation: 'preview_create',
    status: 'valid',
    domhub_entity_type: null,
    domhub_entity_id: null,
    validation_errors: [],
    payload: {},
    normalized_payload: {},
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = null;
  db.query.mockResolvedValue({ rows: [] });
});

describe('v1 ERP exchange route', () => {
  test('property admin can register ERP provider', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'property_admin', property_id: PROPERTY_ID };
    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: STAFF_ID }] });
      if (sql.includes('INSERT INTO erp_provider_configs')) return Promise.resolve({ rows: [providerRow()] });
      if (sql.includes('INSERT INTO property_audit_log')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const res = await supertest(buildApp())
      .post('/api/v1/erp/providers')
      .send({
        property_id: PROPERTY_ID,
        provider: '1c_zhkh',
        display_name: '1C ЖКХ',
        auth_ref: 'vault://erp/1c-main',
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ provider: expect.objectContaining({ id: PROVIDER_ID }) });
  });

  test('property admin can preview resident import', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'property_admin', property_id: PROPERTY_ID };
    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM erp_provider_configs')) return Promise.resolve({ rows: [providerRow()] });
      if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: STAFF_ID }] });
      if (sql.includes('INSERT INTO erp_sync_jobs')) return Promise.resolve({ rows: [jobRow()] });
      if (sql.includes('FROM erp_external_mappings')) return Promise.resolve({ rows: [] });
      if (sql.includes('INSERT INTO erp_sync_records')) return Promise.resolve({ rows: [recordRow()] });
      if (sql.includes('UPDATE erp_sync_jobs')) {
        return Promise.resolve({ rows: [jobRow({ status: 'completed', summary: { total: 1 } })] });
      }
      if (sql.includes('INSERT INTO property_audit_log')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const res = await supertest(buildApp())
      .post(`/api/v1/erp/providers/${PROVIDER_ID}/import/preview`)
      .send({
        property_id: PROPERTY_ID,
        dataset: 'resident_registry',
        source: 'csv',
        rows: [{ external_id: 'r-1', full_name: 'Ivan Petrov', unit_number: '12' }],
      });

    expect(res.status).toBe(202);
    expect(Object.keys(res.body).sort()).toEqual(['provider_config', 'records', 'summary', 'sync_job']);
    expect(res.body.sync_job).toMatchObject({ id: JOB_ID, status: 'completed' });
    expect(res.body.records).toEqual([expect.objectContaining({ id: recordRow().id })]);
    expect(res.body.summary).toMatchObject({
      total: 1,
      access_grants_created: 0,
      mapping_only: true,
    });
  });

  test('property admin can read sync job with contract wrapper', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'property_admin', property_id: PROPERTY_ID };
    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM erp_sync_jobs')) return Promise.resolve({ rows: [jobRow({ status: 'completed' })] });
      if (sql.includes('FROM erp_sync_records')) return Promise.resolve({ rows: [recordRow({ status: 'valid' })] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const res = await supertest(buildApp())
      .get(`/api/v1/erp/sync-jobs/${JOB_ID}?property_id=${PROPERTY_ID}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      sync_job: expect.objectContaining({ id: JOB_ID, status: 'completed' }),
      records: [expect.objectContaining({ sync_job_id: JOB_ID })],
    });
  });

  test('resident cannot read ERP providers', async () => {
    mockCurrentUser = { uid: 'resident-1', role: 'resident', property_id: PROPERTY_ID };

    const res = await supertest(buildApp())
      .get(`/api/v1/erp/providers?property_id=${PROPERTY_ID}`);

    expect(res.status).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });
});
