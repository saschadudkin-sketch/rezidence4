/**
 * services/logger.test.js
 * Покрывает: logger.setContext, clearContext, debug, info, warn, error, action
 */

// Перезагружаем модуль перед каждым тестом чтобы сбросить _ctx
beforeEach(() => {
  process.env.VITEST_LOGGER_CONSOLE = '1';
  vi.resetModules();
});

afterEach(() => {
  delete process.env.VITEST_LOGGER_CONSOLE;
});

async function getLogger() {
  const { logger } = await import('./logger');
  return logger;
}

describe('logger', () => {
  let infoSpy, warnSpy, errorSpy;

  beforeEach(() => {
    infoSpy  = vi.spyOn(console, 'info').mockImplementation(() => {});
    warnSpy  = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('setContext / clearContext', () => {
    test('setContext не бросает исключений', async () => {
      const logger = await getLogger();
      expect(() => logger.setContext({ uid: 'u1', role: 'owner' })).not.toThrow();
    });

    test('clearContext не бросает исключений', async () => {
      const logger = await getLogger();
      logger.setContext({ uid: 'u1' });
      expect(() => logger.clearContext()).not.toThrow();
    });
  });

  describe('debug / info (dev only)', () => {
    test('debug вызывает console.info в NODE_ENV=test (dev)', async () => {
      const logger = await getLogger();
      logger.debug('тест debug');
      // В test-окружении NODE_ENV !== 'production', значит IS_DEV = true
      expect(infoSpy).toHaveBeenCalledWith('[DEBUG]', 'тест debug');
    });

    test('info вызывает console.info в dev', async () => {
      const logger = await getLogger();
      logger.info('тест info');
      expect(infoSpy).toHaveBeenCalledWith('[INFO]', 'тест info');
    });
  });

  describe('warn', () => {
    test('warn всегда вызывает console.warn', async () => {
      const logger = await getLogger();
      logger.warn('предупреждение');
      expect(warnSpy).toHaveBeenCalledWith('[WARN]', 'предупреждение');
    });
  });

  describe('error', () => {
    test('error вызывает console.error с объектом payload', async () => {
      const logger = await getLogger();
      const err = new Error('тест ошибки');
      logger.error('Что-то сломалось', err);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const [prefix, payload] = errorSpy.mock.calls[0];
      expect(prefix).toBe('[ERROR]');
      expect(payload.message).toBe('Что-то сломалось');
      expect(payload.error.message).toBe('тест ошибки');
    });

    test('error включает timestamp в ISO-формате', async () => {
      const logger = await getLogger();
      logger.error('ошибка', new Error('x'));
      const payload = errorSpy.mock.calls[0][1];
      expect(payload.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    test('error с нестрочным error-объектом не падает', async () => {
      const logger = await getLogger();
      expect(() => logger.error('ошибка', { code: 500 })).not.toThrow();
    });

    test('error включает контекст из setContext', async () => {
      const logger = await getLogger();
      logger.setContext({ uid: 'u1', role: 'admin' });
      logger.error('ошибка с контекстом', new Error('x'));
      const payload = errorSpy.mock.calls[0][1];
      expect(payload.context).toEqual({ uid: 'u1', role: 'admin' });
    });

    test('error после clearContext — пустой контекст', async () => {
      const logger = await getLogger();
      logger.setContext({ uid: 'u1' });
      logger.clearContext();
      logger.error('ошибка', new Error('x'));
      const payload = errorSpy.mock.calls[0][1];
      expect(payload.context).toEqual({});
    });
  });

  describe('action', () => {
    test('action вызывает console.info в dev', async () => {
      const logger = await getLogger();
      logger.action('Создание заявки', { type: 'pass' });
      expect(infoSpy).toHaveBeenCalledWith('[ACTION]', 'Создание заявки', expect.objectContaining({ type: 'pass' }));
    });

    test('action без данных не падает', async () => {
      const logger = await getLogger();
      expect(() => logger.action('Действие')).not.toThrow();
    });
  });

  describe('контекст добавляется к сообщениям', () => {
    test('debug-сообщение содержит контекст', async () => {
      const logger = await getLogger();
      logger.setContext({ uid: 'u5' });
      logger.debug('сообщение');
      expect(infoSpy).toHaveBeenCalledWith('[DEBUG]', 'сообщение', { uid: 'u5' });
    });
  });
});

// ─── AUDIT-9: createLogger factory isolation ─────────────────────────────────

describe('createLogger() — изоляция экземпляров (AUDIT-9)', () => {
  test('два экземпляра имеют независимый контекст', async () => {
    const { createLogger } = await import('./logger');
    const log1 = createLogger();
    const log2 = createLogger();

    log1.setContext({ uid: 'user-1' });
    log2.setContext({ uid: 'user-2' });

    expect(log1.getContext()).toEqual({ uid: 'user-1' });
    expect(log2.getContext()).toEqual({ uid: 'user-2' });

    // Сброс log1 не влияет на log2
    log1.clearContext();
    expect(log1.getContext()).toEqual({});
    expect(log2.getContext()).toEqual({ uid: 'user-2' });
  });

  test('singleton logger не влияет на новый экземпляр', async () => {
    const { logger, createLogger } = await import('./logger');
    const isolated = createLogger();

    logger.setContext({ uid: 'singleton-user' });
    isolated.setContext({ uid: 'isolated-user' });

    expect(logger.getContext()).toEqual({ uid: 'singleton-user' });
    expect(isolated.getContext()).toEqual({ uid: 'isolated-user' });

    logger.clearContext();
    // isolated не затронут
    expect(isolated.getContext()).toEqual({ uid: 'isolated-user' });
  });

  test('getContext возвращает копию (мутация снаружи не влияет)', async () => {
    const { createLogger } = await import('./logger');
    const log = createLogger();
    log.setContext({ uid: 'u1' });

    const ctx = log.getContext();
    ctx.uid = 'HACKED'; // мутируем снаружи

    // Внутренний контекст не изменился
    expect(log.getContext().uid).toBe('u1');
  });
});
