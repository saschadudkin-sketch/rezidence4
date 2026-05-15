'use strict';

const express = require('express');
const supertest = require('supertest');

let mockDb;
let mockUser;

jest.mock('../middleware/auth', () => (req, _res, next) => {
  req.user = mockUser;
  req.db = mockDb;
  next();
});

jest.mock('../services/notificationService', () => ({
  dispatch: jest.fn().mockResolvedValue(undefined),
}));

const { dispatch } = require('../services/notificationService');
const guardScanRouter = require('../routes/guardScan');

const TOKEN = 'a'.repeat(64);
const SCAN_ID = '11111111-1111-4111-8111-111111111111';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/guard', guardScanRouter);
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { uid: 'guard-1', role: 'security', name: 'Guard' };
  mockDb = { query: jest.fn() };
});

describe('legacy guard QR replay protections', () => {
  test('scan rejects already used QR passes', async () => {
    mockDb.query.mockResolvedValueOnce({
      rows: [{
        pass_id: 'pass-1',
        token: TOKEN,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        used_at: new Date().toISOString(),
        invalidated_at: null,
        request_id: 'req-1',
      }],
    });

    const res = await supertest(buildApp())
      .post('/api/v1/guard')
      .send({ token: TOKEN });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PASS_USED');
    expect(mockDb.query).toHaveBeenCalledTimes(1);
  });

  test('admit denies when QR pass was already consumed concurrently', async () => {
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ id: SCAN_ID, request_id: 'req-1', created_by_uid: 'owner-1' }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const res = await supertest(buildApp())
      .post(`/api/v1/guard/${SCAN_ID}/admit`)
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PASS_USED');
    expect(dispatch).not.toHaveBeenCalled();
    const deniedUpdate = mockDb.query.mock.calls.find(([sql]) => String(sql).includes("result = 'denied'"));
    expect(deniedUpdate).toBeDefined();
  });
});
