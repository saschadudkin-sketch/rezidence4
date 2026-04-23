'use strict';

describe('db.migrate - versioned migrations', () => {
  let mockQuery;
  let mockConnect;
  let mockClient;
  let db;

  beforeEach(() => {
    jest.resetModules();
    process.env.DATABASE_URL = 'postgresql://test:test@localhost/test';

    mockClient = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn(),
    };

    mockConnect = jest.fn().mockResolvedValue(mockClient);

    mockQuery = jest.fn().mockImplementation((sql) => {
      if (sql.includes('CREATE TABLE IF NOT EXISTS schema_migrations')) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes('SELECT id FROM schema_migrations')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    jest.mock('pg', () => ({
      Pool: jest.fn().mockImplementation(() => ({
        query: mockQuery,
        connect: mockConnect,
        on: jest.fn(),
      })),
    }));
    jest.mock('../logger', () => require('../__mocks__/logger'));

    db = require('../db');
  });

  test('creates schema_migrations table on first run', async () => {
    await db.migrate();
    const createCall = mockQuery.mock.calls.find(
      ([sql]) => sql.includes('CREATE TABLE IF NOT EXISTS schema_migrations'),
    );
    expect(createCall).toBeDefined();
  });

  test('skips already-applied migrations', async () => {
    const { MIGRATIONS } = require('../dbMigrations');
    // db.migrate() runs legacy + v1 migrations in one pass sharing
    // schema_migrations; both ID sets must look "applied" for the skip path.
    const { V1_PROPERTY_MIGRATIONS } = require('../v1/migrations');
    const appliedMigrationIds = [...MIGRATIONS, ...V1_PROPERTY_MIGRATIONS]
      .map((migration) => migration.id);

    mockQuery.mockImplementation((sql) => {
      if (sql.includes('CREATE TABLE IF NOT EXISTS schema_migrations')) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes('SELECT id FROM schema_migrations')) {
        return Promise.resolve({ rows: appliedMigrationIds.map((id) => ({ id })) });
      }
      return Promise.resolve({ rows: [] });
    });

    await db.migrate();
    expect(mockConnect).not.toHaveBeenCalled();
  });

  test('wraps each migration in a transaction (BEGIN/COMMIT)', async () => {
    await db.migrate();

    const clientCalls = mockClient.query.mock.calls.map(([sql]) => sql.trim());
    expect(clientCalls).toContain('BEGIN');
    expect(clientCalls).toContain('COMMIT');
  });

  test('rolls back and throws on migration error', async () => {
    mockClient.query.mockImplementation((sql) => {
      if (sql === 'BEGIN') return Promise.resolve();
      if (sql.includes('CREATE TABLE IF NOT EXISTS users')) {
        return Promise.reject(new Error('relation already exists'));
      }
      return Promise.resolve({ rows: [] });
    });

    await expect(db.migrate()).rejects.toThrow('relation already exists');

    const rollbackCalled = mockClient.query.mock.calls.some(([sql]) => sql === 'ROLLBACK');
    expect(rollbackCalled).toBe(true);
    expect(mockClient.release).toHaveBeenCalled();
  });

  test('inserts migration id into schema_migrations after successful run', async () => {
    await db.migrate();

    const insertCall = mockClient.query.mock.calls.find(
      ([sql]) => sql && sql.includes('INSERT INTO schema_migrations'),
    );
    expect(insertCall).toBeDefined();
    expect(insertCall[1]).toContain('001_initial_schema');
  });

  test('runs chat reactions constraint migration with function and check', async () => {
    await db.migrate();

    const clientCalls = mockClient.query.mock.calls.map(([sql]) => sql);
    expect(clientCalls.some((sql) => sql.includes('CREATE OR REPLACE FUNCTION is_valid_chat_reactions'))).toBe(true);
    expect(clientCalls.some((sql) => sql.includes('DROP CONSTRAINT IF EXISTS chk_chat_messages_reactions_valid'))).toBe(true);
    expect(clientCalls.some((sql) => sql.includes('ADD CONSTRAINT chk_chat_messages_reactions_valid'))).toBe(true);
  });
});
