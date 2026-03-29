'use strict';
/**
 * FIX [TEST-1]: тесты backend — auth routes
 * Запуск: npm test
 */
const request = require('supertest');

// ── Mock db перед импортом app ──────────────────────────────────────────────
jest.mock('../db');
const db = require('../db');

// ── Создаём app без запуска сервера ────────────────────────────────────────
// index.js вызывает start() — выносим app в отдельный модуль для тестов
const express      = require('express');
const cookieParser = require('cookie-parser');
const authRouter   = require('../routes/auth');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRouter);
  return app;
}

const app = buildApp();

// ── Helpers ─────────────────────────────────────────────────────────────────
const VALID_PHONE = '+79001234567';
const VALID_CODE  = '123456';

describe('POST /api/auth/send-otp', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('400 при коротком номере', async () => {
    const res = await request(app)
      .post('/api/auth/send-otp')
      .send({ phone: '123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/номер/i);
  });

  it('404 когда номер не зарегистрирован', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [] }); // SELECT uid FROM users
    const res = await request(app)
      .post('/api/auth/send-otp')
      .send({ phone: VALID_PHONE });
    expect(res.status).toBe(404);
  });

  it('429 при 3+ активных кодах', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ uid: 'u1' }] })   // users exist
      .mockResolvedValueOnce({ rows: [] })                  // DELETE expired
      .mockResolvedValueOnce({ rows: [{ count: '3' }] });   // active count >= 3
    const res = await request(app)
      .post('/api/auth/send-otp')
      .send({ phone: VALID_PHONE });
    expect(res.status).toBe(429);
  });

  it('200 OK и { ok: true } при успехе', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ uid: 'u1' }] })   // users exist
      .mockResolvedValueOnce({ rows: [] })                  // DELETE expired
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })   // active count < 3
      .mockResolvedValueOnce({ rows: [] });                 // INSERT otp
    const res = await request(app)
      .post('/api/auth/send-otp')
      .send({ phone: VALID_PHONE });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe('POST /api/auth/verify-otp', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('400 при слишком коротком коде', async () => {
    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone: VALID_PHONE, code: '12' });
    expect(res.status).toBe(400);
  });

  it('401 когда нет подходящих кодов в БД', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }); // нет кандидатов
    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone: VALID_PHONE, code: VALID_CODE });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/неверный/i);
  });

  it('устанавливает HttpOnly cookie при успехе', async () => {
    const bcrypt = require('bcrypt');
    const hash   = await bcrypt.hash(VALID_CODE, 10);

    db.query
      .mockResolvedValueOnce({ rows: [{ id: 1, code: hash }] })        // candidates
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })                     // atomic UPDATE RETURNING
      .mockResolvedValueOnce({ rows: [{ uid: 'u1', phone: VALID_PHONE, name: 'Test', role: 'owner', apartment: '10', avatar: null }] }); // user

    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone: VALID_PHONE, code: VALID_CODE });

    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.token).toBeUndefined(); // токен НЕ в теле ответа
    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    expect(cookies.some(c => c.startsWith('token=') && c.includes('HttpOnly'))).toBe(true);
  });

  it('инкрементирует attempts при неверном коде', async () => {
    const bcrypt = require('bcrypt');
    const hash   = await bcrypt.hash('999999', 10); // другой код

    db.query
      .mockResolvedValueOnce({ rows: [{ id: 1, code: hash }] }) // кандидат
      .mockResolvedValueOnce({ rows: [] });                       // UPDATE attempts

    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone: VALID_PHONE, code: VALID_CODE }); // неверный

    expect(res.status).toBe(401);
    // Убеждаемся что UPDATE attempts был вызван
    const updateCall = db.query.mock.calls.find(c => c[0].includes('attempts + 1'));
    expect(updateCall).toBeDefined();
  });
});

describe('POST /api/auth/logout', () => {
  it('сбрасывает cookie token', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(200);
    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    expect(cookies.some(c => c.startsWith('token=;') || c.includes('Max-Age=0'))).toBe(true);
  });
});
