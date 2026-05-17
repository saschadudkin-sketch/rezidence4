import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  getMock,
  patchMock,
  postMock,
} = vi.hoisted(() => ({
  getMock: vi.fn(),
  patchMock: vi.fn(),
  postMock: vi.fn(),
}));

vi.mock('./client', () => ({
  v1Client: {
    get: getMock,
    patch: patchMock,
    post: postMock,
  },
}));

import { packagesApi } from './packages';

describe('packagesApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('routes list, mine, metrics and detail through canonical package endpoints', async () => {
    getMock.mockResolvedValue({});

    await packagesApi.list({ status: 'awaiting_pickup', unit_id: 'unit-1', limit: 25 });
    await packagesApi.listMine({ limit: 10 });
    await packagesApi.getMetrics({ period: '30d' });
    await packagesApi.getById('package/1');

    expect(getMock).toHaveBeenNthCalledWith(
      1,
      '/packages?status=awaiting_pickup&unit_id=unit-1&limit=25',
      undefined,
    );
    expect(getMock).toHaveBeenNthCalledWith(2, '/packages/mine?limit=10', undefined);
    expect(getMock).toHaveBeenNthCalledWith(3, '/packages/metrics?period=30d', undefined);
    expect(getMock).toHaveBeenNthCalledWith(4, '/packages/package%2F1', undefined);
  });

  test('routes package mutations with encoded ids', async () => {
    patchMock.mockResolvedValue({});
    postMock.mockResolvedValue({});

    await packagesApi.create({ property_id: 'property-1', unit_id: 'unit-1' });
    await packagesApi.update('package/1', { carrier: 'DHL' });
    await packagesApi.pickup('package/1', { picked_up_by_name: 'Alex' });
    await packagesApi.return('package/1', { reason: 'wrong address' });
    await packagesApi.markLost('package/1', { confirm: true, reason: 'missing' });
    await packagesApi.remind('package/1');

    expect(postMock).toHaveBeenNthCalledWith(
      1,
      '/packages',
      { property_id: 'property-1', unit_id: 'unit-1' },
      undefined,
    );
    expect(patchMock).toHaveBeenCalledWith('/packages/package%2F1', { carrier: 'DHL' }, undefined);
    expect(postMock).toHaveBeenNthCalledWith(
      2,
      '/packages/package%2F1/pickup',
      { picked_up_by_name: 'Alex' },
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      3,
      '/packages/package%2F1/return',
      { reason: 'wrong address' },
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      4,
      '/packages/package%2F1/mark-lost',
      { confirm: true, reason: 'missing' },
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      5,
      '/packages/package%2F1/remind',
      undefined,
      undefined,
    );
  });
});
