import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../utils', () => ({
  sendNotif: vi.fn(),
}));

vi.mock('../constants', () => ({
  CAT_LABEL: {
    guest: 'Гость',
    courier: 'Курьер',
    plumber: 'Сантехник',
  },
}));

vi.mock('./http/apiClient', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

import { sendNotif } from '../utils';
import { apiClient } from './http/apiClient';
import { pushNotifyResident, subscribePush, unsubscribePush } from './pushNotification';

// Minimal valid base64url VAPID public key (65 raw bytes, uncompressed P-256 point)
const FAKE_VAPID_KEY = 'BHk9sT_' + 'A'.repeat(80);

beforeEach(() => vi.clearAllMocks());

describe('pushNotifyResident', () => {
  const baseReq = {
    id: 'req-1',
    category: 'guest',
    visitorName: 'Иван Петров',
    createdByApt: '12',
  };

  test('вызывает sendNotif один раз', () => {
    pushNotifyResident(baseReq);
    expect(sendNotif).toHaveBeenCalledTimes(1);
  });

  test('использует visitorName если задан', () => {
    pushNotifyResident(baseReq);
    const [title, body] = sendNotif.mock.calls[0];
    expect(title).toBe('🚪 Ваш гость вошёл');
    expect(body).toContain('Иван Петров');
  });

  test('использует CAT_LABEL если visitorName не задан', () => {
    pushNotifyResident({ ...baseReq, visitorName: null });
    const [, body] = sendNotif.mock.calls[0];
    expect(body).toContain('Гость');
  });

  test('использует CAT_LABEL для категории courier если имя пустое', () => {
    pushNotifyResident({ ...baseReq, category: 'courier', visitorName: '' });
    const [, body] = sendNotif.mock.calls[0];
    expect(body).toContain('Курьер');
  });

  test('включает апартамент в body если задан', () => {
    pushNotifyResident(baseReq);
    const [, body] = sendNotif.mock.calls[0];
    expect(body).toContain('12');
  });

  test('не включает апартамент если createdByApt = "—"', () => {
    pushNotifyResident({ ...baseReq, createdByApt: '—' });
    const [, body] = sendNotif.mock.calls[0];
    expect(body).not.toContain('апарт.');
  });

  test('не включает апартамент если createdByApt null', () => {
    pushNotifyResident({ ...baseReq, createdByApt: null });
    const [, body] = sendNotif.mock.calls[0];
    expect(body).not.toContain('апарт.');
  });

  test('tag содержит id заявки', () => {
    pushNotifyResident(baseReq);
    const tag = sendNotif.mock.calls[0][2];
    expect(tag).toContain('req-1');
  });

  test('body содержит время в формате ЧЧ:ММ', () => {
    pushNotifyResident(baseReq);
    const [, body] = sendNotif.mock.calls[0];
    expect(body).toMatch(/\d{2}:\d{2}/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// subscribePush — Web Push (VAPID) subscription flow
// ─────────────────────────────────────────────────────────────────────────────

describe('subscribePush', () => {
  let origNotification;
  let origServiceWorker;
  let origLocalStorage;

  function makeSubscription(opts = {}) {
    const p256dh = opts.p256dh ?? new Uint8Array([1, 2, 3]).buffer;
    const auth = opts.auth ?? new Uint8Array([4, 5, 6]).buffer;
    return {
      endpoint: opts.endpoint ?? 'https://push.example/abc',
      getKey: vi.fn((name: string) => {
        if (name === 'p256dh') return p256dh;
        if (name === 'auth') return auth;
        return null;
      }),
      unsubscribe: vi.fn().mockResolvedValue(true),
    };
  }

  function installServiceWorker({ existing = null, subscribeResult } = {}) {
    const pushManager = {
      getSubscription: vi.fn().mockResolvedValue(existing),
      subscribe: vi.fn().mockResolvedValue(subscribeResult ?? makeSubscription()),
    };
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { ready: Promise.resolve({ pushManager }) },
      configurable: true,
    });
    return pushManager;
  }

  beforeEach(() => {
    origNotification = global.Notification;
    origServiceWorker = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');

    const store: Record<string, string> = {};
    origLocalStorage = global.localStorage;
    Object.defineProperty(global, 'localStorage', {
      value: {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => { store[k] = v; },
        removeItem: (k: string) => { delete store[k]; },
        clear: () => { Object.keys(store).forEach(k => delete store[k]); },
      },
      configurable: true,
    });
  });

  afterEach(() => {
    global.Notification = origNotification;
    if (origServiceWorker) {
      Object.defineProperty(navigator, 'serviceWorker', origServiceWorker);
    } else {
      // @ts-expect-error — property is configurable
      delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker;
    }
    if (origLocalStorage) {
      Object.defineProperty(global, 'localStorage', { value: origLocalStorage, configurable: true });
    }
  });

  test('ничего не делает если Notification недоступен', async () => {
    delete (global as unknown as { Notification?: unknown }).Notification;
    await expect(subscribePush()).resolves.toBeUndefined();
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  test('ничего не делает если разрешение denied', async () => {
    global.Notification = { permission: 'denied', requestPermission: vi.fn() };
    await subscribePush();
    expect(global.Notification.requestPermission).not.toHaveBeenCalled();
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  test('не падает если пользователь отклонил разрешение', async () => {
    global.Notification = {
      permission: 'default',
      requestPermission: vi.fn().mockResolvedValue('denied'),
    };
    installServiceWorker();
    await expect(subscribePush()).resolves.toBeUndefined();
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  test('ничего не шлёт если backend не вернул VAPID-ключ', async () => {
    global.Notification = { permission: 'granted', requestPermission: vi.fn() };
    installServiceWorker();
    vi.mocked(apiClient.get).mockResolvedValue({ key: null });
    await subscribePush();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  test('создаёт подписку и регистрирует её на backend', async () => {
    global.Notification = { permission: 'granted', requestPermission: vi.fn() };
    const pushManager = installServiceWorker();
    vi.mocked(apiClient.get).mockResolvedValue({ key: FAKE_VAPID_KEY });
    vi.mocked(apiClient.post).mockResolvedValue({ subscription: { id: 'sub-uuid-1' } });

    await subscribePush();

    expect(apiClient.get).toHaveBeenCalledWith('/api/v1/push-subscriptions/vapid-public-key');
    expect(pushManager.subscribe).toHaveBeenCalledWith(expect.objectContaining({
      userVisibleOnly: true,
      applicationServerKey: expect.any(Uint8Array),
    }));
    expect(apiClient.post).toHaveBeenCalledWith(
      '/api/v1/push-subscriptions',
      expect.objectContaining({
        endpoint: 'https://push.example/abc',
        keys: expect.objectContaining({
          p256dh: expect.any(String),
          auth: expect.any(String),
        }),
        deviceName: expect.any(String),
      }),
    );
    expect(localStorage.getItem('push.subscriptionId')).toBe('sub-uuid-1');
  });

  test('переиспользует существующую подписку вместо повторной', async () => {
    global.Notification = { permission: 'granted', requestPermission: vi.fn() };
    const existing = makeSubscription({ endpoint: 'https://push.example/existing' });
    const pushManager = installServiceWorker({ existing });
    vi.mocked(apiClient.get).mockResolvedValue({ key: FAKE_VAPID_KEY });
    vi.mocked(apiClient.post).mockResolvedValue({ subscription: { id: 'sub-uuid-2' } });

    await subscribePush();

    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(apiClient.post).toHaveBeenCalledWith(
      '/api/v1/push-subscriptions',
      expect.objectContaining({ endpoint: 'https://push.example/existing' }),
    );
  });

  test('не падает при ошибке сети', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    global.Notification = { permission: 'granted', requestPermission: vi.fn() };
    installServiceWorker();
    vi.mocked(apiClient.get).mockRejectedValue(new Error('network'));

    await expect(subscribePush()).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// unsubscribePush — opt-out
// ─────────────────────────────────────────────────────────────────────────────

describe('unsubscribePush', () => {
  let origServiceWorker;

  function makeSubscription() {
    return {
      endpoint: 'https://push.example/abc',
      unsubscribe: vi.fn().mockResolvedValue(true),
    };
  }

  function installServiceWorker(subscription) {
    const pushManager = { getSubscription: vi.fn().mockResolvedValue(subscription) };
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { ready: Promise.resolve({ pushManager }) },
      configurable: true,
    });
    return pushManager;
  }

  beforeEach(() => {
    origServiceWorker = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
    const store: Record<string, string> = { 'push.subscriptionId': 'sub-to-delete' };
    Object.defineProperty(global, 'localStorage', {
      value: {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => { store[k] = v; },
        removeItem: (k: string) => { delete store[k]; },
        clear: () => { Object.keys(store).forEach(k => delete store[k]); },
      },
      configurable: true,
    });
  });

  afterEach(() => {
    if (origServiceWorker) {
      Object.defineProperty(navigator, 'serviceWorker', origServiceWorker);
    } else {
      delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker;
    }
  });

  test('вызывает backend DELETE и сносит браузерную подписку', async () => {
    const subscription = makeSubscription();
    installServiceWorker(subscription);
    vi.mocked(apiClient.delete).mockResolvedValue(undefined);

    await unsubscribePush();

    expect(apiClient.delete).toHaveBeenCalledWith('/api/v1/push-subscriptions/sub-to-delete');
    expect(subscription.unsubscribe).toHaveBeenCalled();
    expect(localStorage.getItem('push.subscriptionId')).toBeNull();
  });

  test('не падает если backend DELETE упал', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const subscription = makeSubscription();
    installServiceWorker(subscription);
    vi.mocked(apiClient.delete).mockRejectedValue(new Error('500'));

    await expect(unsubscribePush()).resolves.toBeUndefined();
    expect(subscription.unsubscribe).toHaveBeenCalled(); // still cleans up browser side
    warnSpy.mockRestore();
  });

  test('не падает если подписки не было', async () => {
    installServiceWorker(null);
    await expect(unsubscribePush()).resolves.toBeUndefined();
  });
});
