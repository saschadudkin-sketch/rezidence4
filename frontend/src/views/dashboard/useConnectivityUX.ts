import { useState, useEffect } from 'react';
import { useLiveSync } from '../../hooks/useDashboardHooks';
import { useConnectionStatus } from '../../hooks/useConnectionStatus';
import { onSseForceReconnect } from '../../utils/events';
import { getViewStateCopy } from '../../ui/viewStateContract';

type LiveSyncOptions = Parameters<typeof useLiveSync>[1];

interface ConnectivityParams {
  user: unknown;
  syncCallbacks: LiveSyncOptions;
}

export function useConnectivityUX({ user, syncCallbacks }: ConnectivityParams) {
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => onSseForceReconnect(() => setRetryKey((k) => k + 1)), []);

  const liveSync = useLiveSync(user, {
    ...(syncCallbacks || ({} as LiveSyncOptions)),
    retryKey,
  });
  const { isLoading, isConnErr, sseOnline, handleRetry } = useConnectionStatus(liveSync, { retryKey, setRetryKey });
  const requestsErrorCopy = getViewStateCopy('requests', 'error');

  return {
    isLoading,
    isConnErr,
    sseOnline,
    handleRetry,
    requestsErrorCopy,
  };
}
