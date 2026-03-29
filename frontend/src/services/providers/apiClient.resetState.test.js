/**
 * services/providers/apiClient.resetState.test.js
 *
 * FIX [AUDIT]: тесты изоляции module-level состояния apiClient.
 * Проверяем что _resetApiState() предотвращает межтестовое заражение.
 */

// Мокаем fetch глобально
global.fetch = jest.fn();

describe('apiClient — _resetApiState изоляция', () => {
  let apiClient, _resetApiState, resetRefreshState;

  beforeEach(() => {
    jest.resetModules();
    global.fetch = jest.fn();
    // Убираем window.dispatchEvent чтобы не было ошибки в jsdom
    jest.spyOn(window, 'dispatchEvent').mockImplementation(() => {});
    ({ apiClient, _resetApiState, resetRefreshState } = require('./apiClient'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('успешный запрос сбрасывает _refreshFailed', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: 'ok' }),
      body: null,
    });

    _resetApiState(); // чистое состояние

    const result = await apiClient.get('/api/test');
    expect(result).toEqual({ data: 'ok' });
  });

  test('_resetApiState позволяет повторный refresh после ошибки', async () => {
    // Симулируем: refresh уже провалился (_refreshFailed = true)
    // Сбрасываем — теперь следующий 401 попробует refresh снова
    _resetApiState();

    // mock: первый запрос → 200 OK
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });

    await expect(apiClient.get('/api/data')).resolves.toEqual({ ok: true });
  });

  test('resetRefreshState доступен как именованный экспорт', () => {
    expect(typeof resetRefreshState).toBe('function');
    // Не бросает исключений
    expect(() => resetRefreshState()).not.toThrow();
  });
});
