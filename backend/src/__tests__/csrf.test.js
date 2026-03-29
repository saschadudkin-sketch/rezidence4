'use strict';
/**
 * __tests__/csrf.test.js — тесты CSRF middleware
 */

const { setCsrfCookie, verifyCsrf, COOKIE_NAME, HEADER_NAME } = require('../middleware/csrf');

function mockReq(method, path, cookies = {}, headers = {}) {
  return { method, path, cookies, headers };
}

function mockRes() {
  const res = {
    statusCode: 200,
    _cookies: {},
    _json: null,
    cookie(name, value, opts) { res._cookies[name] = { value, opts }; },
    status(code) { res.statusCode = code; return res; },
    json(data) { res._json = data; return res; },
  };
  return res;
}

describe('setCsrfCookie', () => {
  it('sets cookie if not present', () => {
    const req = mockReq('GET', '/api/test', {});
    const res = mockRes();
    const next = jest.fn();
    setCsrfCookie(req, res, next);
    expect(res._cookies[COOKIE_NAME]).toBeDefined();
    expect(res._cookies[COOKIE_NAME].value).toHaveLength(64); // 32 bytes hex
    expect(res._cookies[COOKIE_NAME].opts.httpOnly).toBe(false);
    expect(next).toHaveBeenCalled();
  });

  it('does not overwrite existing cookie', () => {
    const req = mockReq('GET', '/api/test', { [COOKIE_NAME]: 'existing' });
    const res = mockRes();
    const next = jest.fn();
    setCsrfCookie(req, res, next);
    expect(res._cookies[COOKIE_NAME]).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });
});

describe('verifyCsrf', () => {
  it('skips GET requests', () => {
    const req = mockReq('GET', '/api/test');
    const res = mockRes();
    const next = jest.fn();
    verifyCsrf(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('skips exempt paths (client-logs)', () => {
    const req = mockReq('POST', '/api/v1/client-logs', {}, {});
    const res = mockRes();
    const next = jest.fn();
    verifyCsrf(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('rejects POST without CSRF token', () => {
    const req = mockReq('POST', '/api/requests', {}, {});
    const res = mockRes();
    const next = jest.fn();
    verifyCsrf(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(res._json.error).toMatch(/CSRF/);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects POST with mismatched tokens', () => {
    const req = mockReq('POST', '/api/requests',
      { [COOKIE_NAME]: 'token_a' },
      { [HEADER_NAME]: 'token_b' },
    );
    const res = mockRes();
    const next = jest.fn();
    verifyCsrf(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('allows POST with matching tokens', () => {
    const token = 'valid_csrf_token_123';
    const req = mockReq('POST', '/api/requests',
      { [COOKIE_NAME]: token },
      { [HEADER_NAME]: token },
    );
    const res = mockRes();
    const next = jest.fn();
    verifyCsrf(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it('allows PATCH with matching tokens', () => {
    const token = 'valid_token';
    const req = mockReq('PATCH', '/api/requests/123',
      { [COOKIE_NAME]: token },
      { [HEADER_NAME]: token },
    );
    const res = mockRes();
    const next = jest.fn();
    verifyCsrf(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
