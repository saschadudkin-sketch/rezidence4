'use strict';

const { describe, test, expect, beforeEach, afterEach } = require('@jest/globals');
const { PLATFORM_MIGRATIONS, LATEST_PLATFORM_MIGRATION_ID } = require('../platformMigrations');

describe('Platform Migrations', () => {
  let mockClient;

  beforeEach(() => {
    mockClient = {
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    };

    // Mock environment variables for migration
    process.env.ZAMOSKV_DB_URL = 'postgresql://test:test@localhost/test_zamoskv';
    process.env.DATABASE_URL = 'postgresql://test:test@localhost/test_default';
    process.env.CONTACT_EMAIL = 'test@example.com';
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.ZAMOSKV_DB_URL;
    delete process.env.DATABASE_URL;
    delete process.env.CONTACT_EMAIL;
  });

  test('should have at least one migration', () => {
    expect(PLATFORM_MIGRATIONS).toBeDefined();
    expect(PLATFORM_MIGRATIONS.length).toBeGreaterThan(0);
    expect(LATEST_PLATFORM_MIGRATION_ID).toBeDefined();
  });

  test('should have unique migration IDs', () => {
    const ids = PLATFORM_MIGRATIONS.map(m => m.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  test('should have migration functions', () => {
    for (const migration of PLATFORM_MIGRATIONS) {
      expect(migration.id).toBeDefined();
      expect(typeof migration.up).toBe('function');
    }
  });

  describe('Migration 001_platform_registry', () => {
    test('should create all required tables', async () => {
      const migration = PLATFORM_MIGRATIONS.find(m => m.id === '001_platform_registry');
      expect(migration).toBeDefined();

      await migration.up(mockClient);

      // Check that tables are created
      const queryCall = mockClient.query.mock.calls;
      const tableCreationQueries = queryCall.filter(call =>
        call[0].includes('CREATE TABLE IF NOT EXISTS')
      );

      expect(tableCreationQueries.length).toBeGreaterThanOrEqual(3);

      // Check specific tables
      const queryTexts = queryCall.map(call => call[0]);
      expect(queryTexts.some(q => q.includes('properties'))).toBe(true);
      expect(queryTexts.some(q => q.includes('platform_admins'))).toBe(true);
      expect(queryTexts.some(q => q.includes('platform_audit_log'))).toBe(true);
    });

    test('should create indexes', async () => {
      const migration = PLATFORM_MIGRATIONS.find(m => m.id === '001_platform_registry');
      await migration.up(mockClient);

      const queryCall = mockClient.query.mock.calls;
      const indexCreationQueries = queryCall.filter(call =>
        call[0].includes('CREATE INDEX IF NOT EXISTS')
      );

      expect(indexCreationQueries.length).toBeGreaterThan(0);
    });

    test('should seed Zamoskvorech\'ya property', async () => {
      const migration = PLATFORM_MIGRATIONS.find(m => m.id === '001_platform_registry');
      await migration.up(mockClient);

      const queryCall = mockClient.query.mock.calls;
      const seedQuery = queryCall.find(call =>
        call[0].includes('INSERT INTO properties') && call[1] && call[1][0] === 'zamoskv'
      );

      expect(seedQuery).toBeDefined();
      expect(seedQuery[1]).toEqual([
        'zamoskv',
        'Резидентные дома Замоскворечья',
        'г. Москва, Замоскворецкий район',
        'postgresql://test:test@localhost/test_zamoskv',
        true,
        'premium',
        'test@example.com'
      ]);
    });

    test('should use DATABASE_URL fallback if ZAMOSKV_DB_URL not set', async () => {
      delete process.env.ZAMOSKV_DB_URL;

      const migration = PLATFORM_MIGRATIONS.find(m => m.id === '001_platform_registry');
      await migration.up(mockClient);

      const queryCall = mockClient.query.mock.calls;
      const seedQuery = queryCall.find(call =>
        call[0].includes('INSERT INTO properties') && call[1] && call[1][0] === 'zamoskv'
      );

      expect(seedQuery).toBeDefined();
      expect(seedQuery[1][3]).toBe('postgresql://test:test@localhost/test_default');
    });

    test('should not seed if no database URL available', async () => {
      delete process.env.ZAMOSKV_DB_URL;
      delete process.env.DATABASE_URL;

      const migration = PLATFORM_MIGRATIONS.find(m => m.id === '001_platform_registry');
      await migration.up(mockClient);

      const queryCall = mockClient.query.mock.calls;
      const seedQuery = queryCall.find(call =>
        call[0].includes('INSERT INTO properties')
      );

      expect(seedQuery).toBeUndefined();
    });

    test('should handle database constraints properly', async () => {
      const migration = PLATFORM_MIGRATIONS.find(m => m.id === '001_platform_registry');
      await migration.up(mockClient);

      const queryCall = mockClient.query.mock.calls;

      // Check for CHECK constraints
      const propertiesTable = queryCall.find(call =>
        call[0].includes('CREATE TABLE IF NOT EXISTS properties')
      );
      expect(propertiesTable[0]).toContain("CHECK (plan IN ('standard', 'premium', 'enterprise'))");

      // Check for foreign key constraints
      const auditTable = queryCall.find(call =>
        call[0].includes('CREATE TABLE IF NOT EXISTS platform_audit_log')
      );
      expect(auditTable[0]).toContain('REFERENCES platform_admins(id)');
      expect(auditTable[0]).toContain('REFERENCES properties(id)');
    });
  });

  describe('LATEST_PLATFORM_MIGRATION_ID', () => {
    test('should match the last migration ID', () => {
      const lastMigration = PLATFORM_MIGRATIONS[PLATFORM_MIGRATIONS.length - 1];
      expect(LATEST_PLATFORM_MIGRATION_ID).toBe(lastMigration?.id || null);
    });

    test('should be null if no migrations exist', () => {
      // This is a theoretical test - we should always have migrations
      const emptyMigrations = [];
      const latestId = emptyMigrations[emptyMigrations.length - 1]?.id || null;
      expect(latestId).toBeNull();
    });
  });
});