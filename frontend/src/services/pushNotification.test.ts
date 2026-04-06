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
    origNotification = (global as any).Notification;
  });

  afterEach(() => {
    (global as any).Notification = origNotification;
  });

  test('ничего не делает если Notification недоступен', async () => {
    Object.defineProperty(global, 'Notification', { value: undefined, configurable: true });
    await expect(subscribePush()).resolves.toBeUndefined();
  });

  test('ничего не делает если разрешение denied', async () => {
    (global as any).Notification = { permission: 'denied', requestPermission: vi.fn((..._args: any[]) => Promise.resolve('denied')) };
    await subscribePush();
    expect((global as any).Notification.requestPermission).not.toHaveBeenCalled();
  });

  test('запрашивает разрешение если default', async () => {
    const mockShowNotification = vi.fn();
    const mockReady = Promise.resolve({ showNotification: mockShowNotification });
    const mockRequestPermission = vi.fn().mockResolvedValue('granted');

    (global as any).Notification = { permission: 'default', requestPermission: mockRequestPermission };
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { ready: mockReady },
      configurable: true,
    });

    await subscribePush();
    expect(mockRequestPermission).toHaveBeenCalled();
  });

  test('не падает при отклонении разрешения', async () => {
    (global as any).Notification = {
      permission: 'default',
      requestPermission: vi.fn((..._args: any[]) => Promise.resolve('denied')),
    };
    await expect(subscribePush()).resolves.toBeUndefined();
  });

  test('не падает при ошибке SW', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    (global as any).Notification = {
      permission: 'default',
      requestPermission: vi.fn((..._args: any[]) => Promise.reject(new Error('SW error'))),
    };
    await expect(subscribePush()).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith('[push] subscribe failed:', expect.any(Error));
    warnSpy.mockRestore();
  });
});
