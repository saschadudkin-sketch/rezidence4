'use strict';
/**
 * __tests__/blacklist_validation.test.js
 *
 * FIX [AUDIT]: тесты на валидацию длины полей в POST /api/blacklist.
 * Покрывает:
 *   1. Поля в пределах лимитов → 201
 *   2. name > 200 символов → 400
 *   3. phone > 30 символов → 400
 *   4. carPlate > 20 символов → 400
 *   5. reason > 500 символов → 400
 *   6. Все поля null/undefined → 201 (разрешено)
 */

jest.mock('../db');

const db        = require('../db');
const express   = require('express');
const cookieParser = require('cookie-parser');
const jwt       = require('jsonwebtoken');
const supertest = require('supertest');

process.env.JWT_SECRET = 'test-secret-key-32chars-long-xxx';

const blacklistRouter = require('../routes/blacklist');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/blacklist', blacklistRouter);
  return app;
}

const app = buildApp();

function makeToken(role = 'security') {
  return jwt.sign(
    { uid: 'staff-1', role, name: 'Охранник' },
    'test-secret-key-32chars-long-xxx',
    { expiresIn: '1h' },
  );
}

const SECURITY_TOKEN = makeToken('security');
const OWNER_TOKEN    = makeToken('owner');

beforeEach(() => {
  jest.clearAllMocks();
  // Default: DB не вызывался в mock token_revocations
  db.query.mockResolvedValue({ rows: [] });
});

// ─── Авторизация ──────────────────────────────────────────────────────────────

test('403 для роли owner', async () => {
  const res = await supertest(app)
    .post('/api/blacklist')
    .set('Cookie', `token=${OWNER_TOKEN}`)
    .send({ name: 'Иванов' });

  expect(res.status).toBe(403);
});

// ─── Валидные данные ──────────────────────────────────────────────────────────

test('201 при корректных данных', async () => {
  // mock: jti check → not revoked; INSERT → row
  db.query
    .mockResolvedValueOnce({ rows: [] }) // auth check
    .mockResolvedValueOnce({             // INSERT
      rows: [{
        id: 'bl-1', name: 'Тест', phone: '+79001234567',
        car_plate: 'А001АА77', reason: 'Нарушение', added_by: 'Охранник',
        added_at: new Date(),
      }],
    });

  const res = await supertest(app)
    .post('/api/blacklist')
    .set('Cookie', `token=${SECURITY_TOKEN}`)
    .send({ name: 'Тест', phone: '+79001234567', carPlate: 'А001АА77', reason: 'Нарушение' });

  expect(res.status).toBe(201);
  expect(res.body.name).toBe('Тест');
});

// ─── Валидация длины ──────────────────────────────────────────────────────────

test('400 когда name > 200 символов', async () => {
  db.query.mockResolvedValueOnce({ rows: [] }); // auth

  const res = await supertest(app)
    .post('/api/blacklist')
    .set('Cookie', `token=${SECURITY_TOKEN}`)
    .send({ name: 'А'.repeat(201) });

  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/name too long/);
});

test('400 когда phone > 30 символов', async () => {
  db.query.mockResolvedValueOnce({ rows: [] }); // auth

  const res = await supertest(app)
    .post('/api/blacklist')
    .set('Cookie', `token=${SECURITY_TOKEN}`)
    .send({ name: 'Тест', phone: '+7' + '9'.repeat(30) });

  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/phone too long/);
});

test('400 когда carPlate > 20 символов', async () => {
  db.query.mockResolvedValueOnce({ rows: [] }); // auth

  const res = await supertest(app)
    .post('/api/blacklist')
    .set('Cookie', `token=${SECURITY_TOKEN}`)
    .send({ name: 'Тест', carPlate: 'А'.repeat(21) });

  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/carPlate too long/);
});

test('400 когда reason > 500 символов', async () => {
  db.query.mockResolvedValueOnce({ rows: [] }); // auth

  const res = await supertest(app)
    .post('/api/blacklist')
    .set('Cookie', `token=${SECURITY_TOKEN}`)
    .send({ name: 'Тест', reason: 'X'.repeat(501) });

  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/reason too long/);
});

// ─── Граничные значения (ровно на лимите) ─────────────────────────────────────

test('201 когда name ровно 200 символов (граница)', async () => {
  db.query
    .mockResolvedValueOnce({ rows: [] }) // auth
    .mockResolvedValueOnce({
      rows: [{
        id: 'bl-2', name: 'А'.repeat(200), phone: null,
        car_plate: null, reason: null, added_by: 'Охранник', added_at: new Date(),
      }],
    });

  const res = await supertest(app)
    .post('/api/blacklist')
    .set('Cookie', `token=${SECURITY_TOKEN}`)
    .send({ name: 'А'.repeat(200) });

  expect(res.status).toBe(201);
});

// ─── Пустые поля ──────────────────────────────────────────────────────────────

test('201 когда все поля null (только id и added_by заполнены)', async () => {
  db.query
    .mockResolvedValueOnce({ rows: [] }) // auth
    .mockResolvedValueOnce({
      rows: [{
        id: 'bl-3', name: null, phone: null,
        car_plate: null, reason: null, added_by: 'Охранник', added_at: new Date(),
      }],
    });

  const res = await supertest(app)
    .post('/api/blacklist')
    .set('Cookie', `token=${SECURITY_TOKEN}`)
    .send({});

  expect(res.status).toBe(201);
});
