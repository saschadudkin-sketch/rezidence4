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

  // Phase 1 (D-lite) migrations.  We assert on the SQL text rather than the
  // final DB state — the migrations run against a Postgres-free mock client,
  // and the point of these tests is to catch accidental edits to the
  // migration-contract (e.g. dropping a CHECK constraint, changing a type).
  describe('Migration 004_properties_full_spec', () => {
    test('adds property_type with CHECK constraint and correct default', async () => {
      const migration = PLATFORM_MIGRATIONS.find((m) => m.id === '004_properties_full_spec');
      expect(migration).toBeDefined();

      await migration.up(mockClient);
      const queries = mockClient.query.mock.calls.map((c) => c[0]);

      const propertyTypeStmt = queries.find((q) => q.includes('property_type VARCHAR(30)'));
      expect(propertyTypeStmt).toBeDefined();
      expect(propertyTypeStmt).toContain("DEFAULT 'residential_complex'");
      expect(propertyTypeStmt).toContain("CHECK (property_type IN ('residential_complex', 'club_house', 'cottage_community'))");
    });

    test('adds status with CHECK and seeds from is_active', async () => {
      const migration = PLATFORM_MIGRATIONS.find((m) => m.id === '004_properties_full_spec');
      await migration.up(mockClient);
      const queries = mockClient.query.mock.calls.map((c) => c[0]);

      const statusStmt = queries.find((q) => q.includes('ADD COLUMN IF NOT EXISTS status'));
      expect(statusStmt).toBeDefined();
      expect(statusStmt).toContain("CHECK (status IN ('active', 'suspended', 'maintenance', 'terminated'))");

      const seedStmt = queries.find((q) => q.includes('UPDATE properties') && q.includes('SET status'));
      expect(seedStmt).toBeDefined();
      expect(seedStmt).toContain("CASE WHEN is_active THEN 'active' ELSE 'suspended' END");
    });

    test('adds logo_url, primary_color, management_company_id columns', async () => {
      const migration = PLATFORM_MIGRATIONS.find((m) => m.id === '004_properties_full_spec');
      await migration.up(mockClient);
      const queries = mockClient.query.mock.calls.map((c) => c[0]);

      expect(queries.some((q) => q.includes('ADD COLUMN IF NOT EXISTS logo_url TEXT'))).toBe(true);
      expect(queries.some((q) => q.includes('ADD COLUMN IF NOT EXISTS primary_color VARCHAR(20)'))).toBe(true);
      expect(queries.some((q) => q.includes('ADD COLUMN IF NOT EXISTS management_company_id UUID'))).toBe(true);
    });

    test('indexes management_company_id for fast per-MC lookups', async () => {
      const migration = PLATFORM_MIGRATIONS.find((m) => m.id === '004_properties_full_spec');
      await migration.up(mockClient);
      const queries = mockClient.query.mock.calls.map((c) => c[0]);

      const indexStmt = queries.find((q) => q.includes('idx_properties_management_company'));
      expect(indexStmt).toBeDefined();
      expect(indexStmt).toContain('WHERE management_company_id IS NOT NULL');
    });
  });

  describe('Migration 005_management_companies', () => {
    test('creates management_companies table with status CHECK', async () => {
      const migration = PLATFORM_MIGRATIONS.find((m) => m.id === '005_management_companies');
      expect(migration).toBeDefined();

      await migration.up(mockClient);
      const queries = mockClient.query.mock.calls.map((c) => c[0]);

      const tableStmt = queries.find((q) => q.includes('CREATE TABLE IF NOT EXISTS management_companies'));
      expect(tableStmt).toBeDefined();
      expect(tableStmt).toContain('slug VARCHAR(80) UNIQUE NOT NULL');
      expect(tableStmt).toContain("CHECK (status IN ('active', 'suspended', 'terminated'))");
    });

    test('adds FK from properties.management_company_id ON DELETE SET NULL', async () => {
      const migration = PLATFORM_MIGRATIONS.find((m) => m.id === '005_management_companies');
      await migration.up(mockClient);
      const queries = mockClient.query.mock.calls.map((c) => c[0]);

      const fkStmt = queries.find((q) => q.includes('fk_properties_management_company'));
      expect(fkStmt).toBeDefined();
      expect(fkStmt).toContain('FOREIGN KEY (management_company_id)');
      expect(fkStmt).toContain('REFERENCES management_companies(id)');
      expect(fkStmt).toContain('ON DELETE SET NULL');
    });

    test('creates management_company_admins with unique per-MC email', async () => {
      const migration = PLATFORM_MIGRATIONS.find((m) => m.id === '005_management_companies');
      await migration.up(mockClient);
      const queries = mockClient.query.mock.calls.map((c) => c[0]);

      const tableStmt = queries.find((q) => q.includes('CREATE TABLE IF NOT EXISTS management_company_admins'));
      expect(tableStmt).toBeDefined();
      expect(tableStmt).toContain('UNIQUE(management_company_id, email)');
      expect(tableStmt).toContain('REFERENCES management_companies(id) ON DELETE CASCADE');
    });
  });

  describe('Migration 006_platform_audit_log_full', () => {
    test('adds actor_type with CHECK and default', async () => {
      const migration = PLATFORM_MIGRATIONS.find((m) => m.id === '006_platform_audit_log_full');
      expect(migration).toBeDefined();

      await migration.up(mockClient);
      const queries = mockClient.query.mock.calls.map((c) => c[0]);

      const stmt = queries.find((q) => q.includes('ADD COLUMN IF NOT EXISTS actor_type'));
      expect(stmt).toBeDefined();
      expect(stmt).toContain("DEFAULT 'platform_admin'");
      expect(stmt).toContain("CHECK (actor_type IN ('platform_admin', 'management_company_admin', 'system', 'integration'))");
    });

    test('drops NOT NULL on admin_id so system events can be logged', async () => {
      const migration = PLATFORM_MIGRATIONS.find((m) => m.id === '006_platform_audit_log_full');
      await migration.up(mockClient);
      const queries = mockClient.query.mock.calls.map((c) => c[0]);

      const stmt = queries.find((q) => q.includes('ALTER COLUMN admin_id DROP NOT NULL'));
      expect(stmt).toBeDefined();
    });

    test('adds management_company_id FK and index', async () => {
      const migration = PLATFORM_MIGRATIONS.find((m) => m.id === '006_platform_audit_log_full');
      await migration.up(mockClient);
      const queries = mockClient.query.mock.calls.map((c) => c[0]);

      expect(queries.some((q) =>
        q.includes('ADD COLUMN IF NOT EXISTS management_company_id')
        && q.includes('REFERENCES management_companies(id)'),
      )).toBe(true);

      expect(queries.some((q) => q.includes('idx_platform_audit_mc'))).toBe(true);
    });

    test('widens ip_address from VARCHAR to INET', async () => {
      const migration = PLATFORM_MIGRATIONS.find((m) => m.id === '006_platform_audit_log_full');
      await migration.up(mockClient);
      const queries = mockClient.query.mock.calls.map((c) => c[0]);

      const stmt = queries.find((q) =>
        q.includes('ALTER COLUMN ip_address TYPE INET')
        && q.includes("USING NULLIF(ip_address, '')::INET"),
      );
      expect(stmt).toBeDefined();
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