import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  getMock,
  postMock,
} = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
}));

vi.mock('./client', () => ({
  v1Client: {
    get: getMock,
    post: postMock,
  },
}));

import { membershipsApi } from './memberships';

describe('membershipsApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('routes membership reads through canonical v1 endpoints', async () => {
    getMock.mockResolvedValue({});

    await membershipsApi.listMine();
    await membershipsApi.list({ property_id: 'property-1', limit: 20 });

    expect(getMock).toHaveBeenNthCalledWith(1, '/memberships/me', undefined);
    expect(getMock).toHaveBeenNthCalledWith(
      2,
      '/memberships?property_id=property-1&limit=20',
      undefined,
    );
  });

  test('routes membership mutations through canonical v1 endpoints', async () => {
    postMock.mockResolvedValue({});

    await membershipsApi.create({
      property_id: 'property-1',
      subject_type: 'resident',
      resident_id: 'resident-1',
      role: 'resident',
      scope_level: 'property',
    });
    await membershipsApi.revoke('membership/1', { reason: 'offboarded' });

    expect(postMock).toHaveBeenNthCalledWith(
      1,
      '/memberships',
      {
        property_id: 'property-1',
        subject_type: 'resident',
        resident_id: 'resident-1',
        role: 'resident',
        scope_level: 'property',
      },
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      2,
      '/memberships/membership%2F1/revoke',
      { reason: 'offboarded' },
      undefined,
    );
  });
});
