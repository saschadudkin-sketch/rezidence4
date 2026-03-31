/**
 * services/pushNotification.test.js
 * Покрывает: pushNotifyResident, subscribePush
 */

jest.mock('../utils', () => ({
  sendNotif: jest.fn(),
}));
jest.mock('../constants', () => ({
  CAT_LABEL: {
    guest:   'Гость',
    courier: 'Курьер',
    plumber: 'Сантехник',
  },
}));

import { sendNotif } from '../utils.js';
import { pushNotifyResident, subscribePush } from './pushNotification';

beforeEach(() => jest.clearAllMocks());

// ─── pushNotifyResident ───────────────────────────────────────────────────────

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

// ─── subscribePush ────────────────────────────────────────────────────────────

describe('subscribePush', () => {
  let origNotification;

  beforeEach(() => {
    origNotification = global.Notification;
  });

  afterEach(() => {
    global.Notification = origNotification;
  });

  test('ничего не делает если Notification недоступен', async () => {
    delete global.Notification;
    await expect(subscribePush('u1')).resolves.toBeUndefined();
  });

  test('ничего не делает если разрешение denied', async () => {
    global.Notification = { permission: 'denied', requestPermission: jest.fn() };
    await subscribePush('u1');
    expect(global.Notification.requestPermission).not.toHaveBeenCalled();
  });

  test('запрашивает разрешение если default', async () => {
    const mockShowNotification = jest.fn();
    const mockReady = Promise.resolve({ showNotification: mockShowNotification });
    const mockRequestPermission = jest.fn().mockResolvedValue('granted');

    global.Notification = { permission: 'default', requestPermission: mockRequestPermission };
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { ready: mockReady },
      configurable: true,
    });

    await subscribePush('u1');
    expect(mockRequestPermission).toHaveBeenCalled();
  });

  test('не падает при отклонении разрешения', async () => {
    global.Notification = {
      permission: 'default',
      requestPermission: jest.fn().mockResolvedValue('denied'),
    };
    await expect(subscribePush('u1')).resolves.toBeUndefined();
  });

  test('не падает при ошибке SW', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    global.Notification = {
      permission: 'default',
      requestPermission: jest.fn().mockRejectedValue(new Error('SW error')),
    };
    await expect(subscribePush('u1')).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith('[push] subscribe failed:', expect.any(Error));
    warnSpy.mockRestore();
  });
});
