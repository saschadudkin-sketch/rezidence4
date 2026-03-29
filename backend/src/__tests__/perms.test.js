'use strict';
/**
 * __tests__/perms.test.js
 * Покрывает: GET /api/perms/:uid, POST /api/perms
 * Проверяет: DATA-2 (type валидация), RBAC, UPSERT без затирания второго типа
 */
jest.mock('../db');
const db = require('../db');

const express      = require('express');
const cookieParser = require('cookie-parser');
const jwt          = require('jsonwebtoken');
const request      = require('supertest');

process.env.JWT_SECRET = 'test-secret';

const permsRouter = require('../routes/perms');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/perms', permsRouter);
  return app;
}

const app = buildApp();

const mk = (p) => jwt.sign(p, 'test-secret', { expiresIn: '1h' });

const T_ADMIN = mk({ uid: 'admin1', role: 'admin',  name: 'Адм' });
const T_U1    = mk({ uid: 'u1',     role: 'owner',  name: 'Вла' });
const T_U2    = mk({ uid: 'u2',     role: 'tenant', name: 'Ар' });

// ─── GET /api/perms/:uid ──────────────────────────────────────────────────────

describe('GET /api/perms/:uid', () => {
  beforeEach(() => jest.clearAllMocks());

  it('401 без токена', async () => {
    const res = await request(app).get('/api/perms/u1');
    expect(res.status).toBe(401);
  });

  it('200 возвращает { visitors, workers } с данными из БД', async () => {
    db.query.mockResolvedValueOnce({
      rows: [
        { type: 'visitors', items: [{ id: 'p1', name: 'Гость', phone: '+79001234567' }] },
        { type: 'workers',  items: [{ id: 'w1', name: 'Слесарь', phone: '+79007654321' }] },
      ],
    });
    const res = await request(app)
      .get('/api/perms/u1').set('Cookie', `token=${T_U1}`);
    expect(res.status).toBe(200);
    expect(res.body.visitors).toHaveLength(1);
    expect(res.body.visitors[0].id).toBe('p1');
    expect(res.body.workers).toHaveLength(1);
    expect(res.body.workers[0].id).toBe('w1');
  });

  it('200 возвращает пустые массивы если записей нет', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .get('/api/perms/u1').set('Cookie', `token=${T_U1}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ visitors: [], workers: [] });
  });

  it('200 частичный результат — только visitors (workers по умолчанию [])', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ type: 'visitors', items: [{ id: 'p2', name: 'Кто-то', phone: '' }] }],
    });
    const res = await request(app)
      .get('/api/perms/u1').set('Cookie', `token=${T_U1}`);
    expect(res.status).toBe(200);
    expect(res.body.workers).toEqual([]);
    expect(res.body.visitors).toHaveLength(1);
  });

  it('запрашивает БД с правильным uid', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    await request(app).get('/api/perms/specific-uid').set('Cookie', `token=${T_ADMIN}`);
    expect(db.query.mock.calls[0][1]).toEqual(['specific-uid']);
  });
});

// ─── POST /api/perms ──────────────────────────────────────────────────────────

describe('POST /api/perms', () => {
  beforeEach(() => jest.clearAllMocks());

  it('401 без токена', async () => {
    const res = await request(app).post('/api/perms')
      .send({ uid: 'u1', type: 'visitors', items: [] });
    expect(res.status).toBe(401);
  });

  it('403 если uid чужой и роль не admin', async () => {
    const res = await request(app)
      .post('/api/perms').set('Cookie', `token=${T_U2}`)
      .send({ uid: 'u1', type: 'visitors', items: [] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden');
    expect(db.query).not.toHaveBeenCalled();
  });

  it('DATA-2: 400 при type = "invalid"', async () => {
    const res = await request(app)
      .post('/api/perms').set('Cookie', `token=${T_U1}`)
      .send({ uid: 'u1', type: 'invalid', items: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid type/i);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('DATA-2: 400 при пустом type (undefined)', async () => {
    const res = await request(app)
      .post('/api/perms').set('Cookie', `token=${T_U1}`)
      .send({ uid: 'u1', items: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid type/i);
  });

  it('200 владелец обновляет свои visitors', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const items = [{ id: 'p1', name: 'Гость', phone: '+79001234567' }];
    const res = await request(app)
      .post('/api/perms').set('Cookie', `token=${T_U1}`)
      .send({ uid: 'u1', type: 'visitors', items });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('200 владелец обновляет своих workers', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const items = [{ id: 'w1', name: 'Слесарь', phone: '+79007654321', carPlate: 'А111ВВ77' }];
    const res = await request(app)
      .post('/api/perms').set('Cookie', `token=${T_U1}`)
      .send({ uid: 'u1', type: 'workers', items });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('200 admin обновляет perms любого пользователя', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .post('/api/perms').set('Cookie', `token=${T_ADMIN}`)
      .send({ uid: 'u1', type: 'visitors', items: [] });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('DATA-2: UPSERT вызывается с правильным type — не перезаписывает другой type', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const items = [{ id: 'w2', name: 'Плотник', phone: '' }];
    await request(app)
      .post('/api/perms').set('Cookie', `token=${T_U1}`)
      .send({ uid: 'u1', type: 'workers', items });

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO perms/i);
    expect(sql).toMatch(/ON CONFLICT.*DO UPDATE/i);
    expect(params[0]).toBe('u1');
    expect(params[1]).toBe('workers');  // type явно в параметрах
  });
});
