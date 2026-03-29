'use strict';
/**
 * __tests__/infrastructure.test.js
 * Покрывает: logger.js (pino wrapper), index.js (app setup),
 *            migrate.js и seed.js (скрипты запуска)
 *
 * index.js, migrate.js, seed.js — точки запуска, тестируем через дымовые проверки
 * экспортов и поведения без фактического подключения к БД.
 */

// ── logger.js ─────────────────────────────────────────────────────────────────

describe('logger (pino wrapper)', () => {
  let logger;

  beforeAll(() => {
    jest.resetModules();
    // Мокируем pino чтобы не создавать реальный транспорт
    jest.mock('pino', () => {
      const mockLogger = {
        info:  jest.fn(),
        error: jest.fn(),
        warn:  jest.fn(),
        debug: jest.fn(),
        fatal: jest.fn(),
        child: jest.fn().mockReturnThis(),
      };
      return jest.fn(() => mockLogger);
    });
    logger = require('../logger');
  });

  test('экспортирует объект с методами логирования', () => {
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.fatal).toBe('function');
  });

  test('info вызывается без ошибок', () => {
    expect(() => logger.info('test message')).not.toThrow();
  });

  test('error вызывается без ошибок', () => {
    expect(() => logger.error({ err: new Error('test') }, 'error msg')).not.toThrow();
  });

  test('warn вызывается без ошибок', () => {
    expect(() => logger.warn('warning')).not.toThrow();
  });
});

// ── index.js — проверяем guards ───────────────────────────────────────────────

describe('index.js — production guards', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('process.exit(1) если JWT_SECRET не задан или короче 16 символов', () => {
    // Мокируем все зависимости чтобы не запускать реальный сервер
    jest.mock('dotenv', () => ({ config: jest.fn() }));
    jest.mock('../db', () => ({ migrate: jest.fn(), query: jest.fn(), pool: { connect: jest.fn() } }));
    jest.mock('../logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), fatal: jest.fn() }));
    jest.mock('../routes/auth',      () => { const r = require('express').Router(); return r; });
    jest.mock('../routes/requests',  () => { const r = require('express').Router(); return r; });
    jest.mock('../routes/users',     () => { const r = require('express').Router(); return r; });
    jest.mock('../routes/chat',      () => { const r = require('express').Router(); return r; });
    jest.mock('../routes/perms',     () => { const r = require('express').Router(); return r; });
    jest.mock('../routes/templates', () => { const r = require('express').Router(); return r; });
    jest.mock('../routes/blacklist', () => { const r = require('express').Router(); return r; });
    jest.mock('../routes/visitLogs', () => { const r = require('express').Router(); return r; });
    jest.mock('../routes/upload',    () => { const r = require('express').Router(); return r; });
    jest.mock('../middleware/auth',  () => (req, res, next) => next());
    jest.mock('../sse', () => ({ addClient: jest.fn(), removeClient: jest.fn() }));

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit'); });

    process.env.NODE_ENV = 'development';
    process.env.JWT_SECRET = 'short'; // < 16 символов

    expect(() => require('../index')).toThrow('process.exit');
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
  });
});

// ── migrate.js ────────────────────────────────────────────────────────────────

describe('migrate.js', () => {
  test('модуль загружается без ошибок при наличии заглушек', () => {
    jest.resetModules();
    jest.mock('dotenv', () => ({ config: jest.fn() }));
    jest.mock('../logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), fatal: jest.fn() }));
    jest.mock('../db', () => ({
      migrate: jest.fn().mockResolvedValue(undefined),
      query: jest.fn(),
      pool: {},
    }));

    // migrate.js вызывает db.migrate().then(process.exit) — мокируем process.exit
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
    // Не бросает при импорте
    expect(() => require('../migrate')).not.toThrow();
    exitSpy.mockRestore();
  });
});

// ── seed.js ───────────────────────────────────────────────────────────────────

describe('seed.js', () => {
  test('модуль загружается без ошибок при наличии заглушек', () => {
    jest.resetModules();
    jest.mock('dotenv', () => ({ config: jest.fn() }));
    jest.mock('../db', () => ({
      migrate: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue({ rows: [{ uid: 'existing-admin' }] }),
      pool: {},
    }));

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
    expect(() => require('../seed')).not.toThrow();
    exitSpy.mockRestore();
  });
});
