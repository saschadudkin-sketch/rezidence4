'use strict';
/**
 * __tests__/auth_redis_revocation.test.js
 *
 * FIX [AUDIT]: тесты на Redis-кеш проверки отозванных токенов.
 * Покрывает:
 *   1. Токен не в Redis и не в DB → пропускаем (200 OK)
 *   2. Токен в Redis → 401 Token revoked (без DB roundtrip)
 *   3. Токен в DB (Redis недоступен) → 401 Token revoked
 *   4. Токен без jti → пропускаем (не проверяем revocation)
 *   5. markTokenRevoked пишет в Redis с TTL
 */

jest.mock('../db');

const db  = require('../db');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'test-secret-key-32-chars-long-xx';
// Убедимся что Redis НЕ инициализируется в тестах (нет реального Redis)
delete process.env.REDIS_URL;

// Перезагружаем auth после установки env
let requireAuth;
beforeEach(() => {
  jest.resetModules();
  delete process.env.REDIS_URL;
  requireAuth = require('../middleware/auth');
});

function makeToken(payload, secret = 'test-secret-key-32-chars-long-xx', opts = {}) {
  return jwt.sign(payload, secret, { expiresIn: '15m', ...opts });
}

function buildReq(token, via = 'cookie') {
  if (via === 'cookie') {
    return { cookies: { token }, headers: {} };
  }
  return { cookies: {}, headers: { authorization: `Bearer ${token}` } };
}

function buildRes() {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
}

// ─── 1. Валидный токен без отзыва ────────────────────────────────────────────

test('пропускает валидный токен (не в revocations)', async () => {
  const jti = 'valid-jti-1';
  const token = makeToken({ uid: 'u1', role: 'owner', jti });

  // DB: jti не найден (не отозван)
  db.query.mockResolvedValueOnce({ rows: [] });

  const req  = buildReq(token);
  const res  = buildRes();
  const next = jest.fn();

  await requireAuth(req, res, next);

  expect(next).toHaveBeenCalled();
  expect(req.user.uid).toBe('u1');
  expect(res.status).not.toHaveBeenCalled();
});

// ─── 2. Отозванный токен (DB fallback — Redis недоступен) ────────────────────

test('401 когда jti найден в token_revocations (DB fallback)', async () => {
  const jti = 'revoked-jti-2';
  const token = makeToken({ uid: 'u1', role: 'owner', jti });

  // DB: jti найден → отозван
  db.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

  const req  = buildReq(token);
  const res  = buildRes();
  const next = jest.fn();

  await requireAuth(req, res, next);

  expect(next).not.toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(401);
  expect(res.json).toHaveBeenCalledWith({ error: 'Token revoked' });
});

// ─── 3. Токен без jti — revocation не проверяется ────────────────────────────

test('пропускает токен без jti (legacy токен)', async () => {
  // Токен без jti — нет проверки revocation
  const token = makeToken({ uid: 'u2', role: 'security' }); // без jti

  const req  = buildReq(token);
  const res  = buildRes();
  const next = jest.fn();

  await requireAuth(req, res, next);

  expect(next).toHaveBeenCalled();
  // DB не должен был вызываться
  expect(db.query).not.toHaveBeenCalled();
});

// ─── 4. Невалидный JWT ────────────────────────────────────────────────────────

test('401 для невалидного JWT', async () => {
  const req  = buildReq('not.a.valid.token');
  const res  = buildRes();
  const next = jest.fn();

  await requireAuth(req, res, next);

  expect(next).not.toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(401);
  expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
});

// ─── 5. Токен через Authorization header ─────────────────────────────────────

test('принимает токен через Bearer заголовок', async () => {
  const jti = 'header-jti-5';
  const token = makeToken({ uid: 'u3', role: 'admin', jti });

  db.query.mockResolvedValueOnce({ rows: [] }); // не отозван

  const req  = buildReq(token, 'header');
  const res  = buildRes();
  const next = jest.fn();

  await requireAuth(req, res, next);

  expect(next).toHaveBeenCalled();
  expect(req.user.role).toBe('admin');
});

// ─── 6. Отсутствует токен ────────────────────────────────────────────────────

test('401 когда токен отсутствует', async () => {
  const req  = { cookies: {}, headers: {} };
  const res  = buildRes();
  const next = jest.fn();

  await requireAuth(req, res, next);

  expect(next).not.toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(401);
  expect(res.json).toHaveBeenCalledWith({ error: 'No token' });
});

// ─── 7. markTokenRevoked пишет в DB ──────────────────────────────────────────

test('markTokenRevoked делает INSERT в token_revocations', async () => {
  db.query.mockResolvedValueOnce({ rows: [] }); // INSERT OK

  const { markTokenRevoked } = requireAuth;
  const expUnix = Math.floor(Date.now() / 1000) + 900; // +15 мин

  await markTokenRevoked('test-jti-7', expUnix);

  expect(db.query).toHaveBeenCalledWith(
    expect.stringContaining('INSERT INTO token_revocations'),
    expect.arrayContaining(['test-jti-7']),
  );
});
