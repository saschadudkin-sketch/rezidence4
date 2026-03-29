'use strict';
/**
 * Тесты backend — blacklist routes
 * Покрывает: BUG-6 (GET доступен только персоналу), роли для POST/DELETE
 */
jest.mock('../db');
const db = require('../db');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'test-secret';

const blacklistRouter = require('../routes/blacklist');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/blacklist', blacklistRouter);
  return app;
}
const app = buildApp();

function makeToken(payload) {
  return jwt.sign(payload, 'test-secret', { expiresIn: '1h' });
}

const request = require('supertest');

// ─── GET /api/blacklist ───────────────────────────────────────────────────────

describe('GET /api/blacklist — контроль доступа', () => {
  beforeEach(() => jest.clearAllMocks());

  it('403 для жильца (owner)', async () => {
    const token = makeToken({ uid: 'u1', role: 'owner', name: 'Иванов' });
    const res = await request(app)
      .get('/api/blacklist')
      .set('Cookie', `token=${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden');
    // БД не должна была дёргаться
    expect(db.query).not.toHaveBeenCalled();
  });

  it('403 для арендатора (tenant)', async () => {
    const token = makeToken({ uid: 'u2', role: 'tenant', name: 'Петров' });
    const res = await request(app)
      .get('/api/blacklist')
      .set('Cookie', `token=${token}`);
    expect(res.status).toBe(403);
  });

  it('403 для подрядчика (contractor)', async () => {
    const token = makeToken({ uid: 'u3', role: 'contractor', name: 'Сидоров' });
    const res = await request(app)
      .get('/api/blacklist')
      .set('Cookie', `token=${token}`);
    expect(res.status).toBe(403);
  });

  it('200 для охраны (security)', async () => {
    const token = makeToken({ uid: 'g1', role: 'security', name: 'Охранник' });
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .get('/api/blacklist')
      .set('Cookie', `token=${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('200 для консьержа (concierge)', async () => {
    const token = makeToken({ uid: 'c1', role: 'concierge', name: 'Консьерж' });
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .get('/api/blacklist')
      .set('Cookie', `token=${token}`);
    expect(res.status).toBe(200);
  });

  it('200 для админа (admin)', async () => {
    const token = makeToken({ uid: 'a1', role: 'admin', name: 'Админ' });
    db.query.mockResolvedValueOnce({
      rows: [{ id: 'bl-1', name: 'Тест', phone: '+79001234567', car_plate: 'А123БВ', reason: 'test', added_by: 'Охранник', added_at: new Date() }],
    });
    const res = await request(app)
      .get('/api/blacklist')
      .set('Cookie', `token=${token}`);
    expect(res.status).toBe(200);
    expect(res.body[0].id).toBe('bl-1');
    expect(res.body[0].carPlate).toBe('А123БВ'); // проверяем camelCase маппинг
  });

  it('401 без токена', async () => {
    const res = await request(app).get('/api/blacklist');
    expect(res.status).toBe(401);
  });
});

// ─── POST /api/blacklist ──────────────────────────────────────────────────────

describe('POST /api/blacklist', () => {
  beforeEach(() => jest.clearAllMocks());

  it('403 для жильца', async () => {
    const token = makeToken({ uid: 'u1', role: 'owner', name: 'Иванов' });
    const res = await request(app)
      .post('/api/blacklist')
      .set('Cookie', `token=${token}`)
      .send({ name: 'Нарушитель', reason: 'test' });
    expect(res.status).toBe(403);
  });

  it('201 для охраны', async () => {
    const token = makeToken({ uid: 'g1', role: 'security', name: 'Охранник' });
    db.query.mockResolvedValueOnce({
      rows: [{ id: 'bl-new', name: 'Нарушитель', phone: null, car_plate: null, reason: 'test', added_by: 'Охранник', added_at: new Date() }],
    });
    const res = await request(app)
      .post('/api/blacklist')
      .set('Cookie', `token=${token}`)
      .send({ name: 'Нарушитель', reason: 'test' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe('bl-new');
  });
});

// ─── DELETE /api/blacklist/:id ────────────────────────────────────────────────

describe('DELETE /api/blacklist/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  it('403 для жильца', async () => {
    const token = makeToken({ uid: 'u1', role: 'owner', name: 'Иванов' });
    const res = await request(app)
      .delete('/api/blacklist/bl-1')
      .set('Cookie', `token=${token}`);
    expect(res.status).toBe(403);
  });

  it('200 для охраны', async () => {
    const token = makeToken({ uid: 'g1', role: 'security', name: 'Охранник' });
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .delete('/api/blacklist/bl-1')
      .set('Cookie', `token=${token}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
