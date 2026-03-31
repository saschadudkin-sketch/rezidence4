/**
 * utils/notifUtils.test.js
 * Покрывает: requestNotifPerm, sendNotif, playAlert
 * Все браузерные API (Notification, AudioContext) мокированы
 */

// Мокируем swUtils чтобы управлять getSwReg
jest.mock('./swUtils', () => ({ getSwReg: jest.fn(() => null) }));

import { getSwReg } from './swUtils.js';
import { requestNotifPerm, sendNotif } from './notifUtils';

// ─── requestNotifPerm ─────────────────────────────────────────────────────────

describe('requestNotifPerm', () => {
  let origNotification;

  beforeEach(() => {
    origNotification = global.Notification;
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.Notification = origNotification;
  });

  it('запрашивает разрешение если permission === "default"', () => {
    const mockRequest = jest.fn();
    global.Notification = { permission: 'default', requestPermission: mockRequest };
    requestNotifPerm();
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('не запрашивает если permission уже "granted"', () => {
    const mockRequest = jest.fn();
    global.Notification = { permission: 'granted', requestPermission: mockRequest };
    requestNotifPerm();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('не запрашивает если permission "denied"', () => {
    const mockRequest = jest.fn();
    global.Notification = { permission: 'denied', requestPermission: mockRequest };
    requestNotifPerm();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('не падает если Notification недоступен', () => {
    delete global.Notification;
    expect(() => requestNotifPerm()).not.toThrow();
  });
});

// ─── sendNotif ────────────────────────────────────────────────────────────────

describe('sendNotif', () => {
  let origNotification;

  beforeEach(() => {
    origNotification = global.Notification;
    jest.clearAllMocks();
    getSwReg.mockReturnValue(null);
  });

  afterEach(() => {
    global.Notification = origNotification;
  });

  it('ничего не делает если Notification недоступен', () => {
    delete global.Notification;
    expect(() => sendNotif('Заголовок', 'Текст')).not.toThrow();
  });

  it('ничего не делает если permission !== "granted"', () => {
    const mockCtor = jest.fn();
    global.Notification = Object.assign(mockCtor, { permission: 'default' });
    sendNotif('Заголовок', 'Текст');
    expect(mockCtor).not.toHaveBeenCalled();
  });

  it('создаёт Notification напрямую если нет SW', () => {
    const mockCtor = jest.fn();
    global.Notification = Object.assign(mockCtor, { permission: 'granted' });
    getSwReg.mockReturnValue(null);
    sendNotif('Заголовок', 'Текст', 'test-tag');
    expect(mockCtor).toHaveBeenCalledWith('Заголовок', { body: 'Текст', icon: '/logo192.png' });
  });

  it('использует SW.showNotification если SW доступен', () => {
    const mockShowNotification = jest.fn();
    const mockSWReg = { showNotification: mockShowNotification };
    const mockCtor = jest.fn();
    global.Notification = Object.assign(mockCtor, { permission: 'granted' });
    getSwReg.mockReturnValue(mockSWReg);

    sendNotif('Заголовок', 'Тело', 'tag-1');

    expect(mockShowNotification).toHaveBeenCalledTimes(1);
    const [title, opts] = mockShowNotification.mock.calls[0];
    expect(title).toBe('Заголовок');
    expect(opts.body).toBe('Тело');
    expect(opts.tag).toBe('tag-1');
    expect(opts.renotify).toBe(true);
    // Прямой Notification создаваться не должен
    expect(mockCtor).not.toHaveBeenCalled();
  });

  it('использует "default" как tag если не передан', () => {
    const mockShowNotification = jest.fn();
    global.Notification = Object.assign(jest.fn(), { permission: 'granted' });
    getSwReg.mockReturnValue({ showNotification: mockShowNotification });
    sendNotif('T', 'B');
    expect(mockShowNotification.mock.calls[0][1].tag).toBe('default');
  });
});

// ─── playAlert ────────────────────────────────────────────────────────────────

describe('playAlert', () => {
  let origAudioContext;
  let origWebkitAudioContext;
  let playAlertFresh;

  beforeEach(() => {
    origAudioContext = global.AudioContext;
    origWebkitAudioContext = global.webkitAudioContext;
    jest.clearAllMocks();
    jest.resetModules();
    jest.isolateModules(() => {
      ({ playAlert: playAlertFresh } = require('./notifUtils'));
    });
  });

  afterEach(() => {
    global.AudioContext = origAudioContext;
    global.webkitAudioContext = origWebkitAudioContext;
  });

  it('не падает если AudioContext недоступен', () => {
    delete global.AudioContext;
    delete global.webkitAudioContext;
    expect(() => playAlertFresh('pass')).not.toThrow();
  });

  it('не падает при вызове с типом "pass"', () => {
    const mockCtx = {
      state: 'running',
      currentTime: 0,
      destination: {},
      createOscillator: jest.fn(() => ({
        connect: jest.fn(),
        start: jest.fn(),
        stop: jest.fn(),
        frequency: { value: 0 },
        type: 'sine',
      })),
      createGain: jest.fn(() => ({
        connect: jest.fn(),
        gain: { setValueAtTime: jest.fn(), linearRampToValueAtTime: jest.fn(), exponentialRampToValueAtTime: jest.fn() },
      })),
      resume: jest.fn(),
    };
    global.AudioContext = jest.fn(() => mockCtx);

    expect(() => playAlertFresh('pass')).not.toThrow();
    expect(mockCtx.createOscillator).toHaveBeenCalledTimes(3); // 3 ноты
  });

  it('не падает при вызове с типом "tech"', () => {
    const mockCtx = {
      state: 'running',
      currentTime: 0,
      destination: {},
      createOscillator: jest.fn(() => ({
        connect: jest.fn(), start: jest.fn(), stop: jest.fn(),
        frequency: { value: 0 }, type: 'sine',
      })),
      createGain: jest.fn(() => ({
        connect: jest.fn(),
        gain: { setValueAtTime: jest.fn(), linearRampToValueAtTime: jest.fn(), exponentialRampToValueAtTime: jest.fn() },
      })),
      resume: jest.fn(),
    };
    global.AudioContext = jest.fn(() => mockCtx);

    expect(() => playAlertFresh('tech')).not.toThrow();
    expect(mockCtx.createOscillator).toHaveBeenCalledTimes(3); // 3 ноты
  });

  it('возобновляет suspended контекст перед воспроизведением', () => {
    const mockResume = jest.fn();
    const mockCtx = {
      state: 'suspended',
      currentTime: 0,
      destination: {},
      createOscillator: jest.fn(() => ({
        connect: jest.fn(), start: jest.fn(), stop: jest.fn(),
        frequency: { value: 0 }, type: 'sine',
      })),
      createGain: jest.fn(() => ({
        connect: jest.fn(),
        gain: { setValueAtTime: jest.fn(), linearRampToValueAtTime: jest.fn(), exponentialRampToValueAtTime: jest.fn() },
      })),
      resume: mockResume,
    };
    global.AudioContext = jest.fn(() => mockCtx);

    playAlertFresh('pass');
    expect(mockResume).toHaveBeenCalled();
  });
});
