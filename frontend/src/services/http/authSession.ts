type AuthSessionDeps = {
  baseUrl: string;
  fetchWithTimeout: (url: string, options?: RequestInit & { signal?: AbortSignal | null }, timeoutMs?: number) => Promise<Response>;
  getCsrfToken: () => string;
  makeRequestId: () => string;
};

export function createAuthSession({ baseUrl, fetchWithTimeout, getCsrfToken, makeRequestId }: AuthSessionDeps) {
  let refreshPromise: Promise<boolean> | null = null;
  let refreshFailed = false;

  async function tryRefreshToken(requestId?: string) {
    if (refreshFailed) return false;
    if (refreshPromise) return refreshPromise;

    refreshPromise = fetchWithTimeout(
      `${baseUrl}/api/v1/auth/refresh`,
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          'X-CSRF-Token': getCsrfToken(),
          'X-Request-Id': requestId || makeRequestId(),
        },
      },
      10_000,
    ).then((res: Response) => {
      refreshPromise = null;
      if (!res.ok) refreshFailed = true;
      return res.ok;
    }).catch(() => {
      refreshPromise = null;
      refreshFailed = true;
      return false;
    });

    return refreshPromise;
  }

  function resetRefreshState() {
    refreshFailed = false;
  }

  function markHealthy() {
    refreshFailed = false;
  }

  function resetState() {
    refreshPromise = null;
    refreshFailed = false;
  }

  return {
    tryRefreshToken,
    resetRefreshState,
    markHealthy,
    resetState,
  };
}
