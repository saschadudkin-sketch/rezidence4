'use strict';
/**
 * __tests__/middleware_auth.test.js
 * Покрывает: requireAuth middleware — cookie, Bearer fallback, 401, истёкший токен
 */
const jwt        = require('jsonwebtoken');
jest.mock('../db');
const db = require('../db');
const mockRedisGet = jest.fn();
const mockRedisSetex = jest.fn();
const mockRedisDel = jest.fn();
jest.mock('../lib/redisClient', () => ({
  getRedis: () => ({
    get: mockRedisGet,
    setex: mockRedisSetex,
    del: mockRedisDel,
  }),
}));
const requireAuth = require('../middleware/auth');

process.env.JWT_SECRET = 'test-secret-key-16chars';

function makeReq({ cookie, bearer } = {}) {
  const req = {
    cookies: {},
    headers: {},
    user: null,
  };
  if (cookie) req.cookies.token = cookie;
  if (bearer) req.headers.authorization = `Bearer ${bearer}`;
  return req;
}

function makeRes() {
  const res = {
    _status: null,
    _body: null,
  };
  res.status = jest.fn((code) => { res._status = code; return res; });
  res.json   = jest.fn((body)  => { res._body  = body;  return res; });
  return res;
}

const validPayload = { uid: 'u1', role: 'owner', name: 'Test' };
const validToken   = jwt.sign(validPayload, 'test-secret-key-16chars', { expiresIn: '1h' });
const expiredToken = jwt.sign(validPayload, 'test-secret-key-16chars', { expiresIn: '-1s' });
const wrongSecret  = jwt.sign(validPayload, 'wrong-secret');

describe('requireAuth middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    requireAuth.__clearUserActiveFallbackCache?.();
    db.query.mockResolvedValue({ rows: [{ '?column?': 1 }] });
    mockRedisGet.mockResolvedValue(null);
    mockRedisSetex.mockResolvedValue('OK');
    mockRedisDel.mockResolvedValue(1);
  });

  test('401 если нет ни cookie ни Bearer', async () => {
    const req  = makeReq();
    const res  = makeRes();
    const next = jest.fn();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res._body.error).toBe('No token');
    expect(next).not.toHaveBeenCalled();
  });

  test('200 и next() при валидном cookie token', async () => {
    const req  = makeReq({ cookie: validToken });
    const res  = makeRes();
    const next = jest.fn();

    await requireAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user.uid).toBe('u1');
    expect(req.user.role).toBe('owner');
    expect(res.status).not.toHaveBeenCalled();
  });

  test('200 и next() при валидном Bearer token (fallback)', async () => {
    const req  = makeReq({ bearer: validToken });
    const res  = makeRes();
    const next = jest.fn();

    await requireAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user.uid).toBe('u1');
  });

  test('cookie имеет приоритет над Bearer', async () => {
    const cookiePayload = { uid: 'cookie-user', role: 'admin' };
    const cookieToken   = jwt.sign(cookiePayload, 'test-secret-key-16chars');
    const req  = makeReq({ cookie: cookieToken, bearer: validToken });
    const res  = makeRes();
    const next = jest.fn();

    await requireAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user.uid).toBe('cookie-user'); // cookie имеет приоритет
  });

  test('401 при истёкшем токене', async () => {
    const req  = makeReq({ cookie: expiredToken });
    const res  = makeRes();
    const next = jest.fn();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res._body.error).toBe('Invalid or expired token');
    expect(next).not.toHaveBeenCalled();
  });

  test('401 при токене с неверным секретом', async () => {
    const req  = makeReq({ cookie: wrongSecret });
    const res  = makeRes();
    const next = jest.fn();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res._body.error).toBe('Invalid or expired token');
    expect(next).not.toHaveBeenCalled();
  });

  test('401 при мусорном токене', async () => {
    const req  = makeReq({ cookie: 'not.a.jwt' });
    const res  = makeRes();
    const next = jest.fn();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('401 при пустой строке Authorization', async () => {
    const req  = { cookies: {}, headers: { authorization: '' }, user: null };
    const res  = makeRes();
    const next = jest.fn();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('401 при Authorization без Bearer prefix', async () => {
    const req  = { cookies: {}, headers: { authorization: validToken }, user: null };
    const res  = makeRes();
    const next = jest.fn();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('req.user содержит все поля из payload', async () => {
    const payload = { uid: 'u99', role: 'admin', name: 'Адм' };
    const token   = jwt.sign(payload, 'test-secret-key-16chars');
    const req     = makeReq({ cookie: token });
    const res     = makeRes();
    const next    = jest.fn();

    await requireAuth(req, res, next);

    expect(req.user.uid).toBe('u99');
    expect(req.user.role).toBe('admin');
    expect(req.user.name).toBe('Адм');
  });

  test('401 если пользователь soft-deleted', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }); // uid not found among active users
    const req = makeReq({ cookie: validToken });
    const res = makeRes();
    const next = jest.fn();

    await requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res._body.error).toBe('User not found or deleted');
  });

  test('использует Redis cache hit для active-user без DB запроса users', async () => {
    const req  = makeReq({ cookie: validToken });
    const res  = makeRes();
    const next = jest.fn();

    mockRedisGet.mockResolvedValueOnce('1');
    await requireAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const userLookupCall = db.query.mock.calls.find(([sql]) => String(sql).includes('FROM users'));
    expect(userLookupCall).toBeUndefined();
  });

  test('graceful fallback: Redis read error -> DB lookup -> next()', async () => {
    const req  = makeReq({ cookie: validToken });
    const res  = makeRes();
    const next = jest.fn();

    mockRedisGet.mockRejectedValueOnce(new Error('redis down'));
    await requireAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const userLookupCall = db.query.mock.calls.find(([sql]) => String(sql).includes('FROM users'));
    expect(userLookupCall).toBeDefined();
  });
});
