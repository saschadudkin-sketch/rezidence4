'use strict';
/**
 * FIX [TEST-1]: тесты backend — visit-logs POST role check
 */
jest.mock('../db');
const db = require('../db');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
process.env.JWT_SECRET = 'test-secret';
const visitLogsRouter = require('../routes/visitLogs');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/visit-logs', visitLogsRouter);
  return app;
}
const app = buildApp();
const makeToken = (p) => jwt.sign(p, 'test-secret', { expiresIn: '1h' });

describe('POST /api/visit-logs', () => {
  beforeEach(() => jest.clearAllMocks());

  it('403 для жильца (owner)', async () => {
    const token = makeToken({ uid: 'u1', role: 'owner', name: 'Test' });
    const res = await require('supertest')(app)
      .post('/api/visit-logs')
      .set('Cookie', `token=${token}`)
      .send({ result: 'allowed' });
    expect(res.status).toBe(403);
  });

  it('201 для охраны (security)', async () => {
    const token = makeToken({ uid: 'g1', role: 'security', name: 'Guard' });
    const now = new Date();
    db.query.mockResolvedValueOnce({ rows: [{ id: 'log-1', user_id: null, request_id: null, visitor_name: 'Гость', category: 'guest', car_plate: null, created_by_apt: null, created_by_name: null, created_by_uid: null, actor_name: 'Guard', actor_role: 'security', result: 'allowed', reason: 'ok', request_snapshot: null, timestamp: now }] });

    const res = await require('supertest')(app)
      .post('/api/visit-logs')
      .set('Cookie', `token=${token}`)
      .send({ visitorName: 'Гость', category: 'guest', result: 'allowed', actorName: 'Guard', actorRole: 'security' });
    expect(res.status).toBe(201);
  });
});

// ─── FIX [PERF-1]: тест пагинации visit_logs ─────────────────────────────────

describe('GET /api/visit-logs — пагинация', () => {
  beforeEach(() => jest.clearAllMocks());

  function makeToken(payload) {
    return jwt.sign(payload, 'test-secret', { expiresIn: '1h' });
  }

  it('использует дефолтный limit=50 offset=0', async () => {
    const token = makeToken({ uid: 'g1', role: 'security', name: 'Охранник' });
    db.query.mockResolvedValueOnce({ rows: [] });

    await require('supertest')(app)
      .get('/api/visit-logs')
      .set('Cookie', `token=${token}`);

    const params = db.query.mock.calls[0][1];
    expect(params[0]).toBe(50);  // limit
    expect(params[1]).toBe(0);   // offset
  });

  it('вычисляет offset для page=2', async () => {
    const token = makeToken({ uid: 'g1', role: 'security', name: 'Охранник' });
    db.query.mockResolvedValueOnce({ rows: [] });

    await require('supertest')(app)
      .get('/api/visit-logs?page=2&limit=25')
      .set('Cookie', `token=${token}`);

    const params = db.query.mock.calls[0][1];
    expect(params[0]).toBe(25);  // limit
    expect(params[1]).toBe(25);  // offset = (2-1)*25
  });

  it('капает limit на 100', async () => {
    const token = makeToken({ uid: 'a1', role: 'admin', name: 'Админ' });
    db.query.mockResolvedValueOnce({ rows: [] });

    await require('supertest')(app)
      .get('/api/visit-logs?limit=9999')
      .set('Cookie', `token=${token}`);

    const params = db.query.mock.calls[0][1];
    expect(params[0]).toBe(100); // не 9999
  });

  it('не возвращает LIMIT 500 (старый хардкод)', async () => {
    const token = makeToken({ uid: 'g1', role: 'security', name: 'Охранник' });
    db.query.mockResolvedValueOnce({ rows: [] });

    await require('supertest')(app)
      .get('/api/visit-logs')
      .set('Cookie', `token=${token}`);

    const sql = db.query.mock.calls[0][0];
    expect(sql).not.toMatch(/LIMIT 500/);
    expect(sql).toMatch(/LIMIT \$1/); // параметризованный лимит
  });

  it('403 для жильца', async () => {
    const token = makeToken({ uid: 'u1', role: 'owner', name: 'Иванов' });
    const res = await require('supertest')(app)
      .get('/api/visit-logs')
      .set('Cookie', `token=${token}`);
    expect(res.status).toBe(403);
  });
});
