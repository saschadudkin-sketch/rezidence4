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

import { guardVisitsApi } from './guardVisits';

describe('guardVisitsApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('routes guard visit reads through canonical v1 guard endpoints', async () => {
    getMock.mockResolvedValue({});

    await guardVisitsApi.list({
      pass_id: 'pass-1',
      vehicle_plate: ' a123bc77 ',
      event_type: 'entry_allowed',
      limit: 10,
      offset: 20,
    });
    await guardVisitsApi.getById('visit/1');
    await guardVisitsApi.listByPass('pass/1', { limit: 5 });
    await guardVisitsApi.listByPlate(' a123bc77 ', { offset: 10 });

    expect(getMock).toHaveBeenNthCalledWith(
      1,
      '/guard?pass_id=pass-1&vehicle_plate=A123BC77&event_type=entry_allowed&limit=10&offset=20',
      undefined,
    );
    expect(getMock).toHaveBeenNthCalledWith(
      2,
      '/guard/visit%2F1',
      undefined,
    );
    expect(getMock).toHaveBeenNthCalledWith(
      3,
      '/guard/by-pass/pass%2F1?limit=5',
      undefined,
    );
    expect(getMock).toHaveBeenNthCalledWith(
      4,
      '/guard/by-plate/A123BC77?offset=10',
      undefined,
    );
  });

  test('routes guard visit creation and verification through canonical v1 endpoints', async () => {
    postMock.mockResolvedValue({});

    await guardVisitsApi.create({
      property_id: 'property-1',
      access_point_id: 'point-1',
      event_type: 'entry_allowed',
      event_source: 'guard_console',
      vehicle_plate: ' a123bc77 ',
    });
    await guardVisitsApi.verify({
      property_id: 'property-1',
      mode: 'plate',
      plate: ' a123bc77 ',
      direction: 'entry',
    });

    expect(postMock).toHaveBeenNthCalledWith(
      1,
      '/guard',
      {
        property_id: 'property-1',
        access_point_id: 'point-1',
        event_type: 'entry_allowed',
        event_source: 'guard_console',
        vehicle_plate: 'A123BC77',
      },
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      2,
      '/guard/verify',
      {
        property_id: 'property-1',
        mode: 'plate',
        plate: 'A123BC77',
        direction: 'entry',
      },
      { skipRetry: true },
    );
  });
});
