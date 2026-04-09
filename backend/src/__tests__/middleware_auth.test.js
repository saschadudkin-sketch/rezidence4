'use strict';
/**
 * Covers requireAuth middleware: cookie, Bearer fallback, 401 paths, expired token,
 * Redis fallback behavior, and throttled warning noise.
 */
const jwt = require('jsonwebtoken');

jest.mock('../db');
const db = require('../db');

jest.mock('../logger', () => ({
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));
const logger = require('../logger');

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
  res.status = jest.fn((code) => {
    res._status = code;
    return res;
  });
  res.json = jest.fn((body) => {
    res._body = body;
    return res;
  });
  return res;
}

const validPayload = { uid: 'u1', role: 'owner', name: 'Test' };
const validToken = jwt.sign(validPayload, 'test-secret-key-16chars', { expiresIn: '1h' });
const expiredToken = jwt.sign(validPayload, 'test-secret-key-16chars', { expiresIn: '-1s' });
const wrongSecret = jwt.sign(validPayload, 'wrong-secret');

describe('requireAuth middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    requireAuth.__clearUserActiveFallbackCache?.();
    requireAuth.__clearRedisWarnThrottle?.();
    db.query.mockResolvedValue({ rows: [{ '?column?': 1 }] });
    mockRedisGet.mockResolvedValue(null);
    mockRedisSetex.mockResolvedValue('OK');
    mockRedisDel.mockResolvedValue(1);
  });

  test('401 when neither cookie nor Bearer token exists', async () => {
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res._body.error).toBe('No token');
    expect(next).not.toHaveBeenCalled();
  });

  test('calls next for a valid cookie token', async () => {
    const req = makeReq({ cookie: validToken });
    const res = makeRes();
    const next = jest.fn();

    await requireAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user.uid).toBe('u1');
    expect(req.user.role).toBe('owner');
    expect(res.status).not.toHaveBeenCalled();
  });

  test('calls next for a valid Bearer token', async () => {
    const req = makeReq({ bearer: validToken });
    const res = makeRes();
    const next = jest.fn();

    await requireAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user.uid).toBe('u1');
  });

  test('cookie has priority over Bearer token', async () => {
    const cookiePayload = { uid: 'cookie-user', role: 'admin' };
    const cookieToken = jwt.sign(cookiePayload, 'test-secret-key-16chars');
    const req = makeReq({ cookie: cookieToken, bearer: validToken });
    const res = makeRes();
    const next = jest.fn();

    await requireAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user.uid).toBe('cookie-user');
  });

  test('401 for expired token', async () => {
    const req = makeReq({ cookie: expiredToken });
    const res = makeRes();
    const next = jest.fn();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res._body.error).toBe('Invalid or expired token');
    expect(next).not.toHaveBeenCalled();
  });

  test('401 for token with wrong secret', async () => {
    const req = makeReq({ cookie: wrongSecret });
    const res = makeRes();
    const next = jest.fn();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res._body.error).toBe('Invalid or expired token');
    expect(next).not.toHaveBeenCalled();
  });

  test('401 for malformed token', async () => {
    const req = makeReq({ cookie: 'not.a.jwt' });
    const res = makeRes();
    const next = jest.fn();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('401 for empty Authorization header', async () => {
    const req = { cookies: {}, headers: { authorization: '' }, user: null };
    const res = makeRes();
    const next = jest.fn();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('401 for Authorization without Bearer prefix', async () => {
    const req = { cookies: {}, headers: { authorization: validToken }, user: null };
    const res = makeRes();
    const next = jest.fn();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('copies payload fields to req.user', async () => {
    const payload = { uid: 'u99', role: 'admin', name: 'Admin' };
    const token = jwt.sign(payload, 'test-secret-key-16chars');
    const req = makeReq({ cookie: token });
    const res = makeRes();
    const next = jest.fn();

    await requireAuth(req, res, next);

    expect(req.user.uid).toBe('u99');
    expect(req.user.role).toBe('admin');
    expect(req.user.name).toBe('Admin');
  });

  test('401 for soft-deleted user', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const req = makeReq({ cookie: validToken });
    const res = makeRes();
    const next = jest.fn();

    await requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res._body.error).toBe('User not found or deleted');
  });

  test('uses Redis active-user cache hit without users DB lookup', async () => {
    const req = makeReq({ cookie: validToken });
    const res = makeRes();
    const next = jest.fn();

    mockRedisGet.mockResolvedValueOnce('1');
    await requireAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const userLookupCall = db.query.mock.calls.find(([sql]) => String(sql).includes('FROM users'));
    expect(userLookupCall).toBeUndefined();
  });

  test('falls back from Redis read error to DB lookup and logs once', async () => {
    const req = makeReq({ cookie: validToken });
    const res = makeRes();
    const next = jest.fn();

    mockRedisGet.mockRejectedValueOnce(new Error('redis down'));
    await requireAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const userLookupCall = db.query.mock.calls.find(([sql]) => String(sql).includes('FROM users'));
    expect(userLookupCall).toBeDefined();
  });

  test('local fallback cache suppresses repeated DB/Redis pressure during short Redis outage', async () => {
    const req1 = makeReq({ cookie: validToken });
    const req2 = makeReq({ cookie: validToken });
    const res1 = makeRes();
    const res2 = makeRes();
    const next1 = jest.fn();
    const next2 = jest.fn();

    mockRedisGet.mockRejectedValueOnce(new Error('redis down'));

    await requireAuth(req1, res1, next1);
    await requireAuth(req2, res2, next2);

    expect(next1).toHaveBeenCalledTimes(1);
    expect(next2).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const userLookupCalls = db.query.mock.calls.filter(([sql]) => String(sql).includes('FROM users'));
    expect(userLookupCalls).toHaveLength(1);
  });
});
