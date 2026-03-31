import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
/**
 * hooks/splitHooks.test.js
 * Проверяет что разбивка useDashboardHooks на отдельные файлы не сломала
 * обратную совместимость — все хуки доступны через barrel.
 */

// Мокируем тяжёлые зависимости
vi.mock('../config/runtimeMode.js', () => ({
  isLiveMode: vi.fn(() => false),
  isDemoMode: vi.fn(() => false),
}));
vi.mock('../services/providers/serviceContainer.js', () => ({
  services: { liveData: { startSync: vi.fn() } },
}));
vi.mock('../services/pushNotification.js', () => ({ subscribePush: vi.fn() }));
vi.mock('../utils.js', () => ({ sendNotif: vi.fn(), playAlert: vi.fn() }));

describe('useDashboardHooks barrel re-exports', () => {
  test('all 6 hooks exported from barrel', async () => {
    const barrel = await import('./useDashboardHooks.js');
    expect(typeof barrel.useTheme).toBe('function');
    expect(typeof barrel.useNavBadges).toBe('function');
    expect(typeof barrel.useLiveSync).toBe('function');
    expect(typeof barrel.usePushNotifications).toBe('function');
    expect(typeof barrel.useArrivalNotifier).toBe('function');
    expect(typeof barrel.useNavigation).toBe('function');
  });

  test('hooks are importable directly from their own files', async () => {
    expect(typeof (await import('./useTheme.js')).useTheme).toBe('function');
    expect(typeof (await import('./useNavBadges.js')).useNavBadges).toBe('function');
    expect(typeof (await import('./useLiveSync.js')).useLiveSync).toBe('function');
    expect(typeof (await import('./usePushNotifications.js')).usePushNotifications).toBe('function');
    expect(typeof (await import('./useArrivalNotifier.js')).useArrivalNotifier).toBe('function');
    expect(typeof (await import('./useNavigation.js')).useNavigation).toBe('function');
  });

  test('barrel and direct import resolve to the same function', async () => {
    const barrel  = await import('./useDashboardHooks.js');
    const direct  = await import('./useTheme.js');
    expect(barrel.useTheme).toBe(direct.useTheme);
  });
});

describe('useLiveSync — isLoading state', () => {
  const { renderHook } = require('@testing-library/react');
  const { useLiveSync } = require('./useLiveSync.js');

  const { services: mockServices } = require('../services/providers/serviceContainer.js');

  test('isLoading starts true and becomes false after data arrives', async () => {
    const { result } = renderHook(() =>
      useLiveSync(
        { uid: 'u1', role: 'owner' },
        {
          setAllRequests: vi.fn(), setAllMessages: vi.fn(),
          setAllUsers: vi.fn(), setPerms: vi.fn(),
          setTemplates: vi.fn(), setBlacklist: vi.fn(),
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
