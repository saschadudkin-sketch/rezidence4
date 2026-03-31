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

import apiClient from './apiClient';
import {
  authProvider,
  chatProvider,
  requestsProvider,
  usersProvider,
  permsProvider,
  blacklistProvider,
  createBackendProvider,
} from './backendProvider.js';

beforeEach(() => vi.clearAllMocks());

// ─── authProvider ─────────────────────────────────────────────────────────────

describe('authProvider', () => {
  test('sendOtp → POST /api/auth/send-otp', async () => {
    apiClient.post.mockResolvedValueOnce({});
    await authProvider.sendOtp('+79001234567');
    expect(apiClient.post).toHaveBeenCalledWith('/api/auth/send-otp', { phone: '+79001234567' });
  });

  test('verifyOtp → POST /api/auth/verify-otp, возвращает user', async () => {
    const user = { uid: 'u1', role: 'owner' };
    apiClient.post.mockResolvedValueOnce({ user });
    const result = await authProvider.verifyOtp('+79001234567', '123456');
    expect(apiClient.post).toHaveBeenCalledWith('/api/auth/verify-otp', {
      phone: '+79001234567', code: '123456',
    });
    expect(result).toEqual(user);
  });

  test('getMe → GET /api/auth/me, возвращает user', async () => {
    const user = { uid: 'u1', role: 'owner' };
    apiClient.get.mockResolvedValueOnce({ user });
    const result = await authProvider.getMe();
    expect(apiClient.get).toHaveBeenCalledWith('/api/auth/me');
    expect(result).toEqual(user);
  });

  test('logout → POST /api/auth/logout', async () => {
    apiClient.post.mockResolvedValueOnce({});
    await authProvider.logout();
    expect(apiClient.post).toHaveBeenCalledWith('/api/auth/logout');
  });
});

// ─── chatProvider ─────────────────────────────────────────────────────────────

describe('chatProvider', () => {
  test('getMessages без параметров → GET /api/chat/messages', async () => {
    apiClient.get.mockResolvedValueOnce({ messages: [], hasMore: false });
    const result = await chatProvider.getMessages();
    expect(apiClient.get).toHaveBeenCalledWith('/api/chat/messages');
    expect(result).toEqual({ messages: [], hasMore: false });
  });

  test('getMessages с before → добавляет ?before=<id> в URL', async () => {
    apiClient.get.mockResolvedValueOnce({ messages: [], hasMore: false });
    await chatProvider.getMessages({ before: 'msg-123' });
    expect(apiClient.get).toHaveBeenCalledWith('/api/chat/messages?before=msg-123');
  });

  test('getMessages с limit → добавляет ?limit=N в URL', async () => {
    apiClient.get.mockResolvedValueOnce({ messages: [], hasMore: false });
    await chatProvider.getMessages({ limit: 30 });
    expect(apiClient.get).toHaveBeenCalledWith('/api/chat/messages?limit=30');
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
    expect(apiClient.post).toHaveBeenCalledWith('/api/chat/messages', msg);
  });

  test('updateMessage → PATCH /api/chat/messages/:id', async () => {
    apiClient.patch.mockResolvedValueOnce({});
    await chatProvider.updateMessage('m1', { text: 'Отредактировано' });
    expect(apiClient.patch).toHaveBeenCalledWith('/api/chat/messages/m1', { text: 'Отредактировано' });
  });

  test('deleteMessage → DELETE /api/chat/messages/:id', async () => {
    apiClient.delete.mockResolvedValueOnce({ ok: true });
    await chatProvider.deleteMessage('m1');
    expect(apiClient.delete).toHaveBeenCalledWith('/api/chat/messages/m1');
  });

  test('markSeen → POST /api/chat/seen', async () => {
    apiClient.post.mockResolvedValueOnce({});
    await chatProvider.markSeen('u1');
    expect(apiClient.post).toHaveBeenCalledWith('/api/chat/seen', { uid: 'u1' });
  });
});

// ─── requestsProvider ─────────────────────────────────────────────────────────

describe('requestsProvider', () => {
  test('getAll → GET /api/requests, возвращает массив из res.data', async () => {
    apiClient.get.mockResolvedValueOnce({ data: [{ id: 'r1' }], total: 1 });
    const result = await requestsProvider.getAll();
    expect(apiClient.get).toHaveBeenCalledWith('/api/requests?limit=200&page=1');
    expect(result).toEqual([{ id: 'r1' }]);
  });

  test('getAll — обратная совместимость с массивом (без data)', async () => {
    apiClient.get.mockResolvedValueOnce([{ id: 'r1' }]);
    const result = await requestsProvider.getAll();
    expect(result).toEqual([{ id: 'r1' }]);
  });

  test('create → POST /api/requests, возвращает serverReq', async () => {
    const req = { type: 'pass', category: 'guest' };
    const serverReq = { id: 'server-uuid', ...req };
    apiClient.post.mockResolvedValueOnce(serverReq);
    const result = await requestsProvider.create(req);
    expect(apiClient.post).toHaveBeenCalledWith(
      '/api/requests',
      req,
      expect.objectContaining({ headers: expect.objectContaining({ 'Idempotency-Key': expect.any(String) }) }),
    );
    expect(result.id).toBe('server-uuid');
  });

  test('update → PATCH /api/requests/:id', async () => {
    apiClient.patch.mockResolvedValueOnce({ id: 'r1', status: 'approved' });
    await requestsProvider.update('r1', { status: 'approved' }, 'Одобрено');
    expect(apiClient.patch).toHaveBeenCalledWith('/api/requests/r1', {
      status: 'approved', historyLabel: 'Одобрено',
    });
  });

  test('delete → DELETE /api/requests/:id', async () => {
    apiClient.delete.mockResolvedValueOnce({ ok: true });
    await requestsProvider.delete('r1');
    expect(apiClient.delete).toHaveBeenCalledWith('/api/requests/r1');
  });
});

// ─── usersProvider ────────────────────────────────────────────────────────────

describe('usersProvider', () => {
  test('getAll → GET /api/users', async () => {
    apiClient.get.mockResolvedValueOnce([]);
    await usersProvider.getAll();
    expect(apiClient.get).toHaveBeenCalledWith('/api/users');
  });

  test('update → PATCH /api/users/:uid', async () => {
    apiClient.patch.mockResolvedValueOnce({ uid: 'u1' });
    await usersProvider.update('u1', { name: 'Новое' });
    expect(apiClient.patch).toHaveBeenCalledWith('/api/users/u1', { name: 'Новое' });
  });

  test('delete → DELETE /api/users/:uid', async () => {
    apiClient.delete.mockResolvedValueOnce({ ok: true });
    await usersProvider.delete('u1');
    expect(apiClient.delete).toHaveBeenCalledWith('/api/users/u1');
  });
});

// ─── permsProvider ────────────────────────────────────────────────────────────

describe('permsProvider', () => {
  test('getPerms → GET /api/perms/:uid', async () => {
    apiClient.get.mockResolvedValueOnce({ visitors: [], workers: [] });
    await permsProvider.getPerms('u1');
    expect(apiClient.get).toHaveBeenCalledWith('/api/perms/u1');
  });

  test('savePerms → POST /api/perms (object format: splits into per-type requests)', async () => {
    apiClient.post.mockResolvedValue({ ok: true });
    const permsObj = { visitors: [{ id: 'p1', name: 'Гость' }], workers: [{ id: 'p2', name: 'Рабочий' }] };
    await permsProvider.savePerms('u1', permsObj);
    expect(apiClient.post).toHaveBeenCalledWith('/api/perms', { uid: 'u1', type: 'visitors', items: permsObj.visitors });
    expect(apiClient.post).toHaveBeenCalledWith('/api/perms', { uid: 'u1', type: 'workers', items: permsObj.workers });
  });

  test('savePerms → POST /api/perms (legacy flat array format)', async () => {
    apiClient.post.mockResolvedValueOnce({ ok: true });
    const items = [{ id: 'p1', name: 'Гость' }];
    await permsProvider.savePerms('u1', items);
    expect(apiClient.post).toHaveBeenCalledWith('/api/perms', { uid: 'u1', type: 'visitors', items });
  });

  test('getTemplates → GET /api/templates/:uid', async () => {
    apiClient.get.mockResolvedValueOnce([]);
    await permsProvider.getTemplates('u1');
    expect(apiClient.get).toHaveBeenCalledWith('/api/templates/u1');
  });

  test('saveTemplates → POST /api/templates', async () => {
    apiClient.post.mockResolvedValueOnce({ ok: true });
    const items = [{ id: 't1', name: 'Шаблон' }];
    await permsProvider.saveTemplates('u1', items);
    expect(apiClient.post).toHaveBeenCalledWith('/api/templates', { uid: 'u1', items });
  });
});

// ─── blacklistProvider ────────────────────────────────────────────────────────

describe('blacklistProvider', () => {
  test('getAll → GET /api/blacklist', async () => {
    apiClient.get.mockResolvedValueOnce([]);
    await blacklistProvider.getAll();
    expect(apiClient.get).toHaveBeenCalledWith('/api/blacklist');
  });

  test('add → POST /api/blacklist', async () => {
    apiClient.post.mockResolvedValueOnce({ id: 'bl1' });
    const entry = { name: 'Нарушитель', reason: 'Дебош' };
    await blacklistProvider.add(entry);
    expect(apiClient.post).toHaveBeenCalledWith('/api/blacklist', entry);
  });

  test('remove → DELETE /api/blacklist/:id', async () => {
    apiClient.delete.mockResolvedValueOnce({ ok: true });
    await blacklistProvider.remove('bl1');
    expect(apiClient.delete).toHaveBeenCalledWith('/api/blacklist/bl1');
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
      '/api/requests',
      { type: 'pass' },
      expect.objectContaining({ headers: expect.objectContaining({ 'Idempotency-Key': expect.any(String) }) }),
    );
  });

  test('admin.saveUserEverywhere вызывает PATCH /api/users/:uid', async () => {
    const p = createBackendProvider();
    apiClient.patch.mockResolvedValueOnce({ uid: 'u1' });
    await p.admin.saveUserEverywhere({ uid: 'u1', patch: { name: 'Новое' } });
    expect(apiClient.patch).toHaveBeenCalledWith('/api/users/u1', { name: 'Новое' });
  });

  test('admin.removeUserEverywhere вызывает DELETE /api/users/:uid', async () => {
    const p = createBackendProvider();
    apiClient.delete.mockResolvedValueOnce({ ok: true });
    await p.admin.removeUserEverywhere({ uid: 'u1' });
    expect(apiClient.delete).toHaveBeenCalledWith('/api/users/u1');
  });
});
