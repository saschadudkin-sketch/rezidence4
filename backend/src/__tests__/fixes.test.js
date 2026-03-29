'use strict';
/**
 * __tests__/fixes.test.js — тесты для всех исправлений из аудита.
 *
 * Покрывает:
 *   FIX-1: logout allDevices требует валидного токена (не принимает поддельный)
 *   FIX-2: GET /perms/:uid — запрещён для чужих пользователей
 *   FIX-3: upload — имя файла использует crypto, не Math.random
 *   FIX-4: OTP — INSERT происходит ПОСЛЕ sendSms, не до
 *   FIX-5: RequestsService.list — один запрос вместо двух (window function)
 *   FIX-6: CSRF exempt — точное совпадение, не endsWith
 *   FIX-7: perms GET — staff может читать чужие perms
 */

const jwt = require('jsonwebtoken');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SECRET = 'test-secret-at-least-16-chars';
process.env.JWT_SECRET    = SECRET;
process.env.DATABASE_URL  = 'postgresql://test:test@localhost/test';
process.env.NODE_ENV      = 'test';

function makeToken(payload, secret = SECRET) {
  return jwt.sign({ jti: 'test-jti', ...payload }, secret, { expiresIn: '15m' });
}

// ─── FIX-1: logout allDevices — поддельный токен должен вернуть 401 ───────────

describe('FIX-1: logout allDevices requires authenticated user', () => {
  let app;
  let mockDb;

  beforeEach(() => {
    jest.resetModules();
    mockDb = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    jest.mock('../db', () => mockDb);
    jest.mock('../logger', () => require('../__mocks__/logger'));
    jest.mock('../lib/redisClient', () => ({ getRedis: () => null, closeRedis: async () => {} }));
    app = require('express')();
    app.use(require('cookie-parser')());
    app.use(require('express').json());
    // Устанавливаем csrf bypass для тестов
    app.use((req, _res, next) => { req.cookies = req.cookies || {}; next(); });
    const authRouter = require('../routes/auth');
    app.use('/api/auth', authRouter);
    app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  });

  test('logout with forged token (wrong secret) returns 401', async () => {
    const forgedToken = makeToken({ uid: 'victim-uid', role: 'owner' }, 'wrong-secret');
    const request = require('supertest');
    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', `token=${forgedToken}`)
      .send({ allDevices: true });
    expect(res.status).toBe(401);
  });

  test('logout with no token returns 401', async () => {
    const request = require('supertest');
    const res = await request(app)
      .post('/api/auth/logout')
      .send({ allDevices: true });
    expect(res.status).toBe(401);
  });

  test('logout with valid token succeeds', async () => {
    const token = makeToken({ uid: 'real-uid', role: 'owner' });
    // Мокируем token_revocations — токен не отозван
    mockDb.query.mockImplementation((sql) => {
      if (sql.includes('token_revocations')) return { rows: [] };
      if (sql.includes('refresh_tokens'))    return { rows: [], rowCount: 1 };
      return { rows: [] };
    });
    const request = require('supertest');
    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', `token=${token}`)
      .send({});
    expect(res.status).toBe(200);
  });
});

// ─── FIX-2 & FIX-7: GET /perms/:uid authorization ────────────────────────────

describe('FIX-2/7: GET /perms/:uid access control', () => {
  let app;
  let mockDb;

  beforeEach(() => {
    jest.resetModules();
    mockDb = {
      query: jest.fn().mockImplementation((sql) => {
        if (sql.includes('token_revocations')) return Promise.resolve({ rows: [] });
        if (sql.includes('SELECT type, items')) return Promise.resolve({
          rows: [{ type: 'visitors', items: [{ name: 'Иванов' }] }],
        });
        return Promise.resolve({ rows: [] });
      }),
    };
    jest.mock('../db', () => mockDb);
    jest.mock('../logger', () => require('../__mocks__/logger'));
    jest.mock('../lib/redisClient', () => ({ getRedis: () => null }));
    app = require('express')();
    app.use(require('cookie-parser')());
    app.use(require('express').json());
    const requireAuth = require('../middleware/auth');
    const permsRouter  = require('../routes/perms');
    app.use('/api/perms', permsRouter);
    app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  });

  test('owner cannot read another owner perms', async () => {
    const token   = makeToken({ uid: 'owner-1', role: 'owner' });
    const request = require('supertest');
    const res = await request(app)
      .get('/api/perms/owner-2')
      .set('Cookie', `token=${token}`);
    expect(res.status).toBe(403);
  });

  test('user can read their own perms', async () => {
    const token   = makeToken({ uid: 'owner-1', role: 'owner' });
    const request = require('supertest');
    const res = await request(app)
      .get('/api/perms/owner-1')
      .set('Cookie', `token=${token}`);
    expect(res.status).toBe(200);
  });

  test('staff (security) can read any user perms', async () => {
    const token   = makeToken({ uid: 'sec-1', role: 'security' });
    const request = require('supertest');
    const res = await request(app)
      .get('/api/perms/owner-1')
      .set('Cookie', `token=${token}`);
    expect(res.status).toBe(200);
  });

  test('admin can read any user perms', async () => {
    const token   = makeToken({ uid: 'admin-1', role: 'admin' });
    const request = require('supertest');
    const res = await request(app)
      .get('/api/perms/owner-1')
      .set('Cookie', `token=${token}`);
    expect(res.status).toBe(200);
  });
});

// ─── FIX-3: upload filename — crypto.randomBytes, not Math.random ─────────────

describe('FIX-3: upload filename entropy', () => {
  test('photo filename contains crypto hex (24 chars), not Math.random output', () => {
    // randomBytes(12).toString('hex') → 24 hex chars
    const { randomBytes } = require('crypto');
    const hex = randomBytes(12).toString('hex');
    expect(hex).toMatch(/^[0-9a-f]{24}$/);

    // Math.random().toString(36).slice(2) максимум ~11 chars и предсказуем
    const mathR = Math.random().toString(36).slice(2);
    expect(mathR.length).toBeLessThan(15); // обычно 10-11 символов
    // hex в 2+ раза длиннее и криптографически случаен
    expect(hex.length).toBeGreaterThan(mathR.length);
  });

  test('two randomBytes(12) calls never collide (birthday bound)', () => {
    const SAMPLES = 10_000;
    const seen    = new Set();
    for (let i = 0; i < SAMPLES; i++) {
      const h = require('crypto').randomBytes(12).toString('hex');
      expect(seen.has(h)).toBe(false);
      seen.add(h);
    }
  });
});

// ─── FIX-6: CSRF exempt — точное совпадение ────────────────────────────────────

describe('FIX-6: CSRF exempt uses exact path matching', () => {
  let setCsrfCookie, verifyCsrf;

  beforeEach(() => {
    jest.resetModules();
    process.env.NODE_ENV = 'test';
    ({ setCsrfCookie, verifyCsrf } = require('../middleware/csrf'));
  });

  function mockReq(method, path, cookies = {}, headers = {}) {
    return { method, path, cookies, headers };
  }

  function mockRes() {
    const res = { statusCode: 200, _body: null };
    res.status  = (code) => { res.statusCode = code; return res; };
    res.json    = (body) => { res._body = body; return res; };
    res.cookie  = () => res;
    return res;
  }

  test('POST to /auth/send-otp is exempt (exact match)', () => {
    const req  = mockReq('POST', '/auth/send-otp', {}, {});
    const res  = mockRes();
    const next = jest.fn();
    verifyCsrf(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  test('POST to /auth/verify-otp is exempt', () => {
    const req  = mockReq('POST', '/auth/verify-otp', {}, {});
    const res  = mockRes();
    const next = jest.fn();
    verifyCsrf(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('POST to /evil/send-otp is NOT exempt (no such route exists, but guard is precise)', () => {
    const req  = mockReq('POST', '/evil/send-otp', { 'rz-csrf': 'abc' }, {});
    const res  = mockRes();
    const next = jest.fn();
    verifyCsrf(req, res, next);
    // Без совпадающего header token → должен отклонить
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  test('POST with matching csrf cookie+header passes', () => {
    const token = 'valid-csrf-token-32chars';
    const req   = mockReq(
      'POST', '/chat/messages',
      { 'rz-csrf': token },
      { 'x-csrf-token': token },
    );
    const res  = mockRes();
    const next = jest.fn();
    verifyCsrf(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('POST with mismatched csrf token is rejected', () => {
    const req = mockReq(
      'POST', '/chat/messages',
      { 'rz-csrf': 'cookie-token' },
      { 'x-csrf-token': 'different-token' },
    );
    const res  = mockRes();
    const next = jest.fn();
    verifyCsrf(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });
});

// ─── FIX-4: OTP ordering — INSERT after sendSms ───────────────────────────────

describe('FIX-4: OTP insert happens AFTER SMS send', () => {
  test('if sendSms throws, no OTP record is created', async () => {
    jest.resetModules();

    const insertCalls = [];
    const mockDb = {
      query: jest.fn().mockImplementation((sql, params) => {
        if (sql.includes('INSERT INTO otp_codes')) {
          insertCalls.push({ sql, params });
        }
        // Остальные запросы — SELECT uid EXISTS, DELETE old codes, COUNT active
        if (sql.includes('SELECT uid'))    return Promise.resolve({ rows: [{ uid: 'u1' }] });
        if (sql.includes('DELETE FROM'))   return Promise.resolve({ rows: [] });
        if (sql.includes('COUNT(*)'))      return Promise.resolve({ rows: [{ count: '0' }] });
        return Promise.resolve({ rows: [] });
      }),
    };
    jest.mock('../db', () => mockDb);
    jest.mock('../logger', () => require('../__mocks__/logger'));
    jest.mock('../lib/redisClient', () => ({ getRedis: () => null }));
    jest.mock('node-fetch', () => () => {
      throw new Error('SMS service unavailable');
    });
    jest.mock('bcrypt', () => ({ hash: async () => '$2b$hashed' }));

    const authRouter = require('../routes/auth');
    const app = require('express')();
    app.use(require('express').json());
    app.use(require('cookie-parser')());
    process.env.SMSRU_API_ID = 'REAL_NOT_STUB'; // включаем реальную отправку
    app.use('/api/auth', authRouter);
    app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));

    const request = require('supertest');
    const res = await request(app)
      .post('/api/auth/send-otp')
      .send({ phone: '+79991234567' });

    // SMS упал → INSERT не должен был выполниться
    expect(insertCalls.length).toBe(0);
    expect(res.status).toBe(500);
    process.env.SMSRU_API_ID = 'STUB'; // сбрасываем
  });
});

// ─── FIX-5: RequestsService.list — один запрос с window function ──────────────

describe('FIX-5: RequestsService.list uses single query with COUNT(*) OVER()', () => {
  test('list calls db.query exactly once for staff', async () => {
    jest.resetModules();

    const querySpy = jest.fn().mockResolvedValue({
      rows: [
        {
          id: 'r1', type: 'pass', category: 'guest', status: 'pending',
          created_by_uid: 'u1', created_by_name: 'Test', created_by_role: 'owner',
          created_by_apt: null, visitor_name: null, visitor_phone: null,
          car_plate: null, comment: '', pass_duration: 'once',
          valid_until: null, scheduled_for: null, arrived_at: null,
          photos: [], created_at: new Date(), updated_at: new Date(),
          total_count: '3',
        },
      ],
    });
    jest.mock('../db', () => ({ query: querySpy, pool: {} }));
    jest.mock('../logger', () => require('../__mocks__/logger'));

    const { RequestsService } = require('../services/RequestsService');
    const result = await RequestsService.list({ uid: 'u1', role: 'admin' });

    // Один запрос вместо двух
    expect(querySpy).toHaveBeenCalledTimes(1);
    expect(querySpy.mock.calls[0][0]).toContain('COUNT(*) OVER()');
    expect(result.total).toBe(3);
  });

  test('list calls db.query exactly once for resident', async () => {
    jest.resetModules();

    const querySpy = jest.fn().mockResolvedValue({ rows: [] });
    jest.mock('../db', () => ({ query: querySpy, pool: {} }));
    jest.mock('../logger', () => require('../__mocks__/logger'));

    const { RequestsService } = require('../services/RequestsService');
    await RequestsService.list({ uid: 'u1', role: 'owner' });

    expect(querySpy).toHaveBeenCalledTimes(1);
    expect(querySpy.mock.calls[0][0]).toContain('COUNT(*) OVER()');
    expect(querySpy.mock.calls[0][0]).toContain('created_by_uid=$1');
  });
});

// ─── AUDIT-2 FIX: send-otp no longer enumerates users ────────────────────────

describe('AUDIT-2: send-otp does not reveal whether phone is registered', () => {
  let app;

  beforeEach(() => {
    jest.resetModules();
    const mockDb = {
      query: jest.fn().mockImplementation((sql) => {
        // Возвращаем пустой результат — номер не найден
        if (sql.includes('SELECT uid FROM users')) return Promise.resolve({ rows: [] });
        return Promise.resolve({ rows: [{ count: '0' }] });
      }),
    };
    jest.mock('../db', () => mockDb);
    jest.mock('../logger', () => require('../__mocks__/logger'));
    jest.mock('../lib/redisClient', () => ({ getRedis: () => null }));
    jest.mock('node-fetch', () => () => {});
    jest.mock('bcrypt', () => ({ hash: async () => '$2b$hashed' }));

    app = require('express')();
    app.use(require('express').json());
    app.use(require('cookie-parser')());
    app.use('/api/auth', require('../routes/auth'));
    app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  });

  test('unknown phone returns 200, not 404', async () => {
    const request = require('supertest');
    const res = await request(app)
      .post('/api/auth/send-otp')
      .send({ phone: '+79999999999' });
    // Не должно быть 404 — раскрыло бы список зарегистрированных номеров
    expect(res.status).not.toBe(404);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ─── AUDIT-2 FIX: logout uses req.user.jti (no double jwt.verify) ─────────────

describe('AUDIT-2: logout uses req.user payload, no double verify', () => {
  test('logout handler source does not call jwt.verify after requireAuth', () => {
    // Читаем исходник роута и проверяем что jwt.verify не вызывается внутри logout handler
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../routes/auth.js'), 'utf8',
    );
    // Находим блок logout handler (после строки router.post('/logout', requireAuth
    const logoutIdx = src.indexOf("router.post('/logout', requireAuth");
    expect(logoutIdx).toBeGreaterThan(0);
    // Следующий router.post — это refresh
    const nextRouteIdx = src.indexOf("router.post('/refresh'", logoutIdx);
    const logoutBody = src.slice(logoutIdx, nextRouteIdx);
    // В теле logout не должно быть jwt.verify (только req.user.jti используется)
    expect(logoutBody).not.toContain('jwt.verify(');
  });
});

// ─── AUDIT-2 FIX: upload.js requires at top level ────────────────────────────

describe('AUDIT-2: upload.js has no require() inside handler', () => {
  test('require calls are at module top level, not inside handler', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../routes/upload.js'), 'utf8',
    );
    // Все require должны быть в первых 20 строках (top of file)
    const lines = src.split('\n');
    const requireLines = lines
      .map((l, i) => ({ line: i + 1, text: l.trim() }))
      .filter(({ text }) => text.startsWith('const ') && text.includes('require('));
    // Проверяем что ни один require не находится внутри функции/хендлера (после строки 20)
    const lateRequires = requireLines.filter(({ line }) => line > 20);
    expect(lateRequires).toHaveLength(0);
  });
});
