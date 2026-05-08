'use strict';

const {
  loadResourcePropertyId,
} = require('../v1/services/resourceScope');

const UUID_PROPERTY = '11111111-1111-4111-8111-111111111111';
const UUID_RESOURCE = '22222222-2222-4222-8222-222222222222';

function makeQueryable(rows) {
  return { query: jest.fn().mockResolvedValue({ rows }) };
}

describe('ResourceScopeService', () => {
  test('loads property_id for a whitelisted property-owned resource', async () => {
    const queryable = makeQueryable([{ property_id: UUID_PROPERTY }]);

    await expect(loadResourcePropertyId(queryable, 'unit', UUID_RESOURCE))
      .resolves.toBe(UUID_PROPERTY);

    expect(queryable.query.mock.calls[0][0]).toContain('FROM units');
    expect(queryable.query.mock.calls[0][1]).toEqual([UUID_RESOURCE]);
  });

  test('rejects unknown resource keys before SQL is built', async () => {
    const queryable = makeQueryable([{ property_id: UUID_PROPERTY }]);

    await expect(loadResourcePropertyId(queryable, 'users; DROP TABLE users', UUID_RESOURCE))
      .rejects.toMatchObject({
        status: 500,
        message: expect.stringContaining('Unknown property-owned resource'),
      });
    expect(queryable.query).not.toHaveBeenCalled();
  });

  test('returns configured not-found error when row is missing', async () => {
    const queryable = makeQueryable([]);

    await expect(loadResourcePropertyId(queryable, 'vehicle', UUID_RESOURCE, {
      notFoundMessage: 'Vehicle not found',
    })).rejects.toMatchObject({
      status: 404,
      message: 'Vehicle not found',
    });
  });
});
