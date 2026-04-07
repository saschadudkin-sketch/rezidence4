import { useState, useEffect } from 'react';
import { isDemoMode } from '../../config/runtimeMode';
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
  const demoMode = isDemoMode();
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (demoMode) return;
    return onSseForceReconnect(() => setRetryKey((k) => k + 1));
  }, [demoMode]);

  const liveSync = useLiveSync(user, {
    ...(syncCallbacks || ({} as LiveSyncOptions)),
    retryKey,
  });

  const { isLoading, isConnErr, sseOnline, handleRetry } = useConnectionStatus(
    liveSync,
    { retryKey, setRetryKey },
    { connectivityEnabled: !demoMode },
  );

  const requestsErrorCopy = getViewStateCopy('requests', 'error');

  return {
    isLoading,
    isConnErr,
    sseOnline,
    handleRetry,
    requestsErrorCopy,
  };
}
