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

import { erpExchangeApi } from './erpExchange';

describe('erpExchangeApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('routes provider reads and writes through canonical v1 endpoints', async () => {
    getMock.mockResolvedValue({});
    postMock.mockResolvedValue({});

    await erpExchangeApi.listProviders({ property_id: 'property-1', status: 'active' });
    await erpExchangeApi.createProvider({
      property_id: 'property-1',
      provider: '1c_zhkh',
      displayName: '1C ZHKH',
      syncMode: 'hybrid',
      authRef: 'vault://erp/1c-main',
    });

    expect(getMock).toHaveBeenCalledWith(
      '/erp/providers?property_id=property-1&status=active',
      undefined,
    );
    expect(postMock).toHaveBeenCalledWith(
      '/erp/providers',
      {
        property_id: 'property-1',
        provider: '1c_zhkh',
        displayName: '1C ZHKH',
        syncMode: 'hybrid',
        authRef: 'vault://erp/1c-main',
      },
      undefined,
    );
  });

  test('routes import preview and apply through encoded provider ids', async () => {
    postMock.mockResolvedValue({});

    const body = {
      property_id: 'property-1',
      dataset: 'resident_registry' as const,
      source: 'csv' as const,
      rows: [{ external_id: 'r-1', full_name: 'Ivan Petrov' }],
    };

    await erpExchangeApi.previewImport('provider/1', body);
    await erpExchangeApi.applyImport('provider/1', body);

    expect(postMock).toHaveBeenNthCalledWith(
      1,
      '/erp/providers/provider%2F1/import/preview',
      body,
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      2,
      '/erp/providers/provider%2F1/import/apply',
      body,
      undefined,
    );
  });

  test('routes export and sync job reads through canonical v1 endpoints', async () => {
    getMock.mockResolvedValue({});
    postMock.mockResolvedValue({});

    await erpExchangeApi.exportDataset('provider/1', {
      property_id: 'property-1',
      dataset: 'request_summary',
      fromAt: '2026-05-01T00:00:00.000Z',
      limit: 100,
    });
    await erpExchangeApi.getSyncJob('job/1', { property_id: 'property-1' });

    expect(postMock).toHaveBeenCalledWith(
      '/erp/providers/provider%2F1/export',
      {
        property_id: 'property-1',
        dataset: 'request_summary',
        fromAt: '2026-05-01T00:00:00.000Z',
        limit: 100,
      },
      undefined,
    );
    expect(getMock).toHaveBeenCalledWith(
      '/erp/sync-jobs/job%2F1?property_id=property-1',
      undefined,
    );
  });
});
