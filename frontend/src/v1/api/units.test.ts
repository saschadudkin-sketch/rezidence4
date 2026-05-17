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

import { unitsApi } from './units';

describe('unitsApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('routes structure and unit reads through canonical v1 endpoints', async () => {
    getMock.mockResolvedValue({});

    await unitsApi.listBuildings();
    await unitsApi.listEntrances('building/1');
    await unitsApi.list({
      building_id: 'building-1',
      entrance_id: 'entrance-1',
      unit_type: 'apartment',
      q: '12',
      is_active: true,
      limit: 20,
    });
    await unitsApi.getById('unit/1');

    expect(getMock).toHaveBeenNthCalledWith(1, '/buildings', undefined);
    expect(getMock).toHaveBeenNthCalledWith(
      2,
      '/buildings/building%2F1/entrances',
      undefined,
    );
    expect(getMock).toHaveBeenNthCalledWith(
      3,
      '/units?building_id=building-1&entrance_id=entrance-1&unit_type=apartment&q=12&is_active=true&limit=20',
      undefined,
    );
    expect(getMock).toHaveBeenNthCalledWith(4, '/units/unit%2F1', undefined);
  });

  test('routes unit mutations through canonical v1 endpoints', async () => {
    postMock.mockResolvedValue({});
    patchMock.mockResolvedValue({});

    await unitsApi.create({
      property_id: 'property-1',
      building_id: 'building-1',
      entrance_id: 'entrance-1',
      unit_number: '12',
      unit_type: 'apartment',
      floor: 4,
    });
    await unitsApi.update('unit/1', {
      unit_number: '12A',
      floor: null,
    });
    await unitsApi.deactivate('unit/1');
    await unitsApi.createBuilding({
      property_id: 'property-1',
      name: 'Building A',
      code: 'A',
      sort_order: 1,
    });
    await unitsApi.createEntrance({
      building_id: 'building-1',
      name: 'Entrance 1',
      code: '1',
      sort_order: 2,
    });
    await unitsApi.importRows({
      property_id: 'property-1',
      property_type: 'residential_complex',
      rows: [{ unit_number: '13' }],
    });

    expect(postMock).toHaveBeenNthCalledWith(
      1,
      '/units',
      {
        property_id: 'property-1',
        building_id: 'building-1',
        entrance_id: 'entrance-1',
        unit_number: '12',
        unit_type: 'apartment',
        floor: 4,
      },
      undefined,
    );
    expect(patchMock).toHaveBeenCalledWith(
      '/units/unit%2F1',
      {
        unit_number: '12A',
        floor: null,
      },
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      2,
      '/units/unit%2F1/deactivate',
      undefined,
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      3,
      '/buildings',
      {
        property_id: 'property-1',
        name: 'Building A',
        code: 'A',
        sort_order: 1,
      },
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      4,
      '/entrances',
      {
        building_id: 'building-1',
        name: 'Entrance 1',
        code: '1',
        sort_order: 2,
      },
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      5,
      '/units/import',
      {
        property_id: 'property-1',
        property_type: 'residential_complex',
        rows: [{ unit_number: '13' }],
      },
      undefined,
    );
  });
});
