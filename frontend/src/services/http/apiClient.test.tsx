import { beforeEach, describe, expect, it, vi } from 'vitest';

const parseApiResponse = vi.fn();
const fetchWithTimeout = vi.fn();
const getCsrfToken = vi.fn(() => 'csrf-token');
const makeRequestId = vi.fn(() => 'req-1');
const tryRefreshToken = vi.fn();
const markHealthy = vi.fn();
const resetRefreshState = vi.fn();
const resetState = vi.fn();

vi.mock('../../config/apiBaseUrl', () => ({
  API_BASE_URL: 'https://api.example.test',
}));

vi.mock('./transport', () => ({
  fetchWithTimeout,
  parseApiResponse,
}));

vi.mock('./requestIdentity', () => ({
  getCsrfToken,
  makeRequestId,
}));

vi.mock('./authSession', () => ({
  createAuthSession: () => ({
    tryRefreshToken,
    markHealthy,
    resetRefreshState,
    resetState,
  }),
}));

vi.mock('./uploadClient', () => ({
  createUploadClient: () => vi.fn(),
}));

describe('apiClient retry policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    parseApiResponse.mockResolvedValue({ ok: true });
    tryRefreshToken.mockResolvedValue(false);
  });

  it('does not retry POST by default', async () => {
    fetchWithTimeout.mockRejectedValue(new Error('network'));
    const { apiClient } = await import('./apiClient');

    await expect(apiClient.post('/api/v1/auth/send-otp', { phone: '+7999' })).rejects.toThrow('network');
    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
  });

  it('retries GET requests by default', async () => {
    fetchWithTimeout
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
      });

    const { apiClient } = await import('./apiClient');
    const result = await apiClient.get('/api/v1/auth/me');

    expect(fetchWithTimeout).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ ok: true });
  });

  it('respects explicit retryable override for POST', async () => {
    fetchWithTimeout
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
      });

    const { apiClient } = await import('./apiClient');
    const result = await apiClient.post('/api/v1/sync/probe', { ping: true }, { retryable: true, maxRetries: 1 });

    expect(fetchWithTimeout).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ ok: true });
  });
});
