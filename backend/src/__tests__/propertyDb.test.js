'use strict';

const mockPlatformQuery = jest.fn();
const mockPoolInstance = { on: jest.fn(), query: jest.fn(), end: jest.fn().mockResolvedValue(undefined) };

jest.mock('pg', () => ({
  Pool: jest.fn(() => mockPoolInstance),
}));

jest.mock('../db', () => ({
  getPlatformDb: () => ({ query: mockPlatformQuery }),
}));

jest.mock('../logger', () => ({
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  child: jest.fn((ctx) => ({ ctx })),
}));

const {
  propertyDbMiddleware,
  resolveProperty,
  getPropertyPool,
  closeAllPools,
  _cache,
  _hostnameCache,
} = require('../middleware/propertyDb');

function makeRes() {
  const res = { _status: null, _body: null };
  res.status = jest.fn((code) => { res._status = code; return res; });
  res.json = jest.fn((body) => { res._body = body; return res; });
  return res;
}

describe('propertyDb tenant resolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _cache.clear();
    _hostnameCache.clear();
  });

  afterAll(async () => {
    await closeAllPools();
  });

  test('resolves active property from X-Property-Slug and attaches req.db', async () => {
    mockPlatformQuery.mockResolvedValueOnce({
      rows: [{
        id: 'prop-1',
        slug: 'alpha',
        hostname: null,
        is_active: true,
        db_connection_url: 'postgres://alpha',
        feature_flags: {},
        plan: 'operations',
      }],
    });
    const req = { headers: { 'x-property-slug': 'alpha' }, cookies: {}, path: '/requests' };
    const res = makeRes();
    const next = jest.fn();

    await propertyDbMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.propertySlug).toBe('alpha');
    expect(req.db).toBe(mockPoolInstance);
  });

  test('rejects mismatched hostname/header tenant and JWT tenant as cross-tenant', async () => {
    const jwt = require('jsonwebtoken');
    const token = jwt.sign({ uid: 'u1', property_slug: 'beta' }, 'unused');
    mockPlatformQuery.mockResolvedValueOnce({
      rows: [{
        slug: 'alpha',
        hostname: 'alpha.example.test',
        is_active: true,
        db_connection_url: 'postgres://alpha',
      }],
    });

    const result = await resolveProperty({
      headers: { host: 'alpha.example.test', authorization: `Bearer ${token}` },
      cookies: {},
      path: '/requests',
    });

    expect(result.error).toBe('cross_tenant');
  });

  test('does not attach a pool when active property has no db_connection_url', async () => {
    mockPlatformQuery.mockResolvedValueOnce({
      rows: [{
        id: 'prop-1',
        slug: 'alpha',
        hostname: null,
        is_active: true,
        db_connection_url: null,
        feature_flags: {},
        plan: 'operations',
      }],
    });
    const req = { headers: { 'x-property-slug': 'alpha' }, cookies: {}, path: '/requests' };
    const res = makeRes();
    const next = jest.fn();

    await propertyDbMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Property database unavailable',
      message: "Property 'alpha' database is not configured",
    });
    expect(next).not.toHaveBeenCalled();
    expect(req.db).toBeUndefined();
  });

  test('getPropertyPool requires explicit slug and db_connection_url', () => {
    expect(() => getPropertyPool(null)).toThrow(/property\.slug required/);
    expect(() => getPropertyPool({ slug: 'alpha', db_connection_url: '' })).toThrow(/db_connection_url required/);
  });
});
