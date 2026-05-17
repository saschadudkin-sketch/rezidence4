import { beforeEach, describe, expect, test, vi } from 'vitest';

const { getMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
}));

vi.mock('./client', () => ({
  v1Client: {
    get: getMock,
  },
}));

import { sessionApi } from './session';

describe('sessionApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('unwraps user from the v1 auth session probe', async () => {
    const user = {
      uid: 'user-1',
      role: 'admin',
      name: 'Admin',
      property_id: 'property-1',
    };
    getMock.mockResolvedValue({ user });

    await expect(sessionApi.me()).resolves.toBe(user);
    expect(getMock).toHaveBeenCalledWith('/auth/me', undefined);
  });
});
