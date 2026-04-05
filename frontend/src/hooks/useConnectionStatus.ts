// @ts-check
/**
 * useConnectionStatus.js — CQ-03: Extracted from Dashboard.jsx.
 *
 * Computes the effective connection state from `useLiveSync` output.
 * Previously this logic lived inline in Dashboard — here it's named and testable.
 *
 * Returns:
 *   isLoading   — true while waiting for first-/re-connect (with soft timeout)
 *   isConnErr   — true when the timeout expired or a permanent SSE error occurred
 *   sseOnline   — boolean|null from useLiveSync (null = unknown / connecting)
 *   handleRetry — increments retryKey to force a new SSE connection attempt
 */

import { useState, useEffect } from 'react';
import { FIRST_CONNECT_TIMEOUT_MS, RECONNECT_TIMEOUT_MS } from '../constants/limits';
import { emitUxMetric, UX_METRICS } from '../utils/telemetryContract';

/**
 * @param {{ isLoading: boolean, sseOnline: boolean|null, ssePermanentError: boolean }} liveSync
 * @param {{ retryKey: number, setRetryKey: (fn: (k: number) => number) => void }} opts
 */
export function useConnectionStatus({ isLoading: syncLoading, sseOnline, ssePermanentError }, { retryKey, setRetryKey }) {
  const [timedOut, setTimedOut] = useState(false);
  const [retryStartedAt, setRetryStartedAt] = useState(0);

  useEffect(() => {
    if (!syncLoading) { setTimedOut(false); return; }
    const t = setTimeout(
      () => {
        setTimedOut(true);
        emitUxMetric(UX_METRICS.CONNECTION_TIMEOUT, { retryKey });
      },
      retryKey === 0 ? FIRST_CONNECT_TIMEOUT_MS : RECONNECT_TIMEOUT_MS,
    );
    return () => clearTimeout(t);
  }, [syncLoading, retryKey]);

  useEffect(() => {
    if (!retryStartedAt || syncLoading || sseOnline !== true) return;
    emitUxMetric(UX_METRICS.SSE_RECONNECT_MS, { durationMs: Date.now() - retryStartedAt, retryKey });
    setRetryStartedAt(0);
  }, [retryStartedAt, syncLoading, sseOnline, retryKey]);

  const isLoading  = syncLoading && !timedOut;
  const isConnErr  = (syncLoading && timedOut) || ssePermanentError;
  const handleRetry = () => {
    setTimedOut(false);
    setRetryStartedAt(Date.now());
    setRetryKey(k => k + 1);
  };

  return { isLoading, isConnErr, sseOnline, handleRetry };
}
