/**
 * TEST-02: Race condition tests for useLiveSync.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('../config/runtimeMode', () => ({
  isLiveMode: () => true,
  isDemoMode: () => false,
}));

vi.mock('../services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), action: vi.fn(), debug: vi.fn() },
}));

vi.mock('./useNewRequestNotifier', () => ({ useNewRequestNotifier: () => vi.fn() }));
vi.mock('./useStatusChangeNotifier', () => ({ useStatusChangeNotifier: () => vi.fn() }));

const cleanupFns = [];
let recoveredAfterGapHandler = null;
const startSyncMock = vi.fn((_opts) => {
  const cleanup = vi.fn();
  cleanupFns.push(cleanup);
  return cleanup;
});

vi.mock('../services/providers/serviceContainer', () => ({
  services: { liveData: { startSync: (...args) => startSyncMock(...args) } },
}));

vi.mock('../utils/events', () => ({
  onSseStatus: (fn) => { fn({ connected: true }); return () => {}; },
  onSsePermanentError: () => () => {},
  onSseRecoveredAfterGap: (fn) => { recoveredAfterGapHandler = fn; return () => { recoveredAfterGapHandler = null; }; },
  onSseActivity: () => () => {},
  onRealtimeState: () => () => {},
  emitSseForceReconnect: vi.fn(),
  emitRealtimeState: vi.fn(),
}));

import { useLiveSync } from './useLiveSync';

const user = { uid: 'u1', role: 'security', name: 'Guard' };
const callbacks = {
  setAllRequests: vi.fn(), setAllMessages: vi.fn(), setAllUsers: vi.fn(), setPerms: vi.fn(), setTemplates: vi.fn(), setBlacklist: vi.fn(),
  addToBlacklist: vi.fn(), removeFromBlacklist: vi.fn(), updateUser: vi.fn(), deleteUser: vi.fn(), addUser: vi.fn(),
  updateRequest: vi.fn(), addRequest: vi.fn(), deleteRequest: vi.fn(),
};

describe('useLiveSync — race conditions', () => {
  beforeEach(() => {
    cleanupFns.length = 0;
    recoveredAfterGapHandler = null;
    startSyncMock.mockClear();
  });

  it('calls startSync once on initial mount', () => {
    renderHook(() => useLiveSync(user, { ...callbacks, retryKey: 0 }));
    expect(startSyncMock).toHaveBeenCalledTimes(1);
  });

  it('calls cleanup and re-starts sync when retryKey changes', async () => {
    const { rerender } = renderHook(({ retryKey }) => useLiveSync(user, { ...callbacks, retryKey }), { initialProps: { retryKey: 0 } });
    expect(startSyncMock).toHaveBeenCalledTimes(1);
    const firstCleanup = cleanupFns[0];

    act(() => rerender({ retryKey: 1 }));

    await waitFor(() => expect(firstCleanup).toHaveBeenCalledTimes(1));
    expect(startSyncMock).toHaveBeenCalledTimes(2);
  });

  it('rapid retryKey changes clean up all previous connections', async () => {
    const { rerender } = renderHook(({ retryKey }) => useLiveSync(user, { ...callbacks, retryKey }), { initialProps: { retryKey: 0 } });

    act(() => rerender({ retryKey: 1 }));
    act(() => rerender({ retryKey: 2 }));
    act(() => rerender({ retryKey: 3 }));

    expect(startSyncMock).toHaveBeenCalledTimes(4);
    await waitFor(() => {
      expect(cleanupFns[0]).toHaveBeenCalledTimes(1);
      expect(cleanupFns[1]).toHaveBeenCalledTimes(1);
      expect(cleanupFns[2]).toHaveBeenCalledTimes(1);
    });
    expect(cleanupFns[3]).not.toHaveBeenCalled();
  });

  it('cleanup is called on unmount', async () => {
    const { unmount } = renderHook(() => useLiveSync(user, { ...callbacks, retryKey: 0 }));
    expect(cleanupFns).toHaveLength(1);
    unmount();
    await waitFor(() => expect(cleanupFns[0]).toHaveBeenCalledTimes(1));
  });

  it('full-resyncs after SSE recovers from a reconnect gap', async () => {
    renderHook(() => useLiveSync(user, { ...callbacks, retryKey: 0 }));
    expect(startSyncMock).toHaveBeenCalledTimes(1);
    expect(recoveredAfterGapHandler).toBeTypeOf('function');

    act(() => recoveredAfterGapHandler());

    await waitFor(() => expect(startSyncMock).toHaveBeenCalledTimes(2));
    expect(cleanupFns[0]).toHaveBeenCalledTimes(1);
  });
});
