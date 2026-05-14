'use strict';

const jwt = require('jsonwebtoken');

jest.mock('../logger', () => ({
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const mockPlatformQuery = jest.fn();
jest.mock('../db', () => ({
  getPlatformDb: () => ({ query: mockPlatformQuery }),
}));

const platformAuth = require('../middleware/platformAuth');

function makeReq(token) {
  return {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  };
}

function makeRes() {
  const res = { _status: null, _body: null };
  res.status = jest.fn((code) => { res._status = code; return res; });
  res.json = jest.fn((body) => { res._body = body; return res; });
  return res;
}

describe('platformAuth', () => {
  const originalSecret = process.env.PLATFORM_JWT_SECRET;

  beforeEach(() => {
    process.env.PLATFORM_JWT_SECRET = 'platform-secret-16chars';
    jest.clearAllMocks();
  });

  afterAll(() => {
    if (originalSecret === undefined) delete process.env.PLATFORM_JWT_SECRET;
    else process.env.PLATFORM_JWT_SECRET = originalSecret;
  });

  test('rejects a token after the platform admin is deactivated', async () => {
    const token = jwt.sign(
      { aud: 'platform', id: 'admin-1', email: 'root@example.com', name: 'Root' },
      process.env.PLATFORM_JWT_SECRET,
      { algorithm: 'HS256' },
    );
    mockPlatformQuery.mockResolvedValueOnce({
      rows: [{ id: 'admin-1', email: 'root@example.com', name: 'Root', is_active: false }],
    });
    const req = makeReq(token);
    const res = makeRes();
    const next = jest.fn();

    await platformAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res._body.error.code).toBe('UNAUTHORIZED');
  });

  test('loads active admin state on every valid token request', async () => {
    const token = jwt.sign(
      { aud: 'platform', id: 'admin-1', email: 'root@example.com', name: 'Token Name' },
      process.env.PLATFORM_JWT_SECRET,
      { algorithm: 'HS256' },
    );
    mockPlatformQuery
      .mockResolvedValueOnce({
        rows: [{ id: 'admin-1', email: 'root@example.com', name: 'DB Name', is_active: true }],
      })
      .mockResolvedValueOnce({ rows: [] });
    const req = makeReq(token);
    const res = makeRes();
    const next = jest.fn();

    await platformAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.platformAdmin).toEqual({ id: 'admin-1', email: 'root@example.com', name: 'DB Name' });
    expect(mockPlatformQuery.mock.calls[0][0]).toContain('FROM platform_admins');
    expect(mockPlatformQuery.mock.calls[1][0]).toContain('UPDATE platform_admins SET last_login_at');
  });
});
