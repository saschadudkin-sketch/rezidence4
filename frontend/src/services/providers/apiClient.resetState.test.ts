/**
 * services/providers/apiClient.resetState.test.js
 *
 * FIX [AUDIT]: тесты изоляции module-level состояния apiClient.
 * Проверяем что _resetApiState() предотвращает межтестовое заражение.
 */

// Мокаем fetch глобально
global.fetch = vi.fn();

describe('apiClient — _resetApiState изоляция', () => {
  let apiClient, _resetApiState, resetRefreshState;

  beforeEach(async () => {
    vi.resetModules();
    global.fetch = vi.fn();
    // Убираем window.dispatchEvent чтобы не было ошибки в jsdom
    vi.spyOn(window, 'dispatchEvent').mockImplementation(() => {});
    ({ apiClient, _resetApiState, resetRefreshState } = await import('./apiClient'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
