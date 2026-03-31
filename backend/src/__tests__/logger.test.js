'use strict';

const { buildLoggerConfig } = require('../loggerConfig');

describe('buildLoggerConfig', () => {
  test('в test-окружении default level = warn', () => {
    const config = buildLoggerConfig({ NODE_ENV: 'test' });
    expect(config.level).toBe('warn');
    expect(config.transport).toBeUndefined();
  });

  test('LOG_LEVEL переопределяет default', () => {
    const config = buildLoggerConfig({ NODE_ENV: 'test', LOG_LEVEL: 'debug' });
    expect(config.level).toBe('debug');
  });

  test('в development включается pretty transport', () => {
    const config = buildLoggerConfig({ NODE_ENV: 'development' });
    expect(config.level).toBe('info');
    expect(config.transport).toEqual(expect.objectContaining({ target: 'pino-pretty' }));
  });

  test('в production transport выключен', () => {
    const config = buildLoggerConfig({ NODE_ENV: 'production' });
    expect(config.level).toBe('info');
    expect(config.transport).toBeUndefined();
  });

  test('в production LOG_LEVEL применяется', () => {
    const config = buildLoggerConfig({ NODE_ENV: 'production', LOG_LEVEL: 'fatal' });
    expect(config.level).toBe('fatal');
    expect(config.transport).toBeUndefined();
  });

  test('при отсутствии NODE_ENV используется info и transport выключен', () => {
    const config = buildLoggerConfig({});
    expect(config.level).toBe('info');
    expect(config.transport).toBeUndefined();
  });

  test('base.service всегда задан', () => {
    const config = buildLoggerConfig({ NODE_ENV: 'production' });
    expect(config.base).toEqual(expect.objectContaining({ service: 'residenze-backend' }));
  });

  test('formatter level возвращает объект с уровнем', () => {
    const config = buildLoggerConfig({ NODE_ENV: 'production' });
    expect(config.formatters.level('error')).toEqual({ level: 'error' });
  });
});

describe('logger module (pino wrapper)', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock('pino');
  });

  test('экспортирует объект с методами логирования', () => {
    jest.isolateModules(() => {
      jest.doMock('pino', () => jest.fn(() => ({
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
        fatal: jest.fn(),
        child: jest.fn().mockReturnThis(),
      })));
      const logger = require('../logger');
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.error).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.debug).toBe('function');
      expect(typeof logger.fatal).toBe('function');
    });
  });
});
