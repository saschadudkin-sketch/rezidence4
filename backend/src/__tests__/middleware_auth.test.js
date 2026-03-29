'use strict';
/**
 * __tests__/middleware_auth.test.js
 * Покрывает: requireAuth middleware — cookie, Bearer fallback, 401, истёкший токен
 */
const jwt        = require('jsonwebtoken');
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
  test('401 если нет ни cookie ни Bearer', () => {
    const req  = makeReq();
    const res  = makeRes();
    const next = jest.fn();

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res._body.error).toBe('No token');
    expect(next).not.toHaveBeenCalled();
  });

  test('200 и next() при валидном cookie token', () => {
    const req  = makeReq({ cookie: validToken });
    const res  = makeRes();
    const next = jest.fn();

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user.uid).toBe('u1');
    expect(req.user.role).toBe('owner');
    expect(res.status).not.toHaveBeenCalled();
  });

  test('200 и next() при валидном Bearer token (fallback)', () => {
    const req  = makeReq({ bearer: validToken });
    const res  = makeRes();
    const next = jest.fn();

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user.uid).toBe('u1');
  });

  test('cookie имеет приоритет над Bearer', () => {
    const cookiePayload = { uid: 'cookie-user', role: 'admin' };
    const cookieToken   = jwt.sign(cookiePayload, 'test-secret-key-16chars');
    const req  = makeReq({ cookie: cookieToken, bearer: validToken });
    const res  = makeRes();
    const next = jest.fn();

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user.uid).toBe('cookie-user'); // cookie имеет приоритет
  });

  test('401 при истёкшем токене', () => {
    const req  = makeReq({ cookie: expiredToken });
    const res  = makeRes();
    const next = jest.fn();

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res._body.error).toBe('Invalid or expired token');
    expect(next).not.toHaveBeenCalled();
  });

  test('401 при токене с неверным секретом', () => {
    const req  = makeReq({ cookie: wrongSecret });
    const res  = makeRes();
    const next = jest.fn();

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res._body.error).toBe('Invalid or expired token');
    expect(next).not.toHaveBeenCalled();
  });

  test('401 при мусорном токене', () => {
    const req  = makeReq({ cookie: 'not.a.jwt' });
    const res  = makeRes();
    const next = jest.fn();

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('401 при пустой строке Authorization', () => {
    const req  = { cookies: {}, headers: { authorization: '' }, user: null };
    const res  = makeRes();
    const next = jest.fn();

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('401 при Authorization без Bearer prefix', () => {
    const req  = { cookies: {}, headers: { authorization: validToken }, user: null };
    const res  = makeRes();
    const next = jest.fn();

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('req.user содержит все поля из payload', () => {
    const payload = { uid: 'u99', role: 'admin', name: 'Адм', iat: undefined };
    const token   = jwt.sign(payload, 'test-secret-key-16chars');
    const req     = makeReq({ cookie: token });
    const res     = makeRes();
    const next    = jest.fn();

    requireAuth(req, res, next);

    expect(req.user.uid).toBe('u99');
    expect(req.user.role).toBe('admin');
    expect(req.user.name).toBe('Адм');
  });
});
