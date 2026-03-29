'use strict';
/**
 * __tests__/db.test.js
 * Покрывает: db.query (pool.query passthrough), db.migrate (versioned migrations)
 */

const mockPoolQuery = jest.fn().mockResolvedValue({ rows: [] });
const mockRelease = jest.fn();
const mockClientQuery = jest.fn().mockResolvedValue({ rows: [] });
const mockClient = { query: mockClientQuery, release: mockRelease };
const mockConnect = jest.fn().mockResolvedValue(mockClient);

jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({
    query: mockPoolQuery,
    connect: mockConnect,
    on: jest.fn(),
  })),
}));

jest.mock('../logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  fatal: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockPoolQuery.mockResolvedValue({ rows: [] });
  mockConnect.mockResolvedValue(mockClient);
  mockClientQuery.mockResolvedValue({ rows: [] });
});

describe('db.query', () => {
  let db;

  beforeAll(() => {
    jest.resetModules();
    db = require('../db');
  });

  test('вызывает pool.query()', async () => {
    await db.query('SELECT 1');
    expect(mockPoolQuery).toHaveBeenCalledTimes(1);
  });

  test('прокидывает SQL и параметры в pool.query', async () => {
    const sql = 'SELECT * FROM users WHERE uid=$1';
    const params = ['u1'];
    await db.query(sql, params);
    expect(mockPoolQuery).toHaveBeenCalledWith(sql, params);
  });

  test('возвращает результат от pool.query', async () => {
    const mockResult = { rows: [{ uid: 'u1' }], rowCount: 1 };
    mockPoolQuery.mockResolvedValueOnce(mockResult);
    const result = await db.query('SELECT uid FROM users');
    expect(result).toBe(mockResult);
  });

  test('пробрасывает исключение если pool.query падает', async () => {
    mockPoolQuery.mockRejectedValueOnce(new Error('DB error'));
    await expect(db.query('SELECT 1')).rejects.toThrow('DB error');
  });
});

describe('db.migrate', () => {
  let db;

  beforeAll(() => {
    jest.resetModules();
    db = require('../db');
  });

  test('вызывает несколько CREATE TABLE и CREATE INDEX', async () => {
    await db.migrate();
    const calls = mockClientQuery.mock.calls.map(c => c[0]);

    expect(calls.some(sql => sql.includes('CREATE TABLE IF NOT EXISTS users'))).toBe(true);
    expect(calls.some(sql => sql.includes('CREATE TABLE IF NOT EXISTS requests'))).toBe(true);
    expect(calls.some(sql => sql.includes('CREATE TABLE IF NOT EXISTS chat_messages'))).toBe(true);
    expect(calls.some(sql => sql.includes('CREATE TABLE IF NOT EXISTS perms'))).toBe(true);
    expect(calls.some(sql => sql.includes('CREATE TABLE IF NOT EXISTS templates'))).toBe(true);
    expect(calls.some(sql => sql.includes('CREATE TABLE IF NOT EXISTS blacklist'))).toBe(true);
    expect(calls.some(sql => sql.includes('CREATE TABLE IF NOT EXISTS visit_logs'))).toBe(true);
    expect(calls.some(sql => sql.includes('CREATE INDEX IF NOT EXISTS'))).toBe(true);
  });

  test('логирует начало и завершение миграции', async () => {
    const logger = require('../logger');
    await db.migrate();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('migration'));
  });

  test('после миграции освобождает client', async () => {
    await db.migrate();
    expect(mockRelease).toHaveBeenCalled();
  });
});
