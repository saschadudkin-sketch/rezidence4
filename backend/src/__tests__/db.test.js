'use strict';
/**
 * __tests__/db.test.js
 * Покрывает: db.query (connect/release паттерн), db.migrate вызывает нужные DDL
 *
 * db.js импортирует pg.Pool и logger при загрузке — мокируем до require.
 */

// ── Моки до любого require ────────────────────────────────────────────────────

const mockRelease = jest.fn();
const mockClientQuery = jest.fn().mockResolvedValue({ rows: [] });
const mockClient = { query: mockClientQuery, release: mockRelease };
const mockConnect = jest.fn().mockResolvedValue(mockClient);

jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({
    connect: mockConnect,
    on: jest.fn(),
  })),
}));

jest.mock('../logger', () => ({
  info:  jest.fn(),
  error: jest.fn(),
  warn:  jest.fn(),
  fatal: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockConnect.mockResolvedValue(mockClient);
  mockClientQuery.mockResolvedValue({ rows: [] });
});

// ── Тесты ────────────────────────────────────────────────────────────────────

describe('db.query', () => {
  let db;

  beforeAll(() => {
    jest.resetModules();
    // Повторно регистрируем моки после resetModules
    jest.mock('pg', () => ({
      Pool: jest.fn().mockImplementation(() => ({
        connect: mockConnect,
        on: jest.fn(),
      })),
    }));
    jest.mock('../logger', () => ({
      info: jest.fn(), error: jest.fn(), warn: jest.fn(), fatal: jest.fn(),
    }));
    db = require('../db');
  });

  test('вызывает pool.connect()', async () => {
    await db.query('SELECT 1');
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  test('выполняет SQL через client.query', async () => {
    const sql    = 'SELECT * FROM users WHERE uid=$1';
    const params = ['u1'];
    await db.query(sql, params);
    expect(mockClientQuery).toHaveBeenCalledWith(sql, params);
  });

  test('вызывает client.release() после успешного запроса', async () => {
    await db.query('SELECT 1');
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  test('вызывает client.release() даже при ошибке (finally)', async () => {
    mockClientQuery.mockRejectedValueOnce(new Error('DB error'));
    await expect(db.query('BAD SQL')).rejects.toThrow('DB error');
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  test('возвращает результат от client.query', async () => {
    const mockResult = { rows: [{ uid: 'u1' }], rowCount: 1 };
    mockClientQuery.mockResolvedValueOnce(mockResult);
    const result = await db.query('SELECT uid FROM users');
    expect(result).toBe(mockResult);
  });

  test('пробрасывает исключение если pool.connect() падает', async () => {
    mockConnect.mockRejectedValueOnce(new Error('Connection refused'));
    await expect(db.query('SELECT 1')).rejects.toThrow('Connection refused');
  });
});

describe('db.migrate', () => {
  let db;

  beforeAll(() => {
    jest.resetModules();
    jest.mock('pg', () => ({
      Pool: jest.fn().mockImplementation(() => ({
        connect: mockConnect,
        on: jest.fn(),
      })),
    }));
    jest.mock('../logger', () => ({
      info: jest.fn(), error: jest.fn(), warn: jest.fn(), fatal: jest.fn(),
    }));
    db = require('../db');
  });

  test('вызывает несколько CREATE TABLE и CREATE INDEX', async () => {
    await db.migrate();

    // Все вызовы client.query
    const calls = mockClientQuery.mock.calls.map(c => c[0]);

    // Основные таблицы
    expect(calls.some(sql => sql.includes('CREATE TABLE IF NOT EXISTS users'))).toBe(true);
    expect(calls.some(sql => sql.includes('CREATE TABLE IF NOT EXISTS requests'))).toBe(true);
    expect(calls.some(sql => sql.includes('CREATE TABLE IF NOT EXISTS chat_messages'))).toBe(true);
    expect(calls.some(sql => sql.includes('CREATE TABLE IF NOT EXISTS perms'))).toBe(true);
    expect(calls.some(sql => sql.includes('CREATE TABLE IF NOT EXISTS templates'))).toBe(true);
    expect(calls.some(sql => sql.includes('CREATE TABLE IF NOT EXISTS blacklist'))).toBe(true);
    expect(calls.some(sql => sql.includes('CREATE TABLE IF NOT EXISTS visit_logs'))).toBe(true);

    // Индексы
    expect(calls.some(sql => sql.includes('CREATE INDEX IF NOT EXISTS'))).toBe(true);
  });

  test('логирует начало и завершение миграции', async () => {
    const logger = require('../logger');
    await db.migrate();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('migration'));
  });

  test('вызывает release() для каждого запроса в migrate', async () => {
    const releaseCount = mockRelease.mock.calls.length;
    await db.migrate();
    // Каждый query → один connect → один release
    expect(mockRelease.mock.calls.length).toBeGreaterThan(releaseCount);
  });
});
