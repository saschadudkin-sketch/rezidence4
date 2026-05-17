'use strict';

const express = require('express');
const supertest = require('supertest');

jest.mock('../logger', () => require('../__mocks__/logger'));

let mockCurrentUser = null;
jest.mock('../middleware/auth', () => (req, res, next) => {
  if (!mockCurrentUser) return res.status(401).json({ error: 'auth not set' });
  req.user = mockCurrentUser;
  next();
});

const webhooksRouter = require('../routes/webhooks');

const WEBHOOK_ID = '11111111-1111-4111-8111-111111111111';
const DELIVERY_ID = '22222222-2222-4222-8222-222222222222';

function webhookRow(overrides = {}) {
  return {
    id: WEBHOOK_ID,
    name: 'ERP bridge',
    url: 'https://hooks.example/domhub',
    events: ['request.created'],
    is_active: true,
    retry_count: 0,
    last_attempt_at: null,
    last_success_at: null,
    last_error: null,
    created_by: 'admin-1',
    created_at: '2026-05-17T10:00:00.000Z',
    updated_at: null,
    ...overrides,
  };
}

function buildApp(db) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.db = db;
    next();
  });
  app.use('/api/v1/webhooks', webhooksRouter);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    res.status(500).json({ error: String(err && err.message || err) });
  });
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = { uid: 'admin-1', role: 'admin' };
});

describe('v1 webhooks route contract', () => {
  test('POST /webhooks returns 201 with webhook wrapper', async () => {
    const db = {
      query: jest.fn((sql) => {
        if (sql.includes('INSERT INTO webhooks')) return Promise.resolve({ rows: [webhookRow()] });
        if (sql.includes('INSERT INTO property_audit_log')) return Promise.resolve({ rows: [] });
        throw new Error(`unexpected SQL: ${sql}`);
      }),
    };

    const res = await supertest(buildApp(db))
      .post('/api/v1/webhooks')
      .send({
        name: 'ERP bridge',
        url: 'https://hooks.example/domhub',
        secret: 'secret-ref',
        events: ['request.created'],
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ webhook: webhookRow() });
  });

  test('DELETE /webhooks/:id returns ok wrapper', async () => {
    const db = {
      query: jest.fn((sql) => {
        if (sql.includes('UPDATE webhooks')) return Promise.resolve({ rows: [{ id: WEBHOOK_ID, name: 'ERP bridge' }] });
        if (sql.includes('INSERT INTO property_audit_log')) return Promise.resolve({ rows: [] });
        throw new Error(`unexpected SQL: ${sql}`);
      }),
    };

    const res = await supertest(buildApp(db))
      .delete(`/api/v1/webhooks/${WEBHOOK_ID}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  test('POST /webhooks/:id/test returns 202 with delivery id wrapper', async () => {
    const db = {
      query: jest.fn((sql) => {
        if (sql.includes('SELECT id FROM webhooks')) return Promise.resolve({ rows: [{ id: WEBHOOK_ID }] });
        if (sql.includes('INSERT INTO webhook_deliveries')) return Promise.resolve({ rows: [{ id: DELIVERY_ID }] });
        throw new Error(`unexpected SQL: ${sql}`);
      }),
    };

    const res = await supertest(buildApp(db))
      .post(`/api/v1/webhooks/${WEBHOOK_ID}/test`);

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ deliveryId: DELIVERY_ID });
  });

  test('GET /webhooks/:id/deliveries returns deliveries wrapper', async () => {
    const delivery = {
      id: DELIVERY_ID,
      event_type: 'request.created',
      status: 'pending',
      attempt_count: 0,
      next_attempt_at: '2026-05-17T10:05:00.000Z',
      response_status: null,
      response_body: null,
      error_message: null,
      created_at: '2026-05-17T10:00:00.000Z',
      completed_at: null,
    };
    const db = {
      query: jest.fn((sql) => {
        if (sql.includes('SELECT id FROM webhooks')) return Promise.resolve({ rows: [{ id: WEBHOOK_ID }] });
        if (sql.includes('FROM webhook_deliveries')) return Promise.resolve({ rows: [delivery] });
        throw new Error(`unexpected SQL: ${sql}`);
      }),
    };

    const res = await supertest(buildApp(db))
      .get(`/api/v1/webhooks/${WEBHOOK_ID}/deliveries`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deliveries: [delivery] });
  });
});
