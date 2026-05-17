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

import { accessTopologyApi } from './accessTopology';

describe('accessTopologyApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('routes access topology reads through canonical v1 endpoints', async () => {
    getMock.mockResolvedValue({});

    await accessTopologyApi.listZones({
      property_id: 'property-1',
      zone_type: 'parking',
      is_active: true,
      limit: 20,
    });
    await accessTopologyApi.listPoints({
      property_id: 'property-1',
      zone_id: 'zone-1',
      point_type: 'gate',
      is_active: false,
      offset: 10,
    });

    expect(getMock).toHaveBeenNthCalledWith(
      1,
      '/access-zones?property_id=property-1&zone_type=parking&is_active=true&limit=20',
      undefined,
    );
    expect(getMock).toHaveBeenNthCalledWith(
      2,
      '/access-points?property_id=property-1&zone_id=zone-1&point_type=gate&is_active=false&offset=10',
      undefined,
    );
  });

  test('routes access topology mutations through canonical v1 endpoints', async () => {
    postMock.mockResolvedValue({});
    patchMock.mockResolvedValue({});

    await accessTopologyApi.createZone({
      property_id: 'property-1',
      building_id: null,
      name: 'Parking',
      zone_type: 'parking',
      sort_order: 1,
      metadata: { level: -1 },
    });
    await accessTopologyApi.updateZone('zone/1', {
      name: 'Parking A',
      is_active: true,
    });
    await accessTopologyApi.createPoint({
      property_id: 'property-1',
      zone_id: 'zone-1',
      name: 'Barrier',
      point_type: 'barrier',
      provider: 'skud',
    });
    await accessTopologyApi.updatePoint('point/1', {
      zone_id: 'zone-2',
      provider_external_id: 'device-1',
      is_active: false,
    });
    await accessTopologyApi.deactivateZone('zone/1');
    await accessTopologyApi.deactivatePoint('point/1');

    expect(postMock).toHaveBeenNthCalledWith(
      1,
      '/access-zones',
      {
        property_id: 'property-1',
        building_id: null,
        name: 'Parking',
        zone_type: 'parking',
        sort_order: 1,
        metadata: { level: -1 },
      },
      undefined,
    );
    expect(patchMock).toHaveBeenNthCalledWith(
      1,
      '/access-zones/zone%2F1',
      {
        name: 'Parking A',
        is_active: true,
      },
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      2,
      '/access-points',
      {
        property_id: 'property-1',
        zone_id: 'zone-1',
        name: 'Barrier',
        point_type: 'barrier',
        provider: 'skud',
      },
      undefined,
    );
    expect(patchMock).toHaveBeenNthCalledWith(
      2,
      '/access-points/point%2F1',
      {
        zone_id: 'zone-2',
        provider_external_id: 'device-1',
        is_active: false,
      },
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      3,
      '/access-zones/zone%2F1/deactivate',
      undefined,
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      4,
      '/access-points/point%2F1/deactivate',
      undefined,
      undefined,
    );
  });
});
