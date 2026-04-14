import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('../providers/apiClient', () => ({
  default: {
    get: vi.fn(),
  },
}));

vi.mock('../../config/runtimeMode', () => ({
  isLiveMode: () => true,
}));

import apiClient from '../providers/apiClient';
import { canTransitionOnFrontend, getStatusTransitions, resetStatusTransitionsCache } from './statusTransitions';

describe('statusTransitions contracts', () => {
  afterEach(() => {
    vi.clearAllMocks();
    resetStatusTransitionsCache();
  });

  test('caches backend transitions contract', async () => {
    apiClient.get.mockResolvedValue({
      roles: { security: { from: ['pending'], to: ['approved'] } },
      version: 1,
    });

    await getStatusTransitions();
    await getStatusTransitions();

    expect(apiClient.get).toHaveBeenCalledTimes(1);
  });

  test('uses contract for pre-validation', async () => {
    apiClient.get.mockResolvedValue({
      roles: { security: { from: ['pending'], to: ['approved'] } },
      version: 1,
    });

    await expect(canTransitionOnFrontend('security', 'pending', 'approved')).resolves.toBe(true);
    await expect(canTransitionOnFrontend('security', 'pending', 'arrived')).resolves.toBe(false);
  });
});
