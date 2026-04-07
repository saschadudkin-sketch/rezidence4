// @ts-check

import { useState, useEffect } from 'react';
import { FIRST_CONNECT_TIMEOUT_MS, RECONNECT_TIMEOUT_MS } from '../constants/limits';
import { emitUxMetric, UX_METRICS } from '../utils/telemetryContract';
import { buildDataPlaneContract } from '../data/dataPlanePolicy';

/**
 * @param {{ isLoading: boolean, sseOnline: boolean|null, ssePermanentError: boolean }} liveSync
 * @param {{ retryKey: number, setRetryKey: (fn: (k: number) => number) => void }} opts
 * @param {{ connectivityEnabled?: boolean }} capabilities
 */
export function useConnectionStatus(
  { isLoading: syncLoading, sseOnline, ssePermanentError },
  { retryKey, setRetryKey },
  { connectivityEnabled = true } = {},
) {
  const [timedOut, setTimedOut] = useState(false);
  const [retryStartedAt, setRetryStartedAt] = useState(0);

  useEffect(() => {
    if (!connectivityEnabled) {
      setTimedOut(false);
      return;
    }
    if (!syncLoading) {
      setTimedOut(false);
      return;
    }
    const t = setTimeout(() => {
      setTimedOut(true);
      emitUxMetric(UX_METRICS.CONNECTION_TIMEOUT, { retryKey });
    }, retryKey === 0 ? FIRST_CONNECT_TIMEOUT_MS : RECONNECT_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [connectivityEnabled, syncLoading, retryKey]);

  useEffect(() => {
    if (!connectivityEnabled) return;
    if (!retryStartedAt || syncLoading || sseOnline !== true) return;
    emitUxMetric(UX_METRICS.SSE_RECONNECT_MS, { durationMs: Date.now() - retryStartedAt, retryKey });
    setRetryStartedAt(0);
  }, [connectivityEnabled, retryStartedAt, syncLoading, sseOnline, retryKey]);

  if (!connectivityEnabled) {
    return {
      isLoading: false,
      isConnErr: false,
      sseOnline: null,
      handleRetry: () => {},
    };
  }

  const contract = buildDataPlaneContract({
    syncLoading,
    timedOut,
    ssePermanentError,
    sseOnline,
  });

  const isLoading = contract.loading;
  const isConnErr = contract.error;
  const handleRetry = () => {
    setTimedOut(false);
    setRetryStartedAt(Date.now());
    setRetryKey((k) => k + 1);
  };

  return { isLoading, isConnErr, sseOnline, handleRetry };
}
