'use strict';
/**
 * __tests__/infrastructure.test.js
 * Покрывает: index.js (app setup), migrate.js и seed.js (скрипты запуска)
 *
 * index.js, migrate.js, seed.js — точки запуска, тестируем через дымовые проверки
 * экспортов и поведения без фактического подключения к БД.
 */

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
    jest.mock('pino-http', () => () => (req, res, next) => next());

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit'); });

    process.env.NODE_ENV = 'development';
    process.env.JWT_SECRET = 'short'; // < 16 символов

    expect(() => require('../index')).toThrow('process.exit');
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
  });

  test('CORS не использует wildcard для credentials=true', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.resolve(__dirname, '../app/createApp.js'), 'utf8');
    expect(source).toContain('credentials: true');
    expect(source).toContain('allowedOrigins.includes(origin)');
    expect(source).not.toContain("allowedOrigins.includes('*')");
  });

  test('в production наружу не утекает err.message из error-handler', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.resolve(__dirname, '../app/createApp.js'), 'utf8');
    expect(source).toContain("Internal server error");
    expect(source).toContain('safeErrorMessage');
    expect(source).toContain('config.isProd');
  });

  test('request correlation id middleware выставляет X-Request-Id', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.resolve(__dirname, '../app/createApp.js'), 'utf8');
    expect(source).toContain("req.headers['x-request-id']");
    expect(source).toContain("res.setHeader('X-Request-Id', requestId)");
    expect(source).toContain('requestId: req.raw?.requestId');
  });

  test('есть prometheus endpoint для метрик приложения', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.resolve(__dirname, '../app/registerObservabilityRoutes.js'), 'utf8');
    expect(source).toContain('/api/metrics/prometheus');
    expect(source).toContain("text/plain; version=0.0.4; charset=utf-8");
    expect(source).toContain('rez_auth_refresh_requests_total');
  });
});

// ── migrate.js ────────────────────────────────────────────────────────────────

describe('migrate.js', () => {
  test('модуль загружается без авто-выполнения и экспортирует run()', () => {
    jest.resetModules();
    jest.mock('dotenv', () => ({ config: jest.fn() }));
    jest.mock('../logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), fatal: jest.fn() }));
    const mockMigrate = jest.fn().mockResolvedValue(undefined);
    jest.mock('../db', () => ({
      migrate: mockMigrate,
      query: jest.fn(),
      pool: {},
    }));

    // При require модуль не должен выполнять run() автоматически
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
    const mod = require('../migrate');
    expect(mod).toEqual(expect.objectContaining({ run: expect.any(Function) }));
    expect(mockMigrate).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});

// ── seed.js ───────────────────────────────────────────────────────────────────

describe('seed.js', () => {
  test('модуль загружается без авто-выполнения и экспортирует seed()', () => {
    jest.resetModules();
    jest.mock('dotenv', () => ({ config: jest.fn() }));
    const mockMigrate = jest.fn().mockResolvedValue(undefined);
    const mockQuery = jest.fn().mockResolvedValue({ rows: [{ uid: 'existing-admin' }] });
    jest.mock('../db', () => ({
      migrate: mockMigrate,
      query: mockQuery,
      pool: {},
    }));

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
    const mod = require('../seed');
    expect(mod).toEqual(expect.objectContaining({ seed: expect.any(Function) }));
    expect(mockMigrate).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});
