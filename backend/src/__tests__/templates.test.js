'use strict';
/**
 * __tests__/templates.test.js
 * Покрывает: GET /api/templates/:uid, POST /api/templates
 * Проверяет: ARCH-2 (отдельный роутер — нет конфликта с perms/:uid),
 *            RBAC (только свои шаблоны), UPSERT
 */
jest.mock('../db');
const db = require('../db');

const express      = require('express');
const cookieParser = require('cookie-parser');
const jwt          = require('jsonwebtoken');
const request      = require('supertest');

process.env.JWT_SECRET = 'test-secret';

const templatesRouter = require('../routes/templates');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/templates', templatesRouter);
  return app;
}

const app = buildApp();

const mk = (p) => jwt.sign(p, 'test-secret', { expiresIn: '1h' });

const T_ADMIN = mk({ uid: 'admin1', role: 'admin',  name: 'Адм' });
const T_U1    = mk({ uid: 'u1',     role: 'owner',  name: 'Вла' });
const T_U2    = mk({ uid: 'u2',     role: 'tenant', name: 'Ар' });

const SAMPLE_TEMPLATES = [
  { id: 't1', name: 'Гость Дима', type: 'pass', category: 'guest',
    visitorName: 'Дмитрий', visitorPhone: '+79001234567', carPlate: '', comment: '' },
  { id: 't2', name: 'Сантехник',  type: 'tech', category: 'plumber',
    visitorName: '',          visitorPhone: '',            carPlate: '', comment: 'Течёт кран' },
];

// ─── GET /api/templates/:uid ──────────────────────────────────────────────────

describe('GET /api/templates/:uid', () => {
  beforeEach(() => jest.clearAllMocks());

  it('401 без токена', async () => {
    const res = await request(app).get('/api/templates/u1');
    expect(res.status).toBe(401);
  });

  it('200 возвращает items пользователя', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ items: SAMPLE_TEMPLATES }] });
    const res = await request(app)
      .get('/api/templates/u1').set('Cookie', `token=${T_U1}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].id).toBe('t1');
    expect(res.body[1].comment).toBe('Течёт кран');
  });

  it('200 возвращает [] если нет записей', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .get('/api/templates/u1').set('Cookie', `token=${T_U1}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('запрашивает БД с правильным uid', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    await request(app).get('/api/templates/specific-uid').set('Cookie', `token=${T_ADMIN}`);
    expect(db.query.mock.calls[0][1]).toEqual(['specific-uid']);
  });
});

// ─── POST /api/templates ──────────────────────────────────────────────────────

describe('POST /api/templates', () => {
  beforeEach(() => jest.clearAllMocks());

  it('401 без токена', async () => {
    const res = await request(app).post('/api/templates')
      .send({ uid: 'u1', items: [] });
    expect(res.status).toBe(401);
  });

  it('403 если uid чужой и роль не admin', async () => {
    const res = await request(app)
      .post('/api/templates').set('Cookie', `token=${T_U2}`)
      .send({ uid: 'u1', items: [] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden');
    expect(db.query).not.toHaveBeenCalled();
  });

  it('200 владелец сохраняет свои шаблоны', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .post('/api/templates').set('Cookie', `token=${T_U1}`)
      .send({ uid: 'u1', items: SAMPLE_TEMPLATES });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('200 admin сохраняет шаблоны любого пользователя', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .post('/api/templates').set('Cookie', `token=${T_ADMIN}`)
      .send({ uid: 'u1', items: SAMPLE_TEMPLATES });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('200 сохраняет пустой список (очистка шаблонов)', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .post('/api/templates').set('Cookie', `token=${T_U1}`)
      .send({ uid: 'u1', items: [] });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('UPSERT с правильными параметрами (uid, JSON-строка items)', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    await request(app)
      .post('/api/templates').set('Cookie', `token=${T_U1}`)
      .send({ uid: 'u1', items: SAMPLE_TEMPLATES });

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO templates/i);
    expect(sql).toMatch(/ON CONFLICT.*DO UPDATE/i);
    expect(params[0]).toBe('u1');
    // items должны быть сериализованы как JSON-строка
    const parsed = JSON.parse(params[1]);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].id).toBe('t1');
  });
});
