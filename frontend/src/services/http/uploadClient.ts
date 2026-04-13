type UploadClientDeps = {
  baseUrl: string;
  fetchWithTimeout: (url: string, options?: RequestInit, timeoutMs?: number) => Promise<Response>;
  getCsrfToken: () => string;
  makeRequestId: () => string;
};

export function createUploadClient({ baseUrl, fetchWithTimeout, getCsrfToken, makeRequestId }: UploadClientDeps) {
  return async function uploadPhoto(blob: Blob) {
    const res = await fetchWithTimeout(
      `${baseUrl}/api/v1/upload/photo`,
      {
        method: 'POST',
        headers: {
          'Content-Type': blob.type || 'image/jpeg',
          'X-CSRF-Token': getCsrfToken(),
          'X-Request-Id': makeRequestId(),
        },
        credentials: 'include',
        body: blob,
      },
      30_000,
    );

    if (res.status === 401) {
      window.dispatchEvent(new CustomEvent('rz:unauthorized'));
      throw new Error('Сессия истекла. Войдите снова.');
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    return res.json();
  };
}
