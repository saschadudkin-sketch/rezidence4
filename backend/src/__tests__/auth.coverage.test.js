'use strict';

// Coverage tests для auth.js handler'ов — happy-paths которые не покрыты
// в auth.test.js (тот сосредоточен на error/edge cases).  Цель — поднять
// Functions/Branches coverage критического gate выше 70%.
//
// Pre-existing failures в auth.test.js — отдельный issue (mock'ы не
// совпадают с current /me LEFT JOIN shape).  Этот файл изолирован.

jest.mock('../db');
jest.mock('../sse', () => ({ broadcastRequestUpdate: jest.fn() }));
jest.mock('../lib/redisClient', () => ({ getRedis: jest.fn(() => null) }));
jest.mock('../services/smsService', () => ({ sendSms: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../utils/passwordHasher', () => ({
  hash: jest.fn().mockResolvedValue('hashed-password'),
  compare: jest.fn(),
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');

const db = require('../db');
const { sendSms } = require('../services/smsService');
const passwordHasher = require('../utils/passwordHasher');

process.env.JWT_SECRET = 'a'.repeat(40);
process.env.AUTH_SKIP_ACTIVE_CHECK = '1'; // bypass middleware DB check для изоляции

const express = require('express');
const cookieParser = require('cookie-parser');
const authRouter = require('../routes/auth');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRouter);
  return app;
}
const app = buildApp();

const VALID_PHONE = '+79001234567';

beforeEach(() => {
  jest.clearAllMocks();
  // sendSms возвращает undefined по умолчанию — happy path
  sendSms.mockResolvedValue(undefined);
});

// ─── send-otp success path (DB-fallback без Redis) ───────────────────────────
describe('POST /api/auth/send-otp — success path coverage', () => {
  it('200 happy path: SMS sent, hash, INSERT', async () => {
    // 1. SELECT uid FROM users WHERE phone=$1 — найден
    db.query.mockResolvedValueOnce({ rows: [{ uid: 'u1' }] });
    // 2. DELETE expired OTPs (DB rate-limit fallback path)
    db.query.mockResolvedValueOnce({ rows: [] });
    // 3. SELECT COUNT(*) active — under limit
    db.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });
    // 4. INSERT INTO otp_codes
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/auth/send-otp')
      .send({ phone: VALID_PHONE });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(sendSms).toHaveBeenCalledTimes(1);
    expect(sendSms.mock.calls[0][0]).toBe(VALID_PHONE);
    expect(sendSms.mock.calls[0][1]).toMatch(/Код входа Резиденции:/);
    expect(passwordHasher.hash).toHaveBeenCalledTimes(1);
  });

  it('429 rate-limited когда DB-counter >= OTP_SEND_MAX (DB-fallback path)', async () => {
    // Найден пользователь
    db.query.mockResolvedValueOnce({ rows: [{ uid: 'u1' }] });
    // DELETE expired
    db.query.mockResolvedValueOnce({ rows: [] });
    // SELECT COUNT — exceeded
    db.query.mockResolvedValueOnce({ rows: [{ count: '3' }] });

    const res = await request(app)
      .post('/api/auth/send-otp')
      .send({ phone: VALID_PHONE });

    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/много попыток/i);
    expect(sendSms).not.toHaveBeenCalled();
  });

  it('500 если sendSms throws — hash и INSERT не выполняются', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ uid: 'u1' }] });
    db.query.mockResolvedValueOnce({ rows: [] });
    db.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });
    sendSms.mockRejectedValueOnce(new Error('sms provider down'));

    const res = await request(app)
      .post('/api/auth/send-otp')
      .send({ phone: VALID_PHONE });

    expect(res.status).toBe(500);
    expect(passwordHasher.hash).not.toHaveBeenCalled();
  });
});

// ─── verify-otp success path ─────────────────────────────────────────────────
describe('POST /api/auth/verify-otp — success path coverage', () => {
  it('200 happy path: code matches, marked used, tokens set', async () => {
    // 1. SELECT candidates (active OTPs)
    db.query.mockResolvedValueOnce({
      rows: [{ id: 'otp-1', code: 'hashed-code' }],
    });
    // hash compare returns true
    passwordHasher.compare.mockResolvedValueOnce(true);
    // 2. UPDATE otp_codes SET used=TRUE — атомарно помечает
    db.query.mockResolvedValueOnce({ rows: [{ id: 'otp-1' }] });
    // 3. SELECT user
    db.query.mockResolvedValueOnce({
      rows: [{
        uid: 'u1', phone: VALID_PHONE, name: 'Test',
        role: 'owner', apartment: '10', avatar: null, property_slug: null,
      }],
    });
    // 4. INSERT INTO refresh_tokens (от setRefreshTokenCookie)
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone: VALID_PHONE, code: '123456' });

    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.uid).toBe('u1');
    // Cookies должны быть в response
    expect(res.headers['set-cookie']).toBeDefined();
    expect(res.headers['set-cookie'].some((c) => /^token=/.test(c))).toBe(true);
    expect(res.headers['set-cookie'].some((c) => /^refreshToken=/.test(c))).toBe(true);
  });

  it('200 includes property_type on initial login when user has property_slug', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ id: 'otp-1', code: 'hashed-code' }],
    });
    passwordHasher.compare.mockResolvedValueOnce(true);
    db.query.mockResolvedValueOnce({ rows: [{ id: 'otp-1' }] });
    db.query.mockResolvedValueOnce({
      rows: [{
        uid: 'u1', phone: VALID_PHONE, name: 'Test',
        role: 'owner', apartment: '10', avatar: null, property_slug: 'lesnaya-rezidenciya',
      }],
    });
    db.query.mockResolvedValueOnce({
      rows: [{ id: 'prop-uuid-1', property_type: 'cottage_community' }],
    });
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone: VALID_PHONE, code: '123456' });

    expect(res.status).toBe(200);
    expect(res.body.user.property_id).toBe('prop-uuid-1');
    expect(res.body.user.property_type).toBe('cottage_community');
  });

  it('400 при коротком code', async () => {
    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone: VALID_PHONE, code: '12' });
    expect(res.status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('401 если ни один candidate не совпал (DB UPDATE attempts++)', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ id: 'otp-1', code: 'hashed-code' }],
    });
    passwordHasher.compare.mockResolvedValueOnce(false);
    db.query.mockResolvedValueOnce({ rows: [] }); // UPDATE attempts++

    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone: VALID_PHONE, code: '999999' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/неверный/i);
  });

  it('401 race condition: matched но кто-то успел раньше пометить used', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ id: 'otp-1', code: 'hashed-code' }],
    });
    passwordHasher.compare.mockResolvedValueOnce(true);
    // UPDATE returns empty — race lost
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone: VALID_PHONE, code: '123456' });

    expect(res.status).toBe(401);
  });

  it('404 user not found после успешного match', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ id: 'otp-1', code: 'hashed-code' }],
    });
    passwordHasher.compare.mockResolvedValueOnce(true);
    db.query.mockResolvedValueOnce({ rows: [{ id: 'otp-1' }] });
    // SELECT user returns empty
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone: VALID_PHONE, code: '123456' });

    expect(res.status).toBe(404);
  });
});

// ─── logout success paths ────────────────────────────────────────────────────
describe('POST /api/auth/logout — coverage', () => {
  function makeAuthToken({ jti, uid = 'u1' } = {}) {
    const payload = { uid, role: 'owner', name: 'Test' };
    if (jti) payload.jti = jti;
    return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '15m' });
  }

  it('200 logout single device: DELETE refresh_tokens BY id+hash', async () => {
    const token = makeAuthToken();
    // logout не вызывает middleware DB query (AUTH_SKIP_ACTIVE_CHECK=1)
    db.query.mockResolvedValueOnce({ rows: [] }); // DELETE FROM refresh_tokens

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', [`token=${token}`, 'refreshToken=raw-refresh-id'])
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // Проверяем что DELETE был с id=$1 OR id_hash=$2
    const deleteCall = db.query.mock.calls.find(([sql]) => /DELETE FROM refresh_tokens/.test(sql));
    expect(deleteCall).toBeDefined();
    expect(deleteCall[0]).toMatch(/id=\$1 OR id_hash=\$2/);
  });

  it('200 logout allDevices=true: DELETE all refresh_tokens BY uid', async () => {
    const token = makeAuthToken();
    db.query.mockResolvedValueOnce({ rows: [] }); // DELETE FROM refresh_tokens WHERE uid

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', [`token=${token}`])
      .send({ allDevices: true });

    expect(res.status).toBe(200);
    const deleteCall = db.query.mock.calls.find(([sql]) => /DELETE FROM refresh_tokens WHERE uid=/.test(sql));
    expect(deleteCall).toBeDefined();
  });

  it('200 logout без refreshToken cookie: только revoke jti', async () => {
    // jti present → markTokenRevoked path
    const token = makeAuthToken({ jti: 'jti-1' });
    db.query.mockResolvedValue({ rows: [] }); // markTokenRevoked INSERT, etc

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', [`token=${token}`])
      .send({});

    expect(res.status).toBe(200);
  });
});

// ─── refresh success path ────────────────────────────────────────────────────
describe('POST /api/auth/refresh — coverage', () => {
  it('200 happy rotation: новый access + refresh token', async () => {
    // 1. DELETE FROM refresh_tokens WHERE id_hash=$1 RETURNING uid
    db.query.mockResolvedValueOnce({ rows: [{ uid: 'u1' }] });
    // 2. SELECT user (LEFT JOIN properties)
    db.query.mockResolvedValueOnce({
      rows: [{
        uid: 'u1', phone: VALID_PHONE, name: 'Test',
        role: 'owner', apartment: '10', avatar: null,
        property_slug: null, property_id: null,
      }],
    });
    // 3. INSERT new refresh_tokens row
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', ['refreshToken=some-raw-id']);

    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.uid).toBe('u1');
    expect(res.headers['set-cookie']).toBeDefined();
    expect(res.headers['set-cookie'].some((c) => /^token=/.test(c))).toBe(true);
    expect(res.headers['set-cookie'].some((c) => /^refreshToken=/.test(c))).toBe(true);
  });

  it('401 без refreshToken cookie', async () => {
    const res = await request(app).post('/api/auth/refresh');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/no refresh/i);
  });

  it('401 если refresh token не найден или истёк', async () => {
    // DELETE returns no rows (legacy fallback off — REFRESH_LEGACY_DEADLINE прошёл)
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', ['refreshToken=invalid-id']);

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid|expired/i);
  });

  it('404 если user удалён между refresh запросами', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ uid: 'u-deleted' }] });
    db.query.mockResolvedValueOnce({ rows: [] }); // user query empty

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', ['refreshToken=ok-id']);

    expect(res.status).toBe(404);
  });
});

// ─── /me success path ────────────────────────────────────────────────────────
describe('GET /api/auth/me — coverage', () => {
  function makeAuthToken({ uid = 'u1' } = {}) {
    return jwt.sign(
      { uid, role: 'owner', name: 'Test' },
      process.env.JWT_SECRET,
      { expiresIn: '15m' },
    );
  }

  it('200 returns user (LEFT JOIN with property_id)', async () => {
    const token = makeAuthToken();
    db.query.mockResolvedValueOnce({
      rows: [{
        uid: 'u1', phone: VALID_PHONE, name: 'Test',
        role: 'owner', apartment: '10', avatar: null,
        property_slug: 'zamoskvorechye', property_id: 'prop-uuid-1',
        property_type: 'cottage_community',
      }],
    });

    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', [`token=${token}`]);

    expect(res.status).toBe(200);
    expect(res.body.user.uid).toBe('u1');
    expect(res.body.user.property_id).toBe('prop-uuid-1');
    expect(res.body.user.property_slug).toBe('zamoskvorechye');
    expect(res.body.user.property_type).toBe('cottage_community');
  });

  it('200 resolves property_id from legacy properties projection', async () => {
    const token = makeAuthToken();
    db.query
      .mockResolvedValueOnce({
        rows: [{
          uid: 'u1', phone: VALID_PHONE, name: 'Test',
          role: 'owner', apartment: '10', avatar: null,
          property_slug: 'zamoskvorechye',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'legacy-prop-uuid', property_type: 'club_house' }],
      });

    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', [`token=${token}`]);

    expect(res.status).toBe(200);
    expect(res.body.user.property_id).toBe('legacy-prop-uuid');
    expect(res.body.user.property_type).toBe('club_house');
    expect(db.query.mock.calls[1][0]).toContain('FROM properties');
  });

  it('200 falls back to platform registry when legacy properties table is absent', async () => {
    const token = makeAuthToken();
    const missingTable = new Error('relation "properties" does not exist');
    missingTable.code = '42P01';
    const platformQuery = jest.fn().mockResolvedValue({
      rows: [{ id: 'platform-prop-uuid', property_type: 'cottage_community' }],
    });
    const prevPlatformUrl = process.env.PLATFORM_DB_URL;
    process.env.PLATFORM_DB_URL = 'postgres://platform-db';
    db.getPlatformDb = jest.fn(() => ({ query: platformQuery }));
    db.query
      .mockResolvedValueOnce({
        rows: [{
          uid: 'u1', phone: VALID_PHONE, name: 'Test',
          role: 'owner', apartment: '10', avatar: null,
          property_slug: 'zamoskvorechye',
        }],
      })
      .mockRejectedValueOnce(missingTable);

    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', [`token=${token}`]);

    if (prevPlatformUrl === undefined) delete process.env.PLATFORM_DB_URL;
    else process.env.PLATFORM_DB_URL = prevPlatformUrl;

    expect(res.status).toBe(200);
    expect(res.body.user.property_id).toBe('platform-prop-uuid');
    expect(res.body.user.property_type).toBe('cottage_community');
    expect(db.getPlatformDb).toHaveBeenCalledTimes(1);
    expect(platformQuery).toHaveBeenCalledWith(
      expect.stringContaining('FROM properties'),
      ['zamoskvorechye'],
    );
  });

  it('404 если user soft-deleted (rows.length === 0)', async () => {
    const token = makeAuthToken();
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', [`token=${token}`]);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('401 без token cookie', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('401 если token не валиден (signature mismatch)', async () => {
    const wrongToken = jwt.sign({ uid: 'u1' }, 'wrong-secret', { expiresIn: '15m' });
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', [`token=${wrongToken}`]);

    expect(res.status).toBe(401);
  });
});
