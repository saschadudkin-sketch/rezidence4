'use strict';

const { buildLoggerConfig, REDACT_PATHS } = require('../loggerConfig');

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

  // SEC [AUDIT-PII]: redact гарантирует, что чувствительные поля не утекают
  // в log-aggregation.  Снимаем регрессию через статическую проверку paths +
  // через интеграцию pino → redact (см. ниже отдельный describe).
  describe('redact (PII / secrets защита)', () => {
    test('redact включён во всех окружениях', () => {
      for (const NODE_ENV of ['development', 'production', 'test', undefined]) {
        const config = buildLoggerConfig({ NODE_ENV });
        expect(config.redact).toBeDefined();
        expect(config.redact.censor).toBe('[REDACTED]');
        expect(Array.isArray(config.redact.paths)).toBe(true);
        expect(config.redact.paths.length).toBeGreaterThan(0);
      }
    });

    test('paths покрывают известные PII-поля channel-адаптеров', () => {
      const required = ['phone', 'chatId', 'recipientAddress', 'email', 'endpoint',
        '*.phone', '*.chatId', '*.recipientAddress'];
      for (const p of required) {
        expect(REDACT_PATHS).toContain(p);
      }
    });

    test('paths покрывают известные secret-поля', () => {
      const required = ['token', 'secret', 'bot_token', 'password',
        '*.token', '*.secret', '*.bot_token'];
      for (const p of required) {
        expect(REDACT_PATHS).toContain(p);
      }
    });

    test('paths покрывают auth-headers', () => {
      expect(REDACT_PATHS).toContain('req.headers.cookie');
      expect(REDACT_PATHS).toContain('req.headers.authorization');
    });
  });
});

// SEC [AUDIT-PII]: end-to-end проверка — поднимаем настоящий pino с нашим
// configom, ловим вывод stream'ом и убеждаемся, что PII заменён на [REDACTED].
describe('logger redaction — pino integration', () => {
  test('PII-поля censor-ятся в реальном pino выводе', () => {
    const pino = require('pino');
    const lines = [];
    const stream = { write: (line) => lines.push(line) };
    const config = buildLoggerConfig({ NODE_ENV: 'production' });
    const log = pino({ ...config, level: 'warn' }, stream);
    log.warn({
      phone: '+79161234567',
      chatId: '123456789',
      email: 'user@example.com',
      bot_token: '1234:ABC',
      password: 'hunter2',
      err: { message: 'send failed' },
    }, 'test pii');
    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.phone).toBe('[REDACTED]');
    expect(parsed.chatId).toBe('[REDACTED]');
    expect(parsed.email).toBe('[REDACTED]');
    expect(parsed.bot_token).toBe('[REDACTED]');
    expect(parsed.password).toBe('[REDACTED]');
    // err.message — не PII, должен пройти
    expect(parsed.err.message).toBe('send failed');
  });

  test('nested first-level (* wildcard) censor-ится', () => {
    const pino = require('pino');
    const lines = [];
    const stream = { write: (line) => lines.push(line) };
    const config = buildLoggerConfig({ NODE_ENV: 'production' });
    const log = pino({ ...config, level: 'warn' }, stream);
    log.warn({
      ctx: { phone: '+79161234567', userId: 'safe-uid' },
    }, 'nested pii');
    const parsed = JSON.parse(lines[0]);
    expect(parsed.ctx.phone).toBe('[REDACTED]');
    expect(parsed.ctx.userId).toBe('safe-uid');
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
