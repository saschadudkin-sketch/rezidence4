'use strict';

const { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } = require('@jest/globals');
const { Pool } = require('pg');
const { propertyDbMiddleware, extractPropertySlug, getProperty, closeAllPools, _pools, _cache } = require('../middleware/propertyDb');
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