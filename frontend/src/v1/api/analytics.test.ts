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

import { analyticsApi } from './analytics';

describe('analyticsApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('routes analytics report reads through canonical v1 endpoints', async () => {
    getMock.mockResolvedValue({});

    await analyticsApi.traffic({ granularity: 'hour' });
    await analyticsApi.topResidents({ limit: 10 });
    await analyticsApi.sla({ from: '2026-05-01T00:00:00.000Z' });
    await analyticsApi.requests();
    await analyticsApi.packages({ to: '2026-05-16T00:00:00.000Z' });

    expect(getMock).toHaveBeenNthCalledWith(1, '/analytics/traffic?granularity=hour', undefined);
    expect(getMock).toHaveBeenNthCalledWith(2, '/analytics/top-residents?limit=10', undefined);
    expect(getMock).toHaveBeenNthCalledWith(
      3,
      '/analytics/sla?from=2026-05-01T00%3A00%3A00.000Z',
      undefined,
    );
    expect(getMock).toHaveBeenNthCalledWith(4, '/analytics/requests', undefined);
    expect(getMock).toHaveBeenNthCalledWith(
      5,
      '/analytics/packages?to=2026-05-16T00%3A00%3A00.000Z',
      undefined,
    );
  });

  test('routes analytics snapshot calls through canonical v1 endpoints', async () => {
    getMock.mockResolvedValue({});
    postMock.mockResolvedValue({});

    await analyticsApi.listSnapshots({ property_id: 'property-1', period: '7d' });
    await analyticsApi.latestSnapshot({ property_id: 'property-1', period: '24h' });
    await analyticsApi.createSnapshot({ property_id: 'property-1', period: '30d' });

    expect(getMock).toHaveBeenNthCalledWith(
      1,
      '/analytics/snapshots?property_id=property-1&period=7d',
      undefined,
    );
    expect(getMock).toHaveBeenNthCalledWith(
      2,
      '/analytics/snapshots/latest?property_id=property-1&period=24h',
      undefined,
    );
    expect(postMock).toHaveBeenCalledWith(
      '/analytics/snapshots',
      { property_id: 'property-1', period: '30d' },
      undefined,
    );
  });
});
