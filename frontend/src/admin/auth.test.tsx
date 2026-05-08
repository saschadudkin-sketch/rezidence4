import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: vi.fn(() => 'application/json') },
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  } as unknown as Response;
}

describe('platform admin auth', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('401 из platform API переводит AuthProvider на экран входа', async () => {
    const apiMod = await import('./api');
    const authMod = await import('./auth');

    apiMod.setToken('token');
    fetchMock.mockResolvedValueOnce(jsonResponse({ totals: {} }));

    function Probe() {
      const { status } = authMod.useAuth();
      return <div>{status}</div>;
    }

    render(
      <authMod.AuthProvider>
        <Probe />
      </authMod.AuthProvider>,
    );

    await screen.findByText('authenticated');

    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: 'Сессия истекла' } }, 401));

    await act(async () => {
      await expect(apiMod.api.get('/stats')).rejects.toThrow('Сессия истекла');
    });

    await waitFor(() => {
      expect(screen.getByText('unauthenticated')).toBeInTheDocument();
    });
  });
});
