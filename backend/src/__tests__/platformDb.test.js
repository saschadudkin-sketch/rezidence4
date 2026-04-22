'use strict';

const { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } = require('@jest/globals');
const { Pool } = require('pg');
const {
  propertyDbMiddleware,
  extractPropertySlug,
  extractHostname,
  extractHeaderSlug,
  extractJwtSlug,
  getProperty,
  getPropertyByHostname,
  resolveProperty,
  closeAllPools,
  _pools,
  _cache,
  _hostnameCache,
} = require('../middleware/propertyDb');
const { getPlatformDb } = require('../db');

// Mock dependencies
jest.mock('../db', () => ({
  getPlatformDb: jest.fn(),
  query: jest.fn(),
  pool: { on: jest.fn() },
}));
jest.mock('../logger', () => {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
  };
  logger.child = jest.fn(() => logger);
  return logger;
});
jest.mock('../config/featureFlags', () => ({
  resolveFlags: jest.fn(() => ({})),
}));

describe('Property Database Middleware', () => {
  let mockPlatformDb;
  let mockReq;
  let mockRes;
  let mockNext;

  beforeAll(() => {
    // Set up environment
    process.env.PLATFORM_DB_URL = 'postgresql://test:test@localhost/platform_test';
  });

  beforeEach(() => {
    // Clear caches
    _pools.clear();
    _cache.clear();
    _hostnameCache.clear();

    // Mock platform DB
    mockPlatformDb = {
      query: jest.fn(),
      connect: jest.fn(),
    };
    getPlatformDb.mockReturnValue(mockPlatformDb);

    // Mock request/response
    mockReq = {
      headers: {},
      log: { child: jest.fn().mockReturnThis() },
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    mockNext = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await closeAllPools();
  });

  describe('extractPropertySlug', () => {
    test('should extract slug from X-Property-Slug header', () => {
      mockReq.headers['x-property-slug'] = 'test-property';
      expect(extractPropertySlug(mockReq)).toBe('test-property');
    });

    test('should extract slug from JWT token', () => {
      const jwt = require('jsonwebtoken');
      const token = jwt.sign({ property_slug: 'jwt-property' }, 'test-secret');
      mockReq.headers.authorization = `Bearer ${token}`;

      expect(extractPropertySlug(mockReq)).toBe('jwt-property');
    });

    test('should prefer header over JWT', () => {
      const jwt = require('jsonwebtoken');
      const token = jwt.sign({ property_slug: 'jwt-property' }, 'test-secret');
      mockReq.headers['x-property-slug'] = 'header-property';
      mockReq.headers.authorization = `Bearer ${token}`;

      expect(extractPropertySlug(mockReq)).toBe('header-property');
    });

    test('should return null if no slug found', () => {
      expect(extractPropertySlug(mockReq)).toBeNull();
    });

    test('should handle invalid JWT gracefully', () => {
      mockReq.headers.authorization = 'Bearer invalid-token';
      expect(extractPropertySlug(mockReq)).toBeNull();
    });
  });

  describe('getProperty', () => {
    const mockProperty = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      slug: 'test-property',
      name: 'Test Property',
      db_connection_url: 'postgresql://test:test@localhost/test_property',
      is_active: true,
    };

    test('should fetch property from database', async () => {
      mockPlatformDb.query.mockResolvedValue({ rows: [mockProperty] });

      const result = await getProperty('test-property');

      expect(result).toEqual(mockProperty);
      expect(mockPlatformDb.query).toHaveBeenCalledWith(
        'SELECT * FROM properties WHERE slug = $1',
        ['test-property']
      );
    });

    test('should cache property results', async () => {
      mockPlatformDb.query.mockResolvedValue({ rows: [mockProperty] });

      // First call
      await getProperty('test-property');
      // Second call should use cache
      await getProperty('test-property');

      expect(mockPlatformDb.query).toHaveBeenCalledTimes(1);
    });

    test('should cache null results', async () => {
      mockPlatformDb.query.mockResolvedValue({ rows: [] });

      // First call
      const result1 = await getProperty('nonexistent');
      // Second call should use cache
      const result2 = await getProperty('nonexistent');

      expect(result1).toBeNull();
      expect(result2).toBeNull();
      expect(mockPlatformDb.query).toHaveBeenCalledTimes(1);
    });

    test('should return null for database errors', async () => {
      mockPlatformDb.query.mockRejectedValue(new Error('Database error'));

      const result = await getProperty('test-property');

      expect(result).toBeNull();
    });

    test('should return null for empty slug', async () => {
      const result = await getProperty('');
      expect(result).toBeNull();
      expect(mockPlatformDb.query).not.toHaveBeenCalled();
    });
  });

  describe('propertyDbMiddleware', () => {
    const mockProperty = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      slug: 'test-property',
      name: 'Test Property',
      db_connection_url: 'postgresql://test:test@localhost/test_property',
      is_active: true,
    };

    test('should return 400 if no property slug provided', async () => {
      await propertyDbMiddleware(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Property context required',
        message: 'Request must include X-Property-Slug header or valid JWT with property_slug claim'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    test('should return 404 if property not found', async () => {
      mockReq.headers['x-property-slug'] = 'nonexistent';
      mockPlatformDb.query.mockResolvedValue({ rows: [] });

      await propertyDbMiddleware(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Property not found',
        message: "Property 'nonexistent' does not exist"
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    test('should return 503 if property is inactive', async () => {
      const inactiveProperty = { ...mockProperty, is_active: false };
      mockReq.headers['x-property-slug'] = 'test-property';
      mockPlatformDb.query.mockResolvedValue({ rows: [inactiveProperty] });

      await propertyDbMiddleware(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(503);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Property unavailable',
        message: "Property 'test-property' is temporarily unavailable"
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    test('should attach property and database pool to request', async () => {
      mockReq.headers['x-property-slug'] = 'test-property';
      mockPlatformDb.query.mockResolvedValue({ rows: [mockProperty] });

      await propertyDbMiddleware(mockReq, mockRes, mockNext);

      expect(mockReq.propertySlug).toBe('test-property');
      expect(mockReq.property).toEqual(mockProperty);
      expect(mockReq.db).toBeInstanceOf(Pool);
      expect(mockNext).toHaveBeenCalled();
    });

    test('should handle database errors gracefully', async () => {
      // Contract: getProperty() swallows DB errors and returns null, so the
      // middleware surfaces the failure as a 404 "property not found". This
      // matches the cache-behavior tests above.
      mockReq.headers['x-property-slug'] = 'nonexistent-after-db-error';
      mockPlatformDb.query.mockRejectedValue(new Error('Database connection failed'));

      await propertyDbMiddleware(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockNext).not.toHaveBeenCalled();
    });

    test('should reuse existing connection pools', async () => {
      mockReq.headers['x-property-slug'] = 'test-property';
      mockPlatformDb.query.mockResolvedValue({ rows: [mockProperty] });

      // First request
      await propertyDbMiddleware(mockReq, mockRes, mockNext);
      const firstPool = mockReq.db;

      mockReq = { ...mockReq, headers: { 'x-property-slug': 'test-property' } };

      // Second request
      await propertyDbMiddleware(mockReq, mockRes, mockNext);
      const secondPool = mockReq.db;

      expect(firstPool).toBe(secondPool);
      expect(mockNext).toHaveBeenCalledTimes(2);
    });
  });

  describe('extractHostname', () => {
    test('strips port and lowercases', () => {
      expect(extractHostname({ headers: { host: 'ZAMOSKV.DomHub.SU:8443' } })).toBe('zamoskv.domhub.su');
    });

    test('returns null for missing host', () => {
      expect(extractHostname({ headers: {} })).toBeNull();
    });

    test('returns null for empty host', () => {
      expect(extractHostname({ headers: { host: '' } })).toBeNull();
    });
  });

  describe('extractHeaderSlug', () => {
    test('reads and lowercases X-Property-Slug', () => {
      expect(extractHeaderSlug({ headers: { 'x-property-slug': 'Zamoskv' } })).toBe('zamoskv');
    });

    test('returns null when header missing', () => {
      expect(extractHeaderSlug({ headers: {} })).toBeNull();
    });
  });

  describe('extractJwtSlug', () => {
    const jwt = require('jsonwebtoken');

    test('reads property_slug from Bearer authorization header', () => {
      const token = jwt.sign({ property_slug: 'zamoskv', uid: 'u1' }, 'test-secret');
      expect(extractJwtSlug({ headers: { authorization: `Bearer ${token}` } })).toBe('zamoskv');
    });

    test('reads property_slug from token cookie', () => {
      const token = jwt.sign({ property_slug: 'zamoskv', uid: 'u1' }, 'test-secret');
      expect(extractJwtSlug({ headers: {}, cookies: { token } })).toBe('zamoskv');
    });

    test('returns null for JWT without claim', () => {
      const token = jwt.sign({ uid: 'u1' }, 'test-secret');
      expect(extractJwtSlug({ headers: { authorization: `Bearer ${token}` } })).toBeNull();
    });

    test('returns null for malformed token', () => {
      expect(extractJwtSlug({ headers: { authorization: 'Bearer not-a-jwt' } })).toBeNull();
    });
  });

  describe('getPropertyByHostname', () => {
    const mockProperty = {
      id: 'abc',
      slug: 'zamoskv',
      hostname: 'zamoskv.domhub.su',
      db_connection_url: 'postgresql://test',
      is_active: true,
    };

    test('queries the hostname column', async () => {
      mockPlatformDb.query.mockResolvedValue({ rows: [mockProperty] });
      const result = await getPropertyByHostname('zamoskv.domhub.su');
      expect(result).toEqual(mockProperty);
      expect(mockPlatformDb.query).toHaveBeenCalledWith(
        'SELECT * FROM properties WHERE hostname = $1',
        ['zamoskv.domhub.su'],
      );
    });

    test('caches successful lookups', async () => {
      mockPlatformDb.query.mockResolvedValue({ rows: [mockProperty] });
      await getPropertyByHostname('zamoskv.domhub.su');
      await getPropertyByHostname('zamoskv.domhub.su');
      expect(mockPlatformDb.query).toHaveBeenCalledTimes(1);
    });

    test('mirrors into slug cache so subsequent getProperty is free', async () => {
      mockPlatformDb.query.mockResolvedValue({ rows: [mockProperty] });
      await getPropertyByHostname('zamoskv.domhub.su');
      // Next call through getProperty('zamoskv') should not hit the DB.
      const slugResult = await getProperty('zamoskv');
      expect(slugResult).toEqual(mockProperty);
      expect(mockPlatformDb.query).toHaveBeenCalledTimes(1);
    });

    test('returns null for unknown hostname', async () => {
      mockPlatformDb.query.mockResolvedValue({ rows: [] });
      expect(await getPropertyByHostname('unknown.example.com')).toBeNull();
    });
  });

  describe('resolveProperty (hybrid resolver)', () => {
    const zamoskv = {
      id: 'zam', slug: 'zamoskv', hostname: 'zamoskv.domhub.su',
      db_connection_url: 'postgresql://zam', is_active: true,
    };
    const arbat = {
      id: 'arb', slug: 'arbat', hostname: 'arbat.domhub.su',
      db_connection_url: 'postgresql://arb', is_active: true,
    };

    test('resolves via hostname when Host header matches a property', async () => {
      mockPlatformDb.query.mockImplementation((_sql, params) => {
        if (params[0] === 'zamoskv.domhub.su') return Promise.resolve({ rows: [zamoskv] });
        return Promise.resolve({ rows: [] });
      });

      const req = { headers: { host: 'zamoskv.domhub.su' } };
      const ctx = await resolveProperty(req);

      expect(ctx.error).toBeNull();
      expect(ctx.resolvedBy).toBe('hostname');
      expect(ctx.property).toEqual(zamoskv);
    });

    test('falls back to header when hostname is unknown', async () => {
      mockPlatformDb.query.mockImplementation((sql, params) => {
        if (sql.includes('hostname')) return Promise.resolve({ rows: [] });
        if (params[0] === 'zamoskv') return Promise.resolve({ rows: [zamoskv] });
        return Promise.resolve({ rows: [] });
      });

      const req = { headers: { host: 'localhost', 'x-property-slug': 'zamoskv' } };
      const ctx = await resolveProperty(req);

      expect(ctx.resolvedBy).toBe('header');
      expect(ctx.property).toEqual(zamoskv);
    });

    test('falls back to JWT claim when hostname and header are absent', async () => {
      const jwt = require('jsonwebtoken');
      const token = jwt.sign({ uid: 'u1', property_slug: 'zamoskv' }, 'test-secret');

      mockPlatformDb.query.mockImplementation((sql, params) => {
        if (sql.includes('hostname')) return Promise.resolve({ rows: [] });
        if (params[0] === 'zamoskv') return Promise.resolve({ rows: [zamoskv] });
        return Promise.resolve({ rows: [] });
      });

      const req = { headers: { authorization: `Bearer ${token}` } };
      const ctx = await resolveProperty(req);

      expect(ctx.resolvedBy).toBe('jwt');
      expect(ctx.property).toEqual(zamoskv);
    });

    test('prefers hostname over header and JWT when all three are present', async () => {
      const jwt = require('jsonwebtoken');
      const token = jwt.sign({ uid: 'u1', property_slug: 'zamoskv' }, 'test-secret');

      mockPlatformDb.query.mockImplementation((sql, params) => {
        if (sql.includes('hostname') && params[0] === 'zamoskv.domhub.su') {
          return Promise.resolve({ rows: [zamoskv] });
        }
        return Promise.resolve({ rows: [] });
      });

      const req = {
        headers: {
          host: 'zamoskv.domhub.su',
          'x-property-slug': 'zamoskv', // consistent — would also match
          authorization: `Bearer ${token}`,
        },
      };
      const ctx = await resolveProperty(req);

      expect(ctx.resolvedBy).toBe('hostname');
      expect(ctx.property).toEqual(zamoskv);
    });

    test('blocks cross-tenant JWT replay (hostname=arbat but JWT slug=zamoskv)', async () => {
      const jwt = require('jsonwebtoken');
      const token = jwt.sign({ uid: 'u1', property_slug: 'zamoskv' }, 'test-secret');

      mockPlatformDb.query.mockImplementation((sql, params) => {
        if (sql.includes('hostname') && params[0] === 'arbat.domhub.su') {
          return Promise.resolve({ rows: [arbat] });
        }
        return Promise.resolve({ rows: [] });
      });

      const req = {
        headers: {
          host: 'arbat.domhub.su',
          authorization: `Bearer ${token}`,
        },
      };
      const ctx = await resolveProperty(req);

      expect(ctx.error).toBe('cross_tenant');
      expect(ctx.property).toBeNull();
      expect(ctx.resolvedBy).toBeNull();
    });

    test('returns no-property when none of the sources match', async () => {
      mockPlatformDb.query.mockResolvedValue({ rows: [] });
      const req = { headers: { host: 'localhost' } };
      const ctx = await resolveProperty(req);

      expect(ctx.property).toBeNull();
      expect(ctx.error).toBeNull();
      expect(ctx.resolvedBy).toBeNull();
    });
  });

  describe('propertyDbMiddleware (hybrid)', () => {
    const zamoskv = {
      id: 'zam', slug: 'zamoskv', hostname: 'zamoskv.domhub.su', feature_flags: {},
      db_connection_url: 'postgresql://zam', is_active: true,
    };
    const arbat = {
      id: 'arb', slug: 'arbat', hostname: 'arbat.domhub.su', feature_flags: {},
      db_connection_url: 'postgresql://arb', is_active: true,
    };

    test('attaches property via hostname and exposes resolvedBy', async () => {
      mockPlatformDb.query.mockImplementation((sql, params) => {
        if (sql.includes('hostname') && params[0] === 'zamoskv.domhub.su') {
          return Promise.resolve({ rows: [zamoskv] });
        }
        return Promise.resolve({ rows: [] });
      });

      mockReq.headers.host = 'zamoskv.domhub.su';
      await propertyDbMiddleware(mockReq, mockRes, mockNext);

      expect(mockReq.propertySlug).toBe('zamoskv');
      expect(mockReq.propertyResolvedBy).toBe('hostname');
      expect(mockReq.property).toMatchObject({ slug: 'zamoskv' });
      expect(mockNext).toHaveBeenCalled();
    });

    test('returns 403 on cross-tenant JWT replay', async () => {
      const jwt = require('jsonwebtoken');
      const token = jwt.sign({ uid: 'u1', property_slug: 'zamoskv' }, 'test-secret');

      mockPlatformDb.query.mockImplementation((sql, params) => {
        if (sql.includes('hostname') && params[0] === 'arbat.domhub.su') {
          return Promise.resolve({ rows: [arbat] });
        }
        return Promise.resolve({ rows: [] });
      });

      mockReq.headers.host = 'arbat.domhub.su';
      mockReq.headers.authorization = `Bearer ${token}`;
      await propertyDbMiddleware(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Cross-tenant access denied',
      }));
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('Cache TTL', () => {
    test('should refresh cache after TTL expires', async () => {
      const mockProperty = {
        slug: 'test-property',
        name: 'Test Property',
        is_active: true,
        db_connection_url: 'postgresql://test:test@localhost/test_property',
      };

      mockPlatformDb.query.mockResolvedValue({ rows: [mockProperty] });

      // First call
      await getProperty('test-property');
      expect(mockPlatformDb.query).toHaveBeenCalledTimes(1);

      // Manually expire cache
      const cachedItem = _cache.get('test-property');
      cachedItem.cachedAt = Date.now() - 70_000; // 70 seconds ago (past TTL)

      // Second call should refresh cache
      await getProperty('test-property');
      expect(mockPlatformDb.query).toHaveBeenCalledTimes(2);
    });
  });
});