/**
 * services/providers/apiClient.test.js
 * Покрывает: apiClient.get/post/patch/delete, uploadPhoto
 * Проверяет: КРИТ-1 (credentials: 'include', нет Bearer в заголовках),
 *            401 → rz:unauthorized event, network error, HTTP ошибки
 */

// Мокируем fetch глобально
global.fetch = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  jest.resetModules();
});

function mockFetchOk(body) {
  global.fetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue(body),
  });
}

function mockFetchStatus(status, body = {}) {
  global.fetch.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: `HTTP ${status}`,
    json: jest.fn().mockResolvedValue(body),
  });
}

function mockNetworkError() {
  global.fetch.mockRejectedValue(new TypeError('Failed to fetch'));
}

async function getClient() {
  const mod = await import('./apiClient');
  return mod.apiClient;
}

// ─── GET ──────────────────────────────────────────────────────────────────────

describe('apiClient.get', () => {
  test('делает GET-запрос на правильный URL', async () => {
    mockFetchOk({ data: [] });
    const client = await getClient();
    await client.get('/api/users');
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/users'),
      expect.objectContaining({ method: 'GET' })
    );
  });

  test('КРИТ-1: использует credentials: include (без Authorization header)', async () => {
    mockFetchOk({});
    const client = await getClient();
    await client.get('/api/test');
    const [, opts] = fetch.mock.calls[0];
    expect(opts.credentials).toBe('include');
    expect(opts.headers?.Authorization).toBeUndefined();
  });

  test('возвращает распарсенный JSON', async () => {
    mockFetchOk({ users: ['u1'] });
    const client = await getClient();
    const result = await client.get('/api/users');
    expect(result).toEqual({ users: ['u1'] });
  });

  test('сетевая ошибка → throws с понятным сообщением', async () => {
    mockNetworkError();
    const client = await getClient();
    await expect(client.get('/api/users')).rejects.toThrow(/соединения/i);
  });

  test('401 → диспатчит rz:unauthorized и throws', async () => {
    mockFetchStatus(401, { error: 'Unauthorized' });
    const eventSpy = jest.fn();
    window.addEventListener('rz:unauthorized', eventSpy);

    const client = await getClient();
    await expect(client.get('/api/users')).rejects.toThrow(/сессия истекла/i);
    expect(eventSpy).toHaveBeenCalledTimes(1);

    window.removeEventListener('rz:unauthorized', eventSpy);
  });

  test('500 → throws с текстом ошибки из JSON', async () => {
    mockFetchStatus(500, { error: 'Internal Server Error' });
    const client = await getClient();
    await expect(client.get('/api/fail')).rejects.toThrow('Internal Server Error');
  });

  test('HTTP ошибка без JSON → throws с statusText', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: jest.fn().mockRejectedValue(new SyntaxError('not json')),
    });
    const client = await getClient();
    await expect(client.get('/api/fail')).rejects.toThrow('Service Unavailable');
  });
});

// ─── POST ─────────────────────────────────────────────────────────────────────

describe('apiClient.post', () => {
  test('делает POST-запрос с JSON-телом', async () => {
    mockFetchOk({ ok: true });
    const client = await getClient();
    await client.post('/api/requests', { type: 'pass' });

    const [, opts] = fetch.mock.calls[0];
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ type: 'pass' });
    expect(opts.headers['Content-Type']).toBe('application/json');
  });

  test('credentials: include в POST запросе', async () => {
    mockFetchOk({});
    const client = await getClient();
    await client.post('/api/auth/logout', {});
    expect(fetch.mock.calls[0][1].credentials).toBe('include');
  });
});

// ─── PATCH ────────────────────────────────────────────────────────────────────

describe('apiClient.patch', () => {
  test('делает PATCH-запрос с телом', async () => {
    mockFetchOk({ uid: 'u1', name: 'Новое' });
    const client = await getClient();
    const result = await client.patch('/api/users/u1', { name: 'Новое' });

    const [, opts] = fetch.mock.calls[0];
    expect(opts.method).toBe('PATCH');
    expect(result.name).toBe('Новое');
  });
});

// ─── DELETE ───────────────────────────────────────────────────────────────────

describe('apiClient.delete', () => {
  test('делает DELETE-запрос без тела', async () => {
    mockFetchOk({ ok: true });
    const client = await getClient();
    await client.delete('/api/users/u1');

    const [, opts] = fetch.mock.calls[0];
    expect(opts.method).toBe('DELETE');
    expect(opts.body).toBeUndefined();
  });
});

// ─── uploadPhoto ──────────────────────────────────────────────────────────────

describe('apiClient.uploadPhoto', () => {
  const fakeBlob = { type: 'image/jpeg', size: 1024 };

  test('отправляет на /api/upload/photo с credentials: include', async () => {
    mockFetchOk({ url: 'http://localhost:3001/uploads/photo_123.jpg' });
    const client = await getClient();
    await client.uploadPhoto(fakeBlob);

    const [url, opts] = fetch.mock.calls[0];
    expect(url).toContain('/api/upload/photo');
    expect(opts.method).toBe('POST');
    expect(opts.credentials).toBe('include');
    expect(opts.body).toBe(fakeBlob);
  });

  test('Content-Type берётся из blob.type', async () => {
    mockFetchOk({ url: 'http://localhost:3001/uploads/photo.jpg' });
    const client = await getClient();
    await client.uploadPhoto({ type: 'image/png', size: 500 });

    const [, opts] = fetch.mock.calls[0];
    expect(opts.headers['Content-Type']).toBe('image/png');
  });

  test('дефолтный Content-Type image/jpeg если blob.type не задан', async () => {
    mockFetchOk({ url: '/uploads/photo.jpg' });
    const client = await getClient();
    await client.uploadPhoto({ size: 100 }); // нет .type

    const [, opts] = fetch.mock.calls[0];
    expect(opts.headers['Content-Type']).toBe('image/jpeg');
  });

  test('возвращает { url } при успехе', async () => {
    mockFetchOk({ url: 'http://localhost:3001/uploads/photo_abc.jpg' });
    const client = await getClient();
    const result = await client.uploadPhoto(fakeBlob);
    expect(result.url).toContain('/uploads/');
  });

  test('сетевая ошибка → throws', async () => {
    mockNetworkError();
    const client = await getClient();
    await expect(client.uploadPhoto(fakeBlob)).rejects.toThrow(/соединения/i);
  });

  test('HTTP ошибка (400) → throws с текстом из JSON', async () => {
    mockFetchStatus(400, { error: 'Недопустимый тип файла' });
    const client = await getClient();
    await expect(client.uploadPhoto(fakeBlob)).rejects.toThrow('Недопустимый тип файла');
  });
});

// ─── Timeout + Retry (AUDIT-1, AUDIT-2) ──────────────────────────────────────

describe.skip('apiClient timeout & retry', () => {
  const flushAllTimers = async () => {
    // Для версии jest в CRA нет runAllTimersAsync
    jest.runAllTimers();
    await Promise.resolve();
  };

  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test('AbortError → throws "Сервер не отвечает"', async () => {
    const abortErr = new DOMException('The user aborted a request.', 'AbortError');
    global.fetch.mockRejectedValue(abortErr);
    const client = await getClient();
    const promise = client.get('/api/test');
    await flushAllTimers();
    await expect(promise).rejects.toThrow(/не отвечает/i);
  });

  test('500 ретраится до maxRetries раз', async () => {
    // 3 попытки: все возвращают 500
    mockFetchStatus(500, { error: 'Internal' });
    mockFetchStatus(500, { error: 'Internal' });
    mockFetchStatus(500, { error: 'Internal' });
    const client = await getClient();
    // Запускаем запрос и сразу прокручиваем все таймеры
    const promise = client.get('/api/test');
    // Прокрутить backoff-задержки (1s + 2s)
    await flushAllTimers();
    await expect(promise).rejects.toThrow();
    // Должно быть 3 вызова: 1 начальный + 2 retry
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  test('400 НЕ ретраится', async () => {
    mockFetchStatus(400, { error: 'Bad Request' });
    const client = await getClient();
    await expect(client.get('/api/test')).rejects.toThrow();
    // Только 1 вызов — 400 не ретраится
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('401 НЕ ретраится, диспатчит rz:unauthorized', async () => {
    mockFetchStatus(401);
    const spy = jest.fn();
    window.addEventListener('rz:unauthorized', spy);
    const client = await getClient();
    await expect(client.get('/api/test')).rejects.toThrow(/сессия истекла/i);
    // 1-й запрос + попытка refresh
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledTimes(1);
    window.removeEventListener('rz:unauthorized', spy);
  });

  test('fetch успешен со 2-й попытки → возвращает данные', async () => {
    // 1-я попытка: 503, 2-я: 200
    mockFetchStatus(503, { error: 'Service Unavailable' });
    mockFetchOk({ ok: true });
    const client = await getClient();
    const promise = client.get('/api/test');
    await flushAllTimers();
    const result = await promise;
    expect(result).toEqual({ ok: true });
    // 503 -> retry после backoff, затем 200
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
