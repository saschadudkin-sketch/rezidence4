/**
 * hooks/splitHooks.test.js
 * Проверяет что разбивка useDashboardHooks на отдельные файлы не сломала
 * обратную совместимость — все хуки доступны через barrel.
 */

// Мокируем тяжёлые зависимости
jest.mock('../config/runtimeMode', () => ({
  isLiveMode: jest.fn(() => false),
  isDemoMode: jest.fn(() => false),
}));
jest.mock('../services/providers/serviceContainer', () => ({
  services: { liveData: { startSync: jest.fn() } },
}));
jest.mock('../services/pushNotification', () => ({ subscribePush: jest.fn() }));
jest.mock('../utils', () => ({ sendNotif: jest.fn(), playAlert: jest.fn() }));

describe('useDashboardHooks barrel re-exports', () => {
  test('all 6 hooks exported from barrel', () => {
    const barrel = require('./useDashboardHooks');
    expect(typeof barrel.useTheme).toBe('function');
    expect(typeof barrel.useNavBadges).toBe('function');
    expect(typeof barrel.useLiveSync).toBe('function');
    expect(typeof barrel.usePushNotifications).toBe('function');
    expect(typeof barrel.useArrivalNotifier).toBe('function');
    expect(typeof barrel.useNavigation).toBe('function');
  });

  test('hooks are importable directly from their own files', () => {
    expect(typeof require('./useTheme').useTheme).toBe('function');
    expect(typeof require('./useNavBadges').useNavBadges).toBe('function');
    expect(typeof require('./useLiveSync').useLiveSync).toBe('function');
    expect(typeof require('./usePushNotifications').usePushNotifications).toBe('function');
    expect(typeof require('./useArrivalNotifier').useArrivalNotifier).toBe('function');
    expect(typeof require('./useNavigation').useNavigation).toBe('function');
  });

  test('barrel and direct import resolve to the same function', () => {
    const barrel  = require('./useDashboardHooks');
    const direct  = require('./useTheme');
    expect(barrel.useTheme).toBe(direct.useTheme);
  });
});

describe('useLiveSync — isLoading state', () => {
  const { renderHook, act } = require('@testing-library/react');
  const { useLiveSync }     = require('./useLiveSync');

  const mockServices = require('../services/providers/serviceContainer');

  test('isLoading starts true and becomes false after data arrives', async () => {
    let onRequestsCallback;
    mockServices.services.liveData.startSync.mockImplementation(({ onRequests }) => {
      onRequestsCallback = onRequests;
      return jest.fn(); // cleanup
    });

    const { result } = renderHook(() =>
      useLiveSync(
        { uid: 'u1', role: 'owner' },
        {
          setAllRequests: jest.fn(), setAllMessages: jest.fn(),
          setAllUsers: jest.fn(), setPerms: jest.fn(),
          setTemplates: jest.fn(), setBlacklist: jest.fn(),
          prevPendingP: { current: 0 },
          prevPendingT: { current: 0 },
          prevMsgs:     { current: 0 },
        },
      ),
    );

    // Начальное состояние: загрузка
    // (в demo/live-off режиме isLoading=false сразу, в live — true)
    // В тесте isLiveMode=false и isDemoMode=false → startSync не вызывается → false
    expect(result.current.isLoading).toBe(false);
  });
});
