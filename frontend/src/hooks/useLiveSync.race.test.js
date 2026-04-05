/**
 * TEST-02: Race condition tests for useLiveSync.
 *
 * Verifies that rapid retryKey changes (concurrent reconnect triggers)
 * don't leave stale callbacks or accumulate SSE connections.
 *
 * Strategy: mock the services.liveData.startSync factory and assert that
 * each retryKey change cancels the previous subscription's cleanup.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../config/runtimeMode.js', () => ({
  isLiveMode: () => true,
  isDemoMode: () => false,
}));

vi.mock('../services/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), action: vi.fn() },
}));

vi.mock('./useNewRequestNotifier.js', () => ({
  useNewRequestNotifier: () => vi.fn(),
}));

vi.mock('./useStatusChangeNotifier.js', () => ({
  useStatusChangeNotifier: () => vi.fn(),
}));

// Track all startSync calls and their returned cleanup functions
const cleanupFns = [];
const startSyncMock = vi.fn((_opts) => {
  const cleanup = vi.fn();
  cleanupFns.push(cleanup);
  return cleanup;
});

vi.mock('../services/providers/serviceContainer.js', () => ({
  services: {
    liveData: { startSync: (...args) => startSyncMock(...args) },
  },
}));

vi.mock('../utils/events.js', () => ({
  onSseStatus:         (fn) => { fn({ connected: true }); return () => {}; },
  onSsePermanentError: ()   => () => {},
  onSseActivity:       ()   => () => {},
}));

import { useLiveSync } from './useLiveSync';

// ── Helpers ────────────────────────────────────────────────────────────────

const user = { uid: 'u1', role: 'security', name: 'Guard' };
const callbacks = {
  setAllRequests: vi.fn(),
  setAllMessages: vi.fn(),
  setAllUsers: vi.fn(),
  setPerms: vi.fn(),
  setTemplates: vi.fn(),
  setBlacklist: vi.fn(),
  addToBlacklist: vi.fn(),
  removeFromBlacklist: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: vi.fn(),
  addUser: vi.fn(),
  updateRequest: vi.fn(),
  addRequest: vi.fn(),
  deleteRequest: vi.fn(),
};

// ── Tests ──────────────────────────────────────────────────────────────────

describe('useLiveSync — race conditions', () => {
  beforeEach(() => {
    cleanupFns.length = 0;
    startSyncMock.mockClear();
  });

  it('calls startSync once on initial mount', () => {
    renderHook(() => useLiveSync(user, { ...callbacks, retryKey: 0 }));
    expect(startSyncMock).toHaveBeenCalledTimes(1);
  });

  it('calls cleanup and re-starts sync when retryKey changes', async () => {
    const { rerender } = renderHook(
      ({ retryKey }) => useLiveSync(user, { ...callbacks, retryKey }),
      { initialProps: { retryKey: 0 } }
    );

    expect(startSyncMock).toHaveBeenCalledTimes(1);
    const firstCleanup = cleanupFns[0];

    act(() => rerender({ retryKey: 1 }));

    // Previous connection must be cleaned up before the new one starts
    expect(firstCleanup).toHaveBeenCalledTimes(1);
    expect(startSyncMock).toHaveBeenCalledTimes(2);
  });

  it('rapid retryKey changes clean up all previous connections', async () => {
    const { rerender } = renderHook(
      ({ retryKey }) => useLiveSync(user, { ...callbacks, retryKey }),
      { initialProps: { retryKey: 0 } }
    );

    act(() => rerender({ retryKey: 1 }));
    act(() => rerender({ retryKey: 2 }));
    act(() => rerender({ retryKey: 3 }));

    // 4 total connections started (0 → 1 → 2 → 3)
    expect(startSyncMock).toHaveBeenCalledTimes(4);
    // First 3 cleanups must each have been called exactly once
    expect(cleanupFns[0]).toHaveBeenCalledTimes(1);
    expect(cleanupFns[1]).toHaveBeenCalledTimes(1);
    expect(cleanupFns[2]).toHaveBeenCalledTimes(1);
    // Last cleanup not yet called (still mounted)
    expect(cleanupFns[3]).not.toHaveBeenCalled();
  });

  it('cleanup is called on unmount', () => {
    const { unmount } = renderHook(
      () => useLiveSync(user, { ...callbacks, retryKey: 0 })
    );

    expect(cleanupFns).toHaveLength(1);
    unmount();
    expect(cleanupFns[0]).toHaveBeenCalledTimes(1);
  });
});
