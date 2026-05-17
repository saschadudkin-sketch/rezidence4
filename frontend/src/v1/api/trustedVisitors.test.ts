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

import { trustedVisitorsApi } from './trustedVisitors';

describe('trustedVisitorsApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('routes trusted visitor reads and writes through canonical v1 endpoints', async () => {
    getMock.mockResolvedValue({});
    patchMock.mockResolvedValue({});
    postMock.mockResolvedValue({});

    await trustedVisitorsApi.list({ property_id: 'property-1', include_inactive: true });
    await trustedVisitorsApi.create({ property_id: 'property-1', name: 'Guest' });
    await trustedVisitorsApi.update('visitor/1', { default_instructions: 'Call first' });
    await trustedVisitorsApi.deactivate('visitor/1', { property_id: 'property-1' });
    await trustedVisitorsApi.createPass('visitor/1', {
      property_id: 'property-1',
      target_unit_id: 'unit-1',
      starts_at: '2026-05-17T08:00:00.000Z',
      ends_at: '2026-05-17T12:00:00.000Z',
    });

    expect(getMock).toHaveBeenCalledWith(
      '/trusted-visitors?property_id=property-1&include_inactive=true',
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      1,
      '/trusted-visitors',
      { property_id: 'property-1', name: 'Guest' },
      undefined,
    );
    expect(patchMock).toHaveBeenCalledWith(
      '/trusted-visitors/visitor%2F1',
      { default_instructions: 'Call first' },
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      2,
      '/trusted-visitors/visitor%2F1/deactivate',
      { property_id: 'property-1' },
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      3,
      '/trusted-visitors/visitor%2F1/create-pass',
      {
        property_id: 'property-1',
        target_unit_id: 'unit-1',
        starts_at: '2026-05-17T08:00:00.000Z',
        ends_at: '2026-05-17T12:00:00.000Z',
      },
      undefined,
    );
  });
});
