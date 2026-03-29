'use strict';
/**
 * __tests__/migrations.test.js
 * Проверяет логику versioned migrations в db.js:
 *   - Уже применённые миграции пропускаются
 *   - Новые применяются в транзакции
 *   - При ошибке — ROLLBACK, process не стартует
 *   - schema_migrations таблица создаётся автоматически
 */

describe('db.migrate — versioned migrations', () => {
  let mockQuery;
  let mockConnect;
  let mockClient;
  let db;

  beforeEach(() => {
    jest.resetModules();
    process.env.DATABASE_URL = 'postgresql://test:test@localhost/test';

    mockClient = {
      query:   jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn(),
    };

    // pool.connect возвращает mock клиент
    mockConnect = jest.fn().mockResolvedValue(mockClient);

    // pool.query для schema_migrations bootstrap
    mockQuery = jest.fn().mockImplementation((sql) => {
      if (sql.includes('CREATE TABLE IF NOT EXISTS schema_migrations')) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes('SELECT id FROM schema_migrations')) {
        // По умолчанию — нет применённых миграций
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    jest.mock('pg', () => ({
      Pool: jest.fn().mockImplementation(() => ({
        query:   mockQuery,
        connect: mockConnect,
        on:      jest.fn(),
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
    // Имитируем что все миграции уже применены
    mockQuery.mockImplementation((sql) => {
      if (sql.includes('CREATE TABLE IF NOT EXISTS schema_migrations')) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes('SELECT id FROM schema_migrations')) {
        return Promise.resolve({
          rows: [
            { id: '001_initial_schema' },
            { id: '002_indexes_and_soft_delete' },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    await db.migrate();

    // pool.connect не должен вызываться — нечего применять
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

    // ROLLBACK должен был быть вызван
    const rollbackCalled = mockClient.query.mock.calls.some(([sql]) => sql === 'ROLLBACK');
    expect(rollbackCalled).toBe(true);
    // client.release() вызван даже при ошибке (finally)
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
});
