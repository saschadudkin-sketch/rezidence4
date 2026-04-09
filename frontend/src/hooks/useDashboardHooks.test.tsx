/**
 * hooks/useDashboardHooks.test.js
 * Покрывает: useTheme, useNavBadges, useNavigation (чистая логика без SSE/Push)
 */

import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Мокируем тяжёлые зависимости которые не нужны для unit-тестов
vi.mock('../config/runtimeMode', () => ({
  isLiveMode: vi.fn(() => false),
  isDemoMode:  vi.fn(() => true),
}));
vi.mock('../services/providers/serviceContainer', () => ({
  services: { liveData: { startSync: vi.fn(() => vi.fn()) } },
}));
vi.mock('../services/pushNotification', () => ({
  subscribePush: vi.fn(),
}));
vi.mock('../utils', () => ({
  sendNotif: vi.fn(),
  playAlert:  vi.fn(),
}));

import { useTheme, useNavBadges, useNavigation } from './useDashboardHooks';

// ─── useTheme ─────────────────────────────────────────────────────────────────

describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
  });

  test('начальная тема "dark" если localStorage пустой', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('dark');
  });

  test('читает сохранённую тему из localStorage', () => {
    localStorage.setItem('rz-theme', 'dark');
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('dark');
  });

  test('cycleTheme: dark → auto → light → dark', () => {
    const { result } = renderHook(() => useTheme());

    act(() => result.current.cycleTheme());
    expect(result.current.theme).toBe('auto');

    act(() => result.current.cycleTheme());
    expect(result.current.theme).toBe('light');

    act(() => result.current.cycleTheme());
    expect(result.current.theme).toBe('dark');
  });

  test('themeIcon: dark=history, auto=chart, light=alert', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.themeIcon).toBe('history');

    act(() => result.current.cycleTheme()); // → auto
    expect(result.current.themeIcon).toBe('chart');

    act(() => result.current.cycleTheme()); // → light
    expect(result.current.themeIcon).toBe('alert');
  });

  test('themeLabel: dark=Тёмная, auto=Авто, light=Светлая', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.themeLabel).toBe('Тёмная');

    act(() => result.current.cycleTheme()); // → auto
    expect(result.current.themeLabel).toBe('Авто');

    act(() => result.current.cycleTheme()); // → light
    expect(result.current.themeLabel).toBe('Светлая');
  });

  test('тема сохраняется в localStorage при изменении', () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.cycleTheme()); // → auto
    expect(localStorage.getItem('rz-theme')).toBe('auto');
  });

  test('тема "light" добавляет класс theme-light на documentElement', () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.cycleTheme()); // → auto
    act(() => result.current.cycleTheme()); // → light
    expect(document.documentElement.classList.contains('theme-light')).toBe(true);
    expect(document.documentElement.classList.contains('theme-dark')).toBe(false);
  });

  test('тема "dark" добавляет класс theme-dark на documentElement', () => {
    renderHook(() => useTheme());
    expect(document.documentElement.classList.contains('theme-dark')).toBe(true);
    expect(document.documentElement.classList.contains('theme-light')).toBe(false);
  });

  test('тема "auto" убирает оба класса', () => {
    document.documentElement.classList.add('theme-dark');
    const { result } = renderHook(() => useTheme());
    act(() => result.current.cycleTheme()); // → auto
    expect(document.documentElement.classList.contains('theme-light')).toBe(false);
    expect(document.documentElement.classList.contains('theme-dark')).toBe(false);
  });
});

// ─── useNavBadges ─────────────────────────────────────────────────────────────

describe('useNavBadges', () => {
  const user = { uid: 'u1', role: 'owner' };
  const staffUser = { uid: 'g1', role: 'security' };

  const mkReq = (type, status, createdByUid = 'u1', createdAt = '2026-01-01') =>
    ({ id: type + status, type, status, createdByUid, createdAt });

  const mkMsg = (uid, at) => ({ id: uid + at, uid, at });

  beforeEach(() => localStorage.clear());

  test('pendingT — количество tech-заявок со статусом pending', () => {
    const requests = [
      mkReq('tech', 'pending'),
      mkReq('tech', 'approved'),
      mkReq('pass', 'pending'),
    ];
    const { result } = renderHook(() =>
      useNavBadges(staffUser, requests, [], {}, [])
    );
    expect(result.current.pendingT).toBe(1);
  });

  test('pendingP — количество pass-заявок со статусом pending', () => {
    const requests = [
      mkReq('pass', 'pending'),
      mkReq('pass', 'pending', 'u2'),
      mkReq('pass', 'approved'),
    ];
    const { result } = renderHook(() =>
      useNavBadges(staffUser, requests, [], {}, [])
    );
    expect(result.current.pendingP).toBe(2);
  });

  test('unreadMsgs — сообщения не от текущего пользователя новее lastSeen', () => {
    const lastSeen = new Date('2026-03-01T10:00:00').getTime();
    const chat = [
      mkMsg('u2', new Date('2026-03-01T11:00:00').toISOString()), // новее — от другого
      mkMsg('u1', new Date('2026-03-01T11:00:00').toISOString()), // новее — от себя → не считается
      mkMsg('u2', new Date('2026-02-28T09:00:00').toISOString()), // старее — не считается
    ];
    const { result } = renderHook(() =>
      useNavBadges(user, [], chat, { u1: lastSeen }, [])
    );
    expect(result.current.unreadMsgs).toBe(1);
  });

  test('unreadMsgs = 0 если все прочитано', () => {
    const lastSeen = Date.now() + 1000;
    const chat = [mkMsg('u2', new Date(lastSeen - 5000).toISOString())];
    const { result } = renderHook(() =>
      useNavBadges(user, [], chat, { u1: lastSeen }, [])
    );
    expect(result.current.unreadMsgs).toBe(0);
  });

  test('blacklistCount — длина массива blacklist', () => {
    const blacklist = [{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }];
    const { result } = renderHook(() =>
      useNavBadges(user, [], [], {}, blacklist)
    );
    expect(result.current.blacklistCount).toBe(3);
  });

  test('residentNewStatuses = 0 для staff (canManageRequests)', () => {
    const requests = [mkReq('pass', 'approved', 'g1')];
    const { result } = renderHook(() =>
      useNavBadges(staffUser, requests, [], {}, [])
    );
    expect(result.current.residentNewStatuses).toBe(0);
  });

  // FIX [BUG-7]: residentNewStatuses должен сбрасываться когда onPassesSeen() вызван
  test('FIX BUG-7: onPassesSeen() экспортируется и является функцией', () => {
    const { result } = renderHook(() =>
      useNavBadges(user, [], [], {}, [])
    );
    expect(typeof result.current.onPassesSeen).toBe('function');
  });

  test('FIX BUG-7: residentNewStatuses считает заявки новее lastSeenPassesAt из localStorage', () => {
    const oldTime = new Date('2026-01-01').getTime();
    localStorage.setItem('rz-passes-seen', String(oldTime));
    const requests = [
      mkReq('pass', 'approved', 'u1', new Date('2026-03-01').toISOString()),
    ];
    const { result } = renderHook(() =>
      useNavBadges(user, requests, [], {}, [])
    );
    expect(result.current.residentNewStatuses).toBe(1);
  });

  test('FIX BUG-7: residentNewStatuses = 0 когда все заявки старее lastSeenPassesAt', () => {
    const newTime = Date.now() + 999999;
    localStorage.setItem('rz-passes-seen', String(newTime));
    const requests = [
      mkReq('pass', 'approved', 'u1', new Date('2026-01-01').toISOString()),
    ];
    const { result } = renderHook(() =>
      useNavBadges(user, requests, [], {}, [])
    );
    expect(result.current.residentNewStatuses).toBe(0);
  });

  test('FIX BUG-16: onPassesSeen() сбрасывает residentNewStatuses в текущей вкладке', async () => {
    const oldTime = new Date('2026-01-01').getTime();
    localStorage.setItem('rz-passes-seen', String(oldTime));
    const requests = [
      mkReq('pass', 'approved', 'u1', new Date('2026-03-01').toISOString()),
    ];
    const { result } = renderHook(() =>
      useNavBadges(user, requests, [], {}, [])
    );
    // Изначально счётчик > 0
    expect(result.current.residentNewStatuses).toBe(1);

    // Эмулируем goTab('passes') → записывает свежую метку → вызывает onPassesSeen
    localStorage.setItem('rz-passes-seen', String(Date.now() + 10000));
    act(() => result.current.onPassesSeen());

    // Счётчик должен обнулиться
    expect(result.current.residentNewStatuses).toBe(0);
  });
});

// ─── useNavigation ────────────────────────────────────────────────────────────

describe('useNavigation', () => {
  const markChatSeen = vi.fn();
  const onPassesSeen = vi.fn();
  // Обёртка с MemoryRouter нужна т.к. useNavigation использует useNavigate/useLocation
  const wrapper = ({ children }) => React.createElement(MemoryRouter, { initialEntries: ['/dashboard/passes'] }, children);

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  test('начальный таб owner — "passes"', () => {
    const { result } = renderHook(() =>
      useNavigation({ uid: 'u1', role: 'owner' }, { markChatSeen, onPassesSeen }),
      { wrapper }
    );
    expect(result.current.activeTab).toBe('passes');
  });

  test('начальный таб security — "guardpost"', () => {
    const secWrapper = ({ children }) => React.createElement(MemoryRouter, { initialEntries: ['/dashboard/guardpost'] }, children);
    const { result } = renderHook(() =>
      useNavigation({ uid: 'g1', role: 'security' }, { markChatSeen, onPassesSeen }),
      { wrapper: secWrapper }
    );
    expect(result.current.activeTab).toBe('guardpost');
  });

  test('начальный таб admin — "stats"', () => {
    const adminWrapper = ({ children }) => React.createElement(MemoryRouter, { initialEntries: ['/dashboard/stats'] }, children);
    const { result } = renderHook(() =>
      useNavigation({ uid: 'a1', role: 'admin' }, { markChatSeen, onPassesSeen }),
      { wrapper: adminWrapper }
    );
    expect(result.current.activeTab).toBe('stats');
  });

  test('goTab переключает activeTab', () => {
    const { result } = renderHook(() =>
      useNavigation({ uid: 'u1', role: 'owner' }, { markChatSeen, onPassesSeen }),
      { wrapper }
    );
    act(() => result.current.goTab('chat'));
    expect(result.current.activeTab).toBe('chat');
  });

  test('goTab не переключает на недоступный таб', () => {
    const { result } = renderHook(() =>
      useNavigation({ uid: 'u1', role: 'owner' }, { markChatSeen, onPassesSeen }),
      { wrapper }
    );
    act(() => result.current.goTab('guardpost')); // недоступен для owner
    expect(result.current.activeTab).toBe('passes'); // не изменился
  });

  test('goTab на chat вызывает markChatSeen', () => {
    const { result } = renderHook(() =>
      useNavigation({ uid: 'u1', role: 'owner' }, { markChatSeen, onPassesSeen }),
      { wrapper }
    );
    act(() => result.current.goTab('chat'));
    expect(markChatSeen).toHaveBeenCalledWith('u1');
  });

  test('highlightReqId начально null, setHighlightReqId работает', () => {
    const { result } = renderHook(() =>
      useNavigation({ uid: 'u1', role: 'owner' }, { markChatSeen, onPassesSeen }),
      { wrapper }
    );
    expect(result.current.highlightReqId).toBeNull();
    act(() => result.current.setHighlightReqId('req-123'));
    expect(result.current.highlightReqId).toBe('req-123');
  });

  // FIX [BUG-16]: goTab('passes') для жильца должен вызывать onPassesSeen
  // чтобы счётчик residentNewStatuses немедленно сбросился в текущей вкладке
  test('FIX BUG-16: goTab passes для owner вызывает onPassesSeen', () => {
    const { result } = renderHook(() =>
      useNavigation({ uid: 'u1', role: 'owner' }, { markChatSeen, onPassesSeen }),
      { wrapper }
    );
    act(() => result.current.goTab('passes'));
    expect(onPassesSeen).toHaveBeenCalledTimes(1);
  });

  test('FIX BUG-16: goTab passes для owner записывает rz-passes-seen в localStorage', () => {
    const before = Date.now();
    const { result } = renderHook(() =>
      useNavigation({ uid: 'u1', role: 'owner' }, { markChatSeen, onPassesSeen }),
      { wrapper }
    );
    act(() => result.current.goTab('passes'));
    const stored = parseInt(localStorage.getItem('rz-passes-seen') || '0');
    expect(stored).toBeGreaterThanOrEqual(before);
  });

  test('FIX BUG-16: goTab passes для security НЕ вызывает onPassesSeen (только жильцы)', () => {
    const secWrapper = ({ children }) => React.createElement(MemoryRouter, { initialEntries: ['/dashboard/guardpost'] }, children);
    const { result } = renderHook(() =>
      useNavigation({ uid: 'g1', role: 'security' }, { markChatSeen, onPassesSeen }),
      { wrapper: secWrapper }
    );
    act(() => result.current.goTab('passes'));
    expect(onPassesSeen).not.toHaveBeenCalled();
  });
});
