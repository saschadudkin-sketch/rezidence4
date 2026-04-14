/**
 * services/providers/backendProvider.test.js
 * Покрывает: authProvider, chatProvider, requestsProvider, usersProvider,
 *            permsProvider, blacklistProvider, createBackendProvider
 */

vi.mock('./apiClient', () => ({
  __esModule: true,
  default: {
    get:         vi.fn(),
    post:        vi.fn(),
    patch:       vi.fn(),
    delete:      vi.fn(),
    uploadPhoto: vi.fn(),
    resetRefreshState: vi.fn(),
  },
  resetRefreshState: vi.fn(),
  apiClient: {
    get:         vi.fn(),
    post:        vi.fn(),
    patch:       vi.fn(),
    delete:      vi.fn(),
    uploadPhoto: vi.fn(),
    resetRefreshState: vi.fn(),
  },
}));

vi.mock('../contracts/statusTransitions', () => ({
  canTransitionOnFrontend: vi.fn().mockResolvedValue(true),
}));

import apiClient from './apiClient';
import {
  authProvider,
  chatProvider,
  requestsProvider,
  usersProvider,
  permsProvider,
  blacklistProvider,
  visitLogsProvider,
  createBackendProvider,
} from './backendProvider';
import { canTransitionOnFrontend } from '../contracts/statusTransitions';

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'location', {
    value: new URL('https://app.example.test/dashboard'),
    configurable: true,
  });
});

// ─── authProvider ─────────────────────────────────────────────────────────────

describe('authProvider', () => {
  test('sendOtp → POST /api/auth/send-otp', async () => {
    apiClient.post.mockResolvedValueOnce({});
    await authProvider.sendOtp('+79001234567');
    expect(apiClient.post).toHaveBeenCalledWith('/api/v1/auth/send-otp', { phone: '+79001234567' }, { retryable: false });
  });

  test('verifyOtp → POST /api/auth/verify-otp, возвращает user', async () => {
    const user = { uid: 'u1', role: 'owner' };
    apiClient.post.mockResolvedValueOnce({ user });
    const result = await authProvider.verifyOtp('+79001234567', '123456');
    expect(apiClient.post).toHaveBeenCalledWith('/api/v1/auth/verify-otp', {
      phone: '+79001234567', code: '123456',
    }, { retryable: false });
    expect(result).toEqual(user);
  });

  test('getMe → GET /api/auth/me, возвращает user', async () => {
    const user = { uid: 'u1', role: 'owner' };
    apiClient.get.mockResolvedValueOnce({ user });
    const result = await authProvider.getMe();
    expect(apiClient.get).toHaveBeenCalledWith('/api/v1/auth/me');
    expect(result).toEqual(user);
  });

  test('logout → POST /api/auth/logout', async () => {
    apiClient.post.mockResolvedValueOnce({});
    await authProvider.logout();
    expect(apiClient.post).toHaveBeenCalledWith('/api/v1/auth/logout', undefined, { retryable: false });
  });
});

// ─── chatProvider ─────────────────────────────────────────────────────────────

describe('chatProvider', () => {
  test('getMessages без параметров → GET /api/chat/messages', async () => {
    apiClient.get.mockResolvedValueOnce({ messages: [], hasMore: false });
    const result = await chatProvider.getMessages();
    expect(apiClient.get).toHaveBeenCalledWith('/api/v1/chat/messages');
    expect(result).toEqual({ messages: [], hasMore: false });
  });

  test('getMessages с before → добавляет ?before=<id> в URL', async () => {
    apiClient.get.mockResolvedValueOnce({ messages: [], hasMore: false });
    await chatProvider.getMessages({ before: 'msg-123' });
    expect(apiClient.get).toHaveBeenCalledWith('/api/v1/chat/messages?before=msg-123');
  });

  test('getMessages с limit → добавляет ?limit=N в URL', async () => {
    apiClient.get.mockResolvedValueOnce({ messages: [], hasMore: false });
    await chatProvider.getMessages({ limit: 30 });
    expect(apiClient.get).toHaveBeenCalledWith('/api/v1/chat/messages?limit=30');
  });

  test('getMessages backward-compat: плоский массив оборачивается в { messages, hasMore }', async () => {
    // Старый формат (до пагинации) — обратная совместимость
    apiClient.get.mockResolvedValueOnce([{ id: 'm1' }]);
    const result = await chatProvider.getMessages();
    expect(result).toEqual({ messages: [{ id: 'm1' }], hasMore: false });
  });

  test('sendMessage → POST /api/chat/messages', async () => {
    const msg = { id: 'm1', text: 'Привет' };
    apiClient.post.mockResolvedValueOnce(msg);
    await chatProvider.sendMessage(msg);
    expect(apiClient.post).toHaveBeenCalledWith('/api/v1/chat/messages', msg);
  });

  test('updateMessage → PATCH /api/chat/messages/:id', async () => {
    apiClient.patch.mockResolvedValueOnce({});
    await chatProvider.updateMessage('m1', { text: 'Отредактировано' });
    expect(apiClient.patch).toHaveBeenCalledWith('/api/v1/chat/messages/m1', { text: 'Отредактировано' });
  });

  test('deleteMessage → DELETE /api/chat/messages/:id', async () => {
    apiClient.delete.mockResolvedValueOnce({ ok: true });
    await chatProvider.deleteMessage('m1');
    expect(apiClient.delete).toHaveBeenCalledWith('/api/v1/chat/messages/m1');
  });

  test('markSeen → POST /api/chat/seen', async () => {
    apiClient.post.mockResolvedValueOnce({});
    await chatProvider.markSeen('u1');
    expect(apiClient.post).toHaveBeenCalledWith('/api/v1/chat/seen', { uid: 'u1' });
  });

  test('getAllHistory — returns first page and hydrates older pages in background', async () => {
    apiClient.get
      .mockResolvedValueOnce({ messages: [{ id: 'm2' }, { id: 'm3' }], hasMore: true })
      .mockResolvedValueOnce({ messages: [{ id: 'm1' }], hasMore: false });

    const onPage = vi.fn();
    const result = await chatProvider.getAllHistory({ onPage });
    expect(result).toEqual([
      expect.objectContaining({ id: 'm2' }),
      expect.objectContaining({ id: 'm3' }),
    ]);

    await Promise.resolve();
    await Promise.resolve();
    expect(onPage).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'm1' }),
      expect.objectContaining({ id: 'm2' }),
      expect.objectContaining({ id: 'm3' }),
    ]);
    expect(apiClient.get).toHaveBeenNthCalledWith(2, '/api/v1/chat/messages?before=m2&limit=60');
  });
});

// ─── requestsProvider ─────────────────────────────────────────────────────────

describe('requestsProvider', () => {
  test('getAll → GET /api/requests, возвращает массив из res.data', async () => {
    apiClient.get.mockResolvedValueOnce({ data: [{ id: 'r1' }], total: 1 });
    const result = await requestsProvider.getAll();
    expect(apiClient.get).toHaveBeenCalledWith('/api/v1/requests?limit=200&page=1');
    expect(result).toEqual([expect.objectContaining({ id: 'r1' })]);
  });

  test('getAll — обратная совместимость с массивом (без data)', async () => {
    apiClient.get.mockResolvedValueOnce([{ id: 'r1' }]);
    const result = await requestsProvider.getAll();
    expect(result).toEqual([expect.objectContaining({ id: 'r1' })]);
  });

  test('getAll — first page immediately, rest in background via onPage', async () => {
    apiClient.get
      .mockResolvedValueOnce({ data: [{ id: 'r1' }], total: 400 })
      .mockResolvedValueOnce({ data: [{ id: 'r2' }], total: 400 });
    const onPage = vi.fn();
    const result = await requestsProvider.getAll({ onPage });
    expect(result).toEqual([expect.objectContaining({ id: 'r1' })]);

    await Promise.resolve();
    await Promise.resolve();
    expect(onPage).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'r1' }),
      expect.objectContaining({ id: 'r2' }),
    ]);
  });

  test('create → POST /api/requests, возвращает serverReq', async () => {
    const req = { type: 'pass', category: 'guest' };
    const serverReq = { id: 'server-uuid', ...req };
    apiClient.post.mockResolvedValueOnce(serverReq);
    const result = await requestsProvider.create(req);
    expect(apiClient.post).toHaveBeenCalledWith(
      '/api/v1/requests',
      req,
      expect.objectContaining({
        retryable: false,
        headers: expect.objectContaining({ 'Idempotency-Key': expect.any(String) }),
      }),
    );
    expect(result.id).toBe('server-uuid');
  });

  test('update → PATCH /api/requests/:id', async () => {
    apiClient.get.mockResolvedValueOnce({ user: { uid: 'guard-1', role: 'security' } });
    apiClient.patch.mockResolvedValueOnce({ id: 'r1', status: 'approved' });
    await requestsProvider.update('r1', { status: 'approved' }, 'Одобрено', 'pending');
    expect(apiClient.patch).toHaveBeenCalledWith('/api/v1/requests/r1', {
      status: 'approved', historyLabel: 'Одобрено', expectedCurrentStatus: 'pending',
    });
    expect(canTransitionOnFrontend).toHaveBeenCalledWith('security', 'pending', 'approved');
  });

  test('delete → DELETE /api/requests/:id', async () => {
    apiClient.delete.mockResolvedValueOnce({ ok: true });
    await requestsProvider.delete('r1');
    expect(apiClient.delete).toHaveBeenCalledWith('/api/v1/requests/r1');
  });

  test('resolvePhotos uploads same-origin blob URLs', async () => {
    const blob = new Blob(['img'], { type: 'image/png' });
    global.fetch = vi.fn().mockResolvedValue({ blob: () => Promise.resolve(blob) });
    apiClient.uploadPhoto.mockResolvedValueOnce({ url: 'https://cdn.example.test/photo.png' });

    const result = await requestsProvider.resolvePhotos('r1', ['blob:https://app.example.test/photo-1']);

    expect(global.fetch).toHaveBeenCalledWith('blob:https://app.example.test/photo-1');
    expect(apiClient.uploadPhoto).toHaveBeenCalledWith(blob);
    expect(result).toEqual(['https://cdn.example.test/photo.png']);
  });

  test('resolvePhotos rejects external photo URLs before fetch', async () => {
    global.fetch = vi.fn();

    const result = await requestsProvider.resolvePhotos('r1', ['https://evil.example.test/photo.png']);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(apiClient.uploadPhoto).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });
});

// ─── usersProvider ────────────────────────────────────────────────────────────

describe('usersProvider', () => {
  test('getAll → GET /api/users', async () => {
    apiClient.get.mockResolvedValueOnce([]);
    await usersProvider.getAll();
    expect(apiClient.get).toHaveBeenCalledWith('/api/v1/users');
  });

  test('update → PATCH /api/users/:uid', async () => {
    apiClient.patch.mockResolvedValueOnce({ uid: 'u1' });
    await usersProvider.update('u1', { name: 'Новое' });
    expect(apiClient.patch).toHaveBeenCalledWith('/api/v1/users/u1', { name: 'Новое' });
  });

  test('delete → DELETE /api/users/:uid', async () => {
    apiClient.delete.mockResolvedValueOnce({ ok: true });
    await usersProvider.delete('u1');
    expect(apiClient.delete).toHaveBeenCalledWith('/api/v1/users/u1');
  });
});

// ─── permsProvider ────────────────────────────────────────────────────────────

describe('permsProvider', () => {
  test('getPerms → GET /api/perms/:uid', async () => {
    apiClient.get.mockResolvedValueOnce({ visitors: [], workers: [] });
    await permsProvider.getPerms('u1');
    expect(apiClient.get).toHaveBeenCalledWith('/api/v1/perms/u1');
  });

  test('savePerms → POST /api/perms/batch (object format: atomic batch save)', async () => {
    apiClient.post.mockResolvedValue({ ok: true });
    const permsObj = { visitors: [{ id: 'p1', name: 'Гость' }], workers: [{ id: 'p2', name: 'Рабочий' }] };
    await permsProvider.savePerms('u1', permsObj);
    expect(apiClient.post).toHaveBeenCalledWith('/api/v1/perms/batch', {
      uid: 'u1',
      visitors: permsObj.visitors,
      workers:  permsObj.workers,
    });
  });

  test('savePerms → POST /api/perms (legacy flat array format)', async () => {
    apiClient.post.mockResolvedValueOnce({ ok: true });
    const items = [{ id: 'p1', name: 'Гость' }];
    await permsProvider.savePerms('u1', items);
    expect(apiClient.post).toHaveBeenCalledWith('/api/v1/perms', { uid: 'u1', type: 'visitors', items });
  });

  test('getTemplates → GET /api/templates/:uid', async () => {
    apiClient.get.mockResolvedValueOnce([]);
    await permsProvider.getTemplates('u1');
    expect(apiClient.get).toHaveBeenCalledWith('/api/v1/templates/u1');
  });

  test('saveTemplates → POST /api/templates', async () => {
    apiClient.post.mockResolvedValueOnce({ ok: true });
    const items = [{ id: 't1', name: 'Шаблон' }];
    await permsProvider.saveTemplates('u1', items);
    expect(apiClient.post).toHaveBeenCalledWith('/api/v1/templates', { uid: 'u1', items });
  });
});

// ─── blacklistProvider ────────────────────────────────────────────────────────

describe('blacklistProvider', () => {
  test('getAll → GET /api/blacklist', async () => {
    apiClient.get.mockResolvedValueOnce([]);
    await blacklistProvider.getAll();
    expect(apiClient.get).toHaveBeenCalledWith('/api/v1/blacklist');
  });

  test('add → POST /api/blacklist', async () => {
    apiClient.post.mockResolvedValueOnce({ id: 'bl1' });
    const entry = { name: 'Нарушитель', reason: 'Дебош' };
    await blacklistProvider.add(entry);
    expect(apiClient.post).toHaveBeenCalledWith('/api/v1/blacklist', entry);
  });

  test('remove → DELETE /api/blacklist/:id', async () => {
    apiClient.delete.mockResolvedValueOnce({ ok: true });
    await blacklistProvider.remove('bl1');
    expect(apiClient.delete).toHaveBeenCalledWith('/api/v1/blacklist/bl1');
  });
});

describe('visitLogsProvider', () => {
  test('getAll fetches all pages when backend paginates audit log', async () => {
    apiClient.get
      .mockResolvedValueOnce({ data: [{ id: 'v1' }], total: 150, page: 1, limit: 100 })
      .mockResolvedValueOnce({ data: [{ id: 'v2' }], total: 150, page: 2, limit: 100 });

    const result = await visitLogsProvider.getAll();

    expect(apiClient.get).toHaveBeenNthCalledWith(1, '/api/v1/visit-logs?page=1&limit=100');
    expect(apiClient.get).toHaveBeenNthCalledWith(2, '/api/v1/visit-logs?page=2&limit=100');
    expect(result.total).toBe(150);
    expect(result.data).toEqual([{ id: 'v1' }, { id: 'v2' }]);
  });
});

// ─── createBackendProvider ────────────────────────────────────────────────────

describe('createBackendProvider', () => {
  test('возвращает объект с нужными разделами', () => {
    const p = createBackendProvider();
    expect(p.provider).toBe('backend');
    expect(typeof p.auth.sendOtp).toBe('function');
    expect(typeof p.requests.submit).toBe('function');
    expect(typeof p.requests.updateEverywhere).toBe('function');
    expect(typeof p.requests.deleteEverywhere).toBe('function');
    expect(typeof p.admin.savePermsEverywhere).toBe('function');
    expect(typeof p.admin.saveUserEverywhere).toBe('function');
    expect(typeof p.admin.removeUserEverywhere).toBe('function');
    expect(typeof p.liveData.startSync).toBe('function');
  });

  test('requests.submit вызывает requestsProvider.create', async () => {
    const p = createBackendProvider();
    apiClient.post.mockResolvedValueOnce({ id: 'srv-1', type: 'pass' });
    await p.requests.submit({ request: { type: 'pass' } });
    expect(apiClient.post).toHaveBeenCalledWith(
      '/api/v1/requests',
      { type: 'pass' },
      expect.objectContaining({
        retryable: false,
        headers: expect.objectContaining({ 'Idempotency-Key': expect.any(String) }),
      }),
    );
  });

  test('admin.saveUserEverywhere вызывает PATCH /api/users/:uid', async () => {
    const p = createBackendProvider();
    apiClient.patch.mockResolvedValueOnce({ uid: 'u1' });
    await p.admin.saveUserEverywhere({ uid: 'u1', patch: { name: 'Новое' } });
    expect(apiClient.patch).toHaveBeenCalledWith('/api/v1/users/u1', { name: 'Новое' });
  });

  test('admin.removeUserEverywhere вызывает DELETE /api/users/:uid', async () => {
    const p = createBackendProvider();
    apiClient.delete.mockResolvedValueOnce({ ok: true });
    await p.admin.removeUserEverywhere({ uid: 'u1' });
    expect(apiClient.delete).toHaveBeenCalledWith('/api/v1/users/u1');
  });
});
