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

import { sendNotif } from '../utils';
import { pushNotifyResident, subscribePush } from './pushNotification';

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

describe('subscribePush', () => {
  let origNotification;

  beforeEach(() => {
    origNotification = window.Notification;
  });

  afterEach(() => {
    Object.defineProperty(window, 'Notification', {
      value: origNotification,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'Notification', {
      value: origNotification,
      configurable: true,
      writable: true,
    });
  });

  test('ничего не делает если Notification недоступен', async () => {
    Object.defineProperty(window, 'Notification', { value: undefined, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'Notification', { value: undefined, configurable: true, writable: true });
    await expect(subscribePush()).resolves.toBeUndefined();
  });

  test('ничего не делает если разрешение denied', async () => {
    const mockNotification = { permission: 'denied', requestPermission: vi.fn((..._args: any[]) => Promise.resolve('denied')) };
    Object.defineProperty(window, 'Notification', { value: mockNotification, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'Notification', { value: mockNotification, configurable: true, writable: true });
    await subscribePush();
    expect(mockNotification.requestPermission).not.toHaveBeenCalled();
  });

  test('запрашивает разрешение если default', async () => {
    const mockShowNotification = vi.fn();
    const mockReady = Promise.resolve({ showNotification: mockShowNotification });
    const mockRequestPermission = vi.fn().mockResolvedValue('granted');

    const mockNotification = { permission: 'default', requestPermission: mockRequestPermission };
    Object.defineProperty(window, 'Notification', { value: mockNotification, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'Notification', { value: mockNotification, configurable: true, writable: true });
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { ready: mockReady },
      configurable: true,
    });

    await subscribePush();
    expect(mockRequestPermission).toHaveBeenCalled();
  });

  test('не падает при отклонении разрешения', async () => {
    const mockNotification = {
      permission: 'default',
      requestPermission: vi.fn((..._args: any[]) => Promise.resolve('denied')),
    };
    Object.defineProperty(window, 'Notification', { value: mockNotification, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'Notification', { value: mockNotification, configurable: true, writable: true });
    await expect(subscribePush()).resolves.toBeUndefined();
  });

  test('не падает при ошибке SW', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mockNotification = {
      permission: 'default',
      requestPermission: vi.fn((..._args: any[]) => Promise.reject(new Error('SW error'))),
    };
    Object.defineProperty(window, 'Notification', { value: mockNotification, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'Notification', { value: mockNotification, configurable: true, writable: true });
    await expect(subscribePush()).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith('[push] subscribe failed:', expect.any(Error));
    warnSpy.mockRestore();
  });
});
