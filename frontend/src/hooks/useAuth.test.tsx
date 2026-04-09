import { renderHook, act } from '@testing-library/react';

const requestNotifPermMock = vi.fn();

vi.mock('../config/runtimeMode', () => ({
  isLiveMode: () => false,
}));

vi.mock('../services/providers/serviceContainer', () => ({
  services: {
    auth: {
      getMe: vi.fn(),
      logout: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

vi.mock('../utils', () => ({
  requestNotifPerm: requestNotifPermMock,
}));

vi.mock('../services/logger', () => ({
  logger: {
    action: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    setContext: vi.fn(),
    clearContext: vi.fn(),
  },
}));

describe('useAuth', () => {
  let useAuth;
  let PHASE;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    requestNotifPermMock.mockReset();
    ({ useAuth, PHASE } = await import('./useAuth'));
  });

  afterEach(() => {
    act(() => { vi.runOnlyPendingTimers(); });
    vi.useRealTimers();
  });

  it('starts in loading phase', () => {
    const { result } = renderHook(() => useAuth());
    expect(result.current.phase).toBe(PHASE.LOADING);
  });

  it('transitions to login after splash delay', () => {
    const { result } = renderHook(() => useAuth());
    act(() => { vi.advanceTimersByTime(400); });
    expect(result.current.phase).toBe(PHASE.LOGIN);
  });

  it('login sets user and dashboard phase', () => {
    const { result } = renderHook(() => useAuth());
    act(() => { vi.advanceTimersByTime(400); });
    act(() => { result.current.login({ uid: 'u1', name: 'Test', role: 'owner' }); });
    expect(result.current.phase).toBe(PHASE.DASHBOARD);
    expect(result.current.user.uid).toBe('u1');
  });

  it('logout clears user and returns to login', () => {
    const { result } = renderHook(() => useAuth());
    act(() => { vi.advanceTimersByTime(400); });
    act(() => { result.current.login({ uid: 'u1', name: 'Test', role: 'owner' }); });
    act(() => { result.current.logout(); });
    expect(result.current.user).toBeNull();
    expect(result.current.phase).toBe(PHASE.LOGIN);
  });

  it('logout clears pending notification permission timer', () => {
    const { result } = renderHook(() => useAuth());
    act(() => { vi.advanceTimersByTime(400); });
    act(() => { result.current.login({ uid: 'u1', name: 'Test', role: 'owner' }); });
    act(() => { result.current.logout(); });
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(requestNotifPermMock).not.toHaveBeenCalled();
  });

  it('unauthorized event resets session', () => {
    const { result } = renderHook(() => useAuth());
    act(() => { vi.advanceTimersByTime(400); });
    act(() => { result.current.login({ uid: 'u1', name: 'Test', role: 'owner' }); });
    act(() => { window.dispatchEvent(new CustomEvent('rz:unauthorized')); });
    expect(result.current.user).toBeNull();
    expect(result.current.phase).toBe(PHASE.LOGIN);
  });

  it('user is null on boot', () => {
    const { result } = renderHook(() => useAuth());
    expect(result.current.user).toBeNull();
  });
});
