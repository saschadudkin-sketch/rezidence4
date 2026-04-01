'use strict';
/**
 * FIX [TEST-1]: тесты backend — auth routes
 * Запуск: npm test
 */
const request = require('supertest');
const jwt = require('jsonwebtoken');

// ── Mock db перед импортом app ──────────────────────────────────────────────
jest.mock('../db');
const db = require('../db');

// ── Создаём app без запуска сервера ────────────────────────────────────────
// index.js вызывает start() — выносим app в отдельный модуль для тестов
const express      = require('express');
const cookieParser = require('cookie-parser');
const authRouter   = require('../routes/auth');
const requireAuthMiddleware = require('../middleware/auth');

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
const prevAuthEnforceActive = process.env.AUTH_ENFORCE_ACTIVE_USER_CHECK;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
process.env.AUTH_ENFORCE_ACTIVE_USER_CHECK = '1';

afterAll(() => {
  if (prevAuthEnforceActive === undefined) delete process.env.AUTH_ENFORCE_ACTIVE_USER_CHECK;
  else process.env.AUTH_ENFORCE_ACTIVE_USER_CHECK = prevAuthEnforceActive;
});

describe('POST /api/auth/send-otp', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('400 при коротком номере', async () => {
    const res = await request(app)
      .post('/api/auth/send-otp')
      .send({ phone: '123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/номер/i);
  });

  it('200 когда номер не зарегистрирован (защита от user-enumeration)', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [] }); // SELECT uid FROM users
    const res = await request(app)
      .post('/api/auth/send-otp')
      .send({ phone: VALID_PHONE });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
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
    const passwordHasher = require('../utils/passwordHasher');
    const hash   = await passwordHasher.hash(VALID_CODE);

    db.query
      .mockResolvedValueOnce({ rows: [{ id: 1, code: hash }] })        // candidates
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })                     // atomic UPDATE RETURNING
      .mockResolvedValueOnce({ rows: [{ uid: 'u1', phone: VALID_PHONE, name: 'Test', role: 'owner', apartment: '10', avatar: null }] }) // user
      .mockResolvedValueOnce({ rows: [] }); // insert refresh token

    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone: VALID_PHONE, code: VALID_CODE });

    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.token).toBeUndefined(); // токен НЕ в теле ответа
    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    expect(cookies.some(c => c.startsWith('token=') && c.includes('HttpOnly'))).toBe(true);
    expect(cookies.some(c => c.startsWith('refreshToken=') && c.includes('HttpOnly'))).toBe(true);

    const refreshInsertCall = db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO refresh_tokens'));
    expect(refreshInsertCall).toBeDefined();
    expect(refreshInsertCall[0]).toContain('id_hash');
  });

  it('инкрементирует attempts при неверном коде', async () => {
    const passwordHasher = require('../utils/passwordHasher');
    const hash   = await passwordHasher.hash('999999'); // другой код

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
    const token = jwt.sign(
      { uid: 'u1', role: 'owner', name: 'Test', jti: 'jti-1' },
      process.env.JWT_SECRET,
      { expiresIn: '15m' },
    );
    db.query
      .mockResolvedValueOnce({ rows: [] }) // middleware isTokenRevoked (jti not revoked)
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // middleware isUserActive
      .mockResolvedValue({ rows: [] });
    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', [`token=${token}`]);
    expect(res.status).toBe(200);
    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    expect(cookies.some(c => c.startsWith('token=;') || c.includes('Max-Age=0'))).toBe(true);
  });

  it('удаляет refresh token по id_hash или legacy id', async () => {
    const token = jwt.sign(
      { uid: 'u1', role: 'owner', name: 'Test', jti: 'jti-2' },
      process.env.JWT_SECRET,
      { expiresIn: '15m' },
    );
    db.query
      .mockResolvedValueOnce({ rows: [] }) // middleware isTokenRevoked (jti not revoked)
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // middleware isUserActive
      .mockResolvedValue({ rows: [] });
    await request(app)
      .post('/api/auth/logout')
      .set('Cookie', [`token=${token}`, 'refreshToken=legacy-or-raw-token']);

    const deleteCall = db.query.mock.calls.find(([sql]) => sql.includes('DELETE FROM refresh_tokens'));
    expect(deleteCall).toBeDefined();
    expect(deleteCall[0]).toContain('id_hash');
  });
});

describe('POST /api/auth/refresh', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('ротирует refresh token и запрещает reuse старого токена', async () => {
    const passwordHasher = require('../utils/passwordHasher');
    const hash = await passwordHasher.hash(VALID_CODE);

    // 1) verify-otp -> выдаём refreshToken cookie
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 1, code: hash }] }) // verify candidates
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })              // verify atomic mark used
      .mockResolvedValueOnce({ rows: [{ uid: 'u1', phone: VALID_PHONE, name: 'Test', role: 'owner', apartment: '10', avatar: null }] }) // verify user
      .mockResolvedValueOnce({ rows: [] }) // verify refresh insert
      // 2) first /refresh success
      .mockResolvedValueOnce({ rows: [{ uid: 'u1' }] }) // delete refresh token (one-time use)
      .mockResolvedValueOnce({ rows: [{ uid: 'u1', phone: VALID_PHONE, name: 'Test', role: 'owner', apartment: '10', avatar: null }] }) // user
      .mockResolvedValueOnce({ rows: [] }) // insert new refresh token
      // 3) second /refresh with OLD token -> denied
      .mockResolvedValueOnce({ rows: [] });

    const loginRes = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone: VALID_PHONE, code: VALID_CODE });
    expect(loginRes.status).toBe(200);
    const oldRefreshCookie = loginRes.headers['set-cookie'].find(c => c.startsWith('refreshToken='));
    expect(oldRefreshCookie).toBeDefined();

    const refreshRes = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', [oldRefreshCookie]);
    expect(refreshRes.status).toBe(200);

    const reuseRes = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', [oldRefreshCookie]);
    expect(reuseRes.status).toBe(401);

    const deleteCalls = db.query.mock.calls.filter(([sql]) => sql.includes('DELETE FROM refresh_tokens'));
    expect(deleteCalls.length).toBeGreaterThanOrEqual(2);
    expect(deleteCalls[0][0]).toContain('id_hash');
  });
});

describe('GET /api/auth/me', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.query.mockReset();
    requireAuthMiddleware.__clearUserActiveFallbackCache?.();
  });

  it('200 возвращает профиль активного пользователя', async () => {
    const token = jwt.sign(
      { uid: 'u1', role: 'owner', name: 'Test' }, // без jti, чтобы пропустить revocation path
      process.env.JWT_SECRET,
      { expiresIn: '15m' },
    );

    db.query
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // middleware isUserActive
      .mockResolvedValueOnce({
        rows: [{ uid: 'u1', phone: VALID_PHONE, name: 'Test', role: 'owner', apartment: '10', avatar: null }],
      }); // /me query

    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', [`token=${token}`]);

    expect(res.status).toBe(200);
    expect(res.body.user.uid).toBe('u1');
  });

  it('401 если пользователь soft-deleted (блокируется в middleware)', async () => {
    const token = jwt.sign(
      { uid: 'u-deleted', role: 'owner', name: 'Deleted' },
      process.env.JWT_SECRET,
      { expiresIn: '15m' },
    );

    db.query.mockResolvedValueOnce({ rows: [] }); // middleware isUserActive => false

    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', [`token=${token}`]);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('User not found or deleted');
    expect(db.query).toHaveBeenCalledTimes(1);
  });
});
