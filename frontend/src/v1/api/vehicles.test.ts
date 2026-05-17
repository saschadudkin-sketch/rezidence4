import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  deleteMock,
  getMock,
  patchMock,
  postMock,
} = vi.hoisted(() => ({
  deleteMock: vi.fn(),
  getMock: vi.fn(),
  patchMock: vi.fn(),
  postMock: vi.fn(),
}));

vi.mock('./client', () => ({
  v1Client: {
    delete: deleteMock,
    get: getMock,
    patch: patchMock,
    post: postMock,
  },
}));

import { vehiclesApi } from './vehicles';

describe('vehiclesApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('normalizes plates and routes vehicle reads through canonical v1 endpoints', async () => {
    getMock.mockResolvedValue({});

    await vehiclesApi.list({
      property_id: 'property-1',
      plate: ' a123bc77 ',
      owner_type: 'resident',
      is_whitelisted: true,
    });
    await vehiclesApi.getByPlate(' a-123-bc 77 ');
    await vehiclesApi.getById('vehicle/1');

    expect(getMock).toHaveBeenNthCalledWith(
      1,
      '/vehicles?property_id=property-1&plate=+a123bc77+&owner_type=resident&is_whitelisted=true',
      undefined,
    );
    expect(getMock).toHaveBeenNthCalledWith(
      2,
      '/vehicles/by-plate/A123BC77',
      undefined,
    );
    expect(getMock).toHaveBeenNthCalledWith(
      3,
      '/vehicles/vehicle%2F1',
      undefined,
    );
  });

  test('routes vehicle mutations through canonical v1 endpoints', async () => {
    postMock.mockResolvedValue({});
    patchMock.mockResolvedValue({});
    deleteMock.mockResolvedValue(undefined);

    await vehiclesApi.create({
      property_id: 'property-1',
      plate_number: ' a-123-bc 77 ',
      owner_type: 'resident',
      owner_resident_id: 'resident-1',
    });
    await vehiclesApi.update('vehicle/1', {
      brand: 'Lada',
      is_whitelisted: true,
    });
    await vehiclesApi.whitelist('vehicle/1');
    await vehiclesApi.blacklist('vehicle/1', 'security hold');
    await vehiclesApi.clearFlags('vehicle/1');
    await vehiclesApi.delete('vehicle/1');

    expect(postMock).toHaveBeenNthCalledWith(
      1,
      '/vehicles',
      {
        property_id: 'property-1',
        plate_number: 'A123BC77',
        owner_type: 'resident',
        owner_resident_id: 'resident-1',
      },
      undefined,
    );
    expect(patchMock).toHaveBeenCalledWith(
      '/vehicles/vehicle%2F1',
      {
        brand: 'Lada',
        is_whitelisted: true,
      },
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      2,
      '/vehicles/vehicle%2F1/whitelist',
      undefined,
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      3,
      '/vehicles/vehicle%2F1/blacklist',
      { reason: 'security hold' },
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      4,
      '/vehicles/vehicle%2F1/clear-flags',
      undefined,
      undefined,
    );
    expect(deleteMock).toHaveBeenCalledWith('/vehicles/vehicle%2F1', undefined);
  });
});
