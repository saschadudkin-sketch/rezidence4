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

describe('deprecate middleware headers', () => {
  test('sets Deprecation/Sunset on /api/* alias with matching calendar day and valid HTTP-date', async () => {
    const express = require('express');
    const request = require('supertest');
    const { deprecate } = require('../middleware/deprecate');

    const app = express();
    app.get('/api/requests', deprecate, (_req, res) => res.json({ ok: true }));

    const res = await request(app).get('/api/requests');

    expect(res.status).toBe(200);

    const deprecation = res.headers.deprecation;
    const sunset = res.headers.sunset;

    expect(deprecation).toBeDefined();
    expect(sunset).toBeDefined();

    const depMatch = /^version="(\d{4}-\d{2}-\d{2})"$/.exec(deprecation);
    expect(depMatch).not.toBeNull();

    const depDate = depMatch[1];
    const sunsetDate = new Date(sunset);

    expect(Number.isNaN(sunsetDate.getTime())).toBe(false);
    expect(sunset).toBe(sunsetDate.toUTCString());

    const sunsetYmd = sunsetDate.toISOString().slice(0, 10);
    expect(sunsetYmd).toBe(depDate);
  });
});
