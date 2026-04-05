import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestNotifPerm, sendNotif } from './notifUtils';
import { getSwReg } from './swUtils';

vi.mock('./swUtils', () => ({
  getSwReg: vi.fn(() => null),
}));

describe('requestNotifPerm', () => {
  let origNotification;

  beforeEach(() => {
    origNotification = global.Notification;
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.Notification = origNotification;
  });

  it('запрашивает разрешение если permission === "default"', () => {
    const mockRequest = vi.fn();
    global.Notification = { permission: 'default', requestPermission: mockRequest };
    requestNotifPerm();
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('не запрашивает если permission уже "granted"', () => {
    const mockRequest = vi.fn();
    global.Notification = { permission: 'granted', requestPermission: mockRequest };
    requestNotifPerm();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('не запрашивает если permission "denied"', () => {
    const mockRequest = vi.fn();
    global.Notification = { permission: 'denied', requestPermission: mockRequest };
    requestNotifPerm();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('не падает если Notification недоступен', () => {
    delete global.Notification;
    expect(() => requestNotifPerm()).not.toThrow();
  });
});

describe('sendNotif', () => {
  let origNotification;

  beforeEach(() => {
    origNotification = global.Notification;
    vi.clearAllMocks();
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
    const mockCtor = vi.fn();
    global.Notification = Object.assign(mockCtor, { permission: 'default' });
    sendNotif('Заголовок', 'Текст');
    expect(mockCtor).not.toHaveBeenCalled();
  });

  it('создаёт Notification напрямую если нет SW', () => {
    const mockCtor = vi.fn();
    global.Notification = Object.assign(mockCtor, { permission: 'granted' });
    getSwReg.mockReturnValue(null);
    sendNotif('Заголовок', 'Текст', 'test-tag');
    expect(mockCtor).toHaveBeenCalledWith('Заголовок', { body: 'Текст', icon: '/logo192.png' });
  });

  it('использует SW.showNotification если SW доступен', () => {
    const mockShowNotification = vi.fn();
    const mockSWReg = { showNotification: mockShowNotification };
    const mockCtor = vi.fn();
    global.Notification = Object.assign(mockCtor, { permission: 'granted' });
    getSwReg.mockReturnValue(mockSWReg);

    sendNotif('Заголовок', 'Тело', 'tag-1');

    expect(mockShowNotification).toHaveBeenCalledTimes(1);
    const [title, opts] = mockShowNotification.mock.calls[0];
    expect(title).toBe('Заголовок');
    expect(opts.body).toBe('Тело');
    expect(opts.tag).toBe('tag-1');
    expect(opts.renotify).toBe(true);
    expect(mockCtor).not.toHaveBeenCalled();
  });

  it('использует "default" как tag если не передан', () => {
    const mockShowNotification = vi.fn();
    global.Notification = Object.assign(vi.fn(), { permission: 'granted' });
    getSwReg.mockReturnValue({ showNotification: mockShowNotification });
    sendNotif('T', 'B');
    expect(mockShowNotification.mock.calls[0][1].tag).toBe('default');
  });
});

describe('playAlert', () => {
  let origAudioContext;
  let origWebkitAudioContext;
  let playAlertFresh;

  beforeEach(async () => {
    origAudioContext = global.AudioContext;
    origWebkitAudioContext = global.webkitAudioContext;
    vi.clearAllMocks();
    vi.resetModules();
    ({ playAlert: playAlertFresh } = await import('./notifUtils'));
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
      createOscillator: vi.fn(() => ({
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        frequency: { value: 0 },
        type: 'sine',
      })),
      createGain: vi.fn(() => ({
        connect: vi.fn(),
        gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      })),
      resume: vi.fn(),
    };
    global.AudioContext = vi.fn(() => mockCtx);

    expect(() => playAlertFresh('pass')).not.toThrow();
    expect(mockCtx.createOscillator).toHaveBeenCalledTimes(3);
  });

  it('не падает при вызове с типом "tech"', () => {
    const mockCtx = {
      state: 'running',
      currentTime: 0,
      destination: {},
      createOscillator: vi.fn(() => ({
        connect: vi.fn(), start: vi.fn(), stop: vi.fn(),
        frequency: { value: 0 }, type: 'sine',
      })),
      createGain: vi.fn(() => ({
        connect: vi.fn(),
        gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      })),
      resume: vi.fn(),
    };
    global.AudioContext = vi.fn(() => mockCtx);

    expect(() => playAlertFresh('tech')).not.toThrow();
    expect(mockCtx.createOscillator).toHaveBeenCalledTimes(3);
  });

  it('возобновляет suspended контекст перед воспроизведением', () => {
    const mockResume = vi.fn();
    const mockCtx = {
      state: 'suspended',
      currentTime: 0,
      destination: {},
      createOscillator: vi.fn(() => ({
        connect: vi.fn(), start: vi.fn(), stop: vi.fn(),
        frequency: { value: 0 }, type: 'sine',
      })),
      createGain: vi.fn(() => ({
        connect: vi.fn(),
        gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      })),
      resume: mockResume,
    };
    global.AudioContext = vi.fn(() => mockCtx);

    playAlertFresh('pass');
    expect(mockResume).toHaveBeenCalled();
  });
});
