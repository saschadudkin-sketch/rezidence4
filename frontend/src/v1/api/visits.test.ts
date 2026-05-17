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

import { visitsApi } from './visits';

describe('visitsApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('routes visit reads through canonical v1 endpoints', async () => {
    getMock.mockResolvedValue({});

    await visitsApi.list({
      pass_id: 'pass-1',
      vehicle_plate: ' a-123-bc 77 ',
      event_type: 'entry_allowed',
      limit: 10,
      offset: 20,
    });
    await visitsApi.getById('visit/1');
    await visitsApi.listByPass('pass/1', { limit: 5 });
    await visitsApi.listByPlate(' a-123-bc 77 ', { offset: 10 });

    expect(getMock).toHaveBeenNthCalledWith(
      1,
      '/visits?pass_id=pass-1&vehicle_plate=A123BC77&event_type=entry_allowed&limit=10&offset=20',
      undefined,
    );
    expect(getMock).toHaveBeenNthCalledWith(
      2,
      '/visits/visit%2F1',
      undefined,
    );
    expect(getMock).toHaveBeenNthCalledWith(
      3,
      '/visits/by-pass/pass%2F1?limit=5',
      undefined,
    );
    expect(getMock).toHaveBeenNthCalledWith(
      4,
      '/visits/by-plate/A123BC77?offset=10',
      undefined,
    );
  });

  test('routes visit creation and verification through canonical v1 endpoints', async () => {
    postMock.mockResolvedValue({});

    await visitsApi.create({
      property_id: 'property-1',
      access_point_id: 'point-1',
      event_type: 'entry_allowed',
      event_source: 'skud',
      vehicle_plate: ' a-123-bc 77 ',
    });
    await visitsApi.verify({
      property_id: 'property-1',
      mode: 'plate',
      plate: ' a-123-bc 77 ',
      direction: 'entry',
    });
    await visitsApi.scanPass({
      property_id: 'property-1',
      token: 'qr-token-value-1234',
      direction: 'exit',
    });

    expect(postMock).toHaveBeenNthCalledWith(
      1,
      '/visits',
      {
        property_id: 'property-1',
        access_point_id: 'point-1',
        event_type: 'entry_allowed',
        event_source: 'skud',
        vehicle_plate: 'A123BC77',
      },
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      2,
      '/visits/verify',
      {
        property_id: 'property-1',
        mode: 'plate',
        plate: 'A123BC77',
        direction: 'entry',
      },
      { skipRetry: true },
    );
    expect(postMock).toHaveBeenNthCalledWith(
      3,
      '/visits/scan-pass',
      {
        property_id: 'property-1',
        token: 'qr-token-value-1234',
        direction: 'exit',
      },
      { skipRetry: true },
    );
  });
});
