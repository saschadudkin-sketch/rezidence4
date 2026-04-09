import { useEffect } from 'react';
import { isLiveMode } from '../config/runtimeMode';
import { logger } from '../services/logger';
import { emitRealtimeState, emitSseForceReconnect, onSseActivity } from '../utils/events.js';

type RealtimeMode = 'healthy' | 'degraded' | 'open-circuit' | 'recovery';

export function useRealtimeWatchdog(
  liveSyncEnabled: boolean,
  setRealtimeMode: (mode: RealtimeMode) => void,
) {
  useEffect(() => {
    if (!liveSyncEnabled || !isLiveMode()) return;

    const WATCHDOG_INTERVAL_MS = 15_000;
    const STALE_THRESHOLD_MS = 60_000;
    const RECONNECT_BUDGET_WINDOW_MS = 10 * 60_000;
    const RECONNECT_BUDGET_MAX = 5;
    const OPEN_CIRCUIT_MS = 2 * 60_000;
    const POLLING_FALLBACK_MS = 45_000;
    const BASE_BACKOFF_MS = 5_000;
    const MAX_BACKOFF_MS = 60_000;

    const stateRef = {
      mode: 'healthy' as RealtimeMode,
      reconnectAttempts: [] as number[],
      staleHits: 0,
      openedAt: 0,
      nextAllowedAt: 0,
    };
    const timeoutIds = new Set<number>();

    const toState = (next: RealtimeMode) => {
      if (stateRef.mode === next) return;
      const now = Date.now();
      const prev = stateRef.mode;
      stateRef.mode = next;
      setRealtimeMode(next);
      emitRealtimeState({ from: prev, to: next, at: now, durationMs: 0 });
    };

    const jitter = (ms: number) => Math.round(ms * (0.7 + Math.random() * 0.6));
    const pruneAttempts = (now: number) => {
      stateRef.reconnectAttempts = stateRef.reconnectAttempts.filter((ts) => now - ts <= RECONNECT_BUDGET_WINDOW_MS);
    };

    let lastActivity = Date.now();
    const cleanupActivity = onSseActivity(() => {
      lastActivity = Date.now();
      stateRef.staleHits = 0;
      if (stateRef.mode !== 'healthy') toState('healthy');
    });

    const interval = window.setInterval(() => {
      const now = Date.now();
      if (stateRef.mode === 'open-circuit' && now - stateRef.openedAt >= OPEN_CIRCUIT_MS) {
        toState('recovery');
      }
      if (stateRef.mode === 'open-circuit') {
        if (now < stateRef.nextAllowedAt) return;
        emitSseForceReconnect();
        stateRef.nextAllowedAt = now + POLLING_FALLBACK_MS;
        return;
      }

      if (now - lastActivity > STALE_THRESHOLD_MS) {
        stateRef.staleHits += 1;
        pruneAttempts(now);
        if (stateRef.reconnectAttempts.length >= RECONNECT_BUDGET_MAX) {
          stateRef.openedAt = now;
          stateRef.nextAllowedAt = now + OPEN_CIRCUIT_MS;
          logger.warn('[useRealtimeWatchdog] SSE reconnect budget exhausted — entering open-circuit mode');
          toState('open-circuit');
          return;
        }

        toState(stateRef.mode === 'healthy' ? 'degraded' : stateRef.mode);
        const backoffMs = Math.min(BASE_BACKOFF_MS * (2 ** (stateRef.staleHits - 1)), MAX_BACKOFF_MS);
        const scheduleMs = jitter(backoffMs);
        stateRef.nextAllowedAt = now + scheduleMs;
        stateRef.reconnectAttempts.push(now);
        logger.warn('[useRealtimeWatchdog] SSE stream stale — scheduling reconnect', {
          mode: stateRef.mode,
          scheduleMs,
          attemptsInWindow: stateRef.reconnectAttempts.length,
        });

        const timeoutId = window.setTimeout(() => {
          timeoutIds.delete(timeoutId);
          if (Date.now() < stateRef.nextAllowedAt) return;
          emitSseForceReconnect();
        }, scheduleMs);
        timeoutIds.add(timeoutId);
        lastActivity = now;
      }
    }, WATCHDOG_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
      for (const timeoutId of timeoutIds) {
        window.clearTimeout(timeoutId);
      }
      timeoutIds.clear();
      cleanupActivity();
    };
  }, [liveSyncEnabled, setRealtimeMode]);
}
