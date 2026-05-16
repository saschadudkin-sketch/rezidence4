import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  getMock,
  postMock,
  putMock,
} = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
  putMock: vi.fn(),
}));

vi.mock('./client', () => ({
  v1Client: {
    get: getMock,
    post: postMock,
    put: putMock,
  },
}));

import { serviceRequestsApi } from './serviceRequests';

describe('serviceRequestsApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('posts rating with the backend field name', async () => {
    postMock.mockResolvedValue({ ok: true, rating: { rating: 5 } });

    await serviceRequestsApi.rate('req/1', { rating: 5, comment: 'ok' });

    expect(postMock).toHaveBeenCalledWith(
      '/requests/req%2F1/rate',
      { rating: 5, comment: 'ok' },
      undefined,
    );
  });

  test('normalizes category property filters to propertyId', async () => {
    getMock.mockResolvedValue({ data: [] });

    await serviceRequestsApi.listCategories({ property_id: 'prop-1' });

    expect(getMock).toHaveBeenCalledWith(
      '/requests/categories?propertyId=prop-1',
      undefined,
    );
  });

  test('normalizes category upsert body to propertyId', async () => {
    putMock.mockResolvedValue({});

    await serviceRequestsApi.upsertCategory('plumber', {
      property_id: 'prop-1',
      name: 'Plumber',
    });

    expect(putMock).toHaveBeenCalledWith(
      '/requests/categories/plumber',
      { propertyId: 'prop-1', name: 'Plumber' },
      undefined,
    );
  });
});
