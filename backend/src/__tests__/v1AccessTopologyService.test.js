'use strict';

const {
  validateAccessPoint,
  validateAccessTopologyTarget,
} = require('../v1/services/accessTopologyService');

const UUID_PROPERTY = '11111111-1111-4111-8111-111111111111';
const UUID_ZONE = '22222222-2222-4222-8222-222222222222';
const UUID_OTHER_ZONE = '33333333-3333-4333-8333-333333333333';
const UUID_POINT = '44444444-4444-4444-8444-444444444444';

function makeQueryable(handler) {
  return { query: jest.fn(handler) };
}

describe('AccessTopologyService', () => {
  test('validates active zone and point from the same property', async () => {
    const queryable = makeQueryable((sql) => {
      if (sql.includes('FROM access_zones')) return Promise.resolve({ rows: [{ id: UUID_ZONE }] });
      if (sql.includes('FROM access_points')) {
        return Promise.resolve({ rows: [{ id: UUID_POINT, zone_id: UUID_ZONE }] });
      }
      throw new Error(`unexpected SQL: ${sql}`);
    });

    await expect(validateAccessTopologyTarget(queryable, {
      propertyId: UUID_PROPERTY,
      zoneId: UUID_ZONE,
      pointId: UUID_POINT,
    })).resolves.toMatchObject({
      zone: { id: UUID_ZONE },
      point: { id: UUID_POINT, zone_id: UUID_ZONE },
    });
  });

  test('rejects point that belongs to a different requested zone', async () => {
    const queryable = makeQueryable((sql) => {
      if (sql.includes('FROM access_zones')) return Promise.resolve({ rows: [{ id: UUID_ZONE }] });
      if (sql.includes('FROM access_points')) {
        return Promise.resolve({ rows: [{ id: UUID_POINT, zone_id: UUID_OTHER_ZONE }] });
      }
      throw new Error(`unexpected SQL: ${sql}`);
    });

    await expect(validateAccessTopologyTarget(queryable, {
      propertyId: UUID_PROPERTY,
      zoneId: UUID_ZONE,
      pointId: UUID_POINT,
      zoneField: 'target_zone_id',
      pointField: 'target_point_id',
    })).rejects.toMatchObject({
      status: 400,
      message: 'target_point_id does not belong to target_zone_id',
    });
  });

  test('validates a standalone access point for visit logs', async () => {
    const queryable = makeQueryable((sql) => {
      if (sql.includes('FROM access_points')) {
        return Promise.resolve({ rows: [{ id: UUID_POINT, zone_id: UUID_ZONE }] });
      }
      throw new Error(`unexpected SQL: ${sql}`);
    });

    await expect(validateAccessPoint(queryable, {
      propertyId: UUID_PROPERTY,
      accessPointId: UUID_POINT,
    })).resolves.toMatchObject({
      point: { id: UUID_POINT, zone_id: UUID_ZONE },
    });
  });
});
