import { beforeEach, describe, expect, test, vi } from 'vitest';

const { getMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
}));

vi.mock('./client', () => ({
  v1Client: {
    get: getMock,
  },
}));

import { operationsDashboardApi } from './operationsDashboard';

describe('operationsDashboardApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('routes period and property scope through canonical v1 endpoint', async () => {
    getMock.mockResolvedValue({});

    await operationsDashboardApi.get({ period: '30d', property_id: 'property-1' });
    await operationsDashboardApi.get({ period: '24h', propertyId: 'property-2' });

    expect(getMock).toHaveBeenNthCalledWith(
      1,
      '/admin/operations-dashboard?period=30d&property_id=property-1',
      undefined,
    );
    expect(getMock).toHaveBeenNthCalledWith(
      2,
      '/admin/operations-dashboard?period=24h&property_id=property-2',
      undefined,
    );
  });
});
