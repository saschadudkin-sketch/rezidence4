'use strict';

const {
  blacklistVehicle,
  createVehicle,
  deleteVehicle,
  updateVehicle,
  whitelistVehicle,
} = require('../v1/services/vehicleService');

const UUID_PROPERTY = '11111111-1111-4111-8111-111111111111';
const UUID_VEHICLE = '22222222-2222-4222-8222-222222222222';
const UUID_RESIDENT = '33333333-3333-4333-8333-333333333333';

function makeQueryable(handler) {
  return { query: jest.fn(handler) };
}

function validVehicleInput(overrides = {}) {
  return {
    property_id: UUID_PROPERTY,
    owner_type: 'resident',
    owner_resident_id: UUID_RESIDENT,
    owner_staff_id: null,
    owner_contractor_user_id: null,
    plate_number: 'A123BC777',
    vehicle_type: 'car',
    color: null,
    brand: null,
    model: null,
    notes: null,
    ...overrides,
  };
}

describe('VehicleService ownership checks', () => {
  test('resident create writes only when owner_resident_id matches mapped v1 resident', async () => {
    const queryable = makeQueryable((sql) => {
      if (sql.includes('FROM residents')) return Promise.resolve({ rows: [{ id: UUID_RESIDENT }] });
      if (sql.includes('INSERT INTO vehicles')) {
        return Promise.resolve({ rows: [{ id: UUID_VEHICLE, owner_resident_id: UUID_RESIDENT }] });
      }
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const result = await createVehicle({
      queryable,
      user: { uid: 'legacy-resident-1', role: 'owner' },
      isPropertyAdmin: false,
      input: validVehicleInput(),
    });

    expect(result.vehicle.id).toBe(UUID_VEHICLE);
    const insertCall = queryable.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO vehicles'));
    expect(insertCall[1][2]).toBe(UUID_RESIDENT);
    expect(insertCall[1]).not.toContain('legacy-resident-1');
  });

  test('resident create rejects another resident id before insert', async () => {
    const queryable = makeQueryable((sql) => {
      if (sql.includes('FROM residents')) return Promise.resolve({ rows: [{ id: UUID_RESIDENT }] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    await expect(createVehicle({
      queryable,
      user: { uid: 'legacy-resident-1', role: 'owner' },
      isPropertyAdmin: false,
      input: validVehicleInput({ owner_resident_id: '44444444-4444-4444-8444-444444444444' }),
    })).rejects.toMatchObject({
      status: 403,
      message: 'Residents may register only their own vehicle',
    });

    expect(queryable.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO vehicles'))).toBe(false);
  });

  test('update rejects non-owner resident', async () => {
    const queryable = makeQueryable((sql) => {
      if (sql.includes('FROM vehicles')) return Promise.resolve({ rows: [{ owner_resident_id: UUID_RESIDENT }] });
      if (sql.includes('FROM residents')) {
        return Promise.resolve({ rows: [{ id: '44444444-4444-4444-8444-444444444444' }] });
      }
      throw new Error(`unexpected SQL: ${sql}`);
    });

    await expect(updateVehicle({
      queryable,
      user: { uid: 'legacy-resident-2', role: 'owner' },
      isPropertyAdmin: false,
      vehicleId: UUID_VEHICLE,
      changes: { color: 'black' },
    })).rejects.toMatchObject({ status: 403, message: 'Forbidden' });
  });
});

describe('VehicleService mutations', () => {
  test('whitelist and blacklist are mutually exclusive writes', async () => {
    const queryable = makeQueryable((sql) => {
      if (sql.includes('UPDATE vehicles')) {
        return Promise.resolve({ rows: [{ id: UUID_VEHICLE, is_whitelisted: true, is_blacklisted: false }] });
      }
      if (sql.includes('INSERT INTO notifications_outbox')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    await whitelistVehicle({ queryable, vehicleId: UUID_VEHICLE });
    expect(queryable.query.mock.calls[0][1]).toEqual([UUID_VEHICLE, true, false]);

    queryable.query.mockClear();
    queryable.query.mockImplementation((sql) => {
      if (sql.includes('UPDATE vehicles')) {
        return Promise.resolve({ rows: [{ id: UUID_VEHICLE, is_whitelisted: false, is_blacklisted: true }] });
      }
      if (sql.includes('INSERT INTO notifications_outbox')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });
    await blacklistVehicle({ queryable, vehicleId: UUID_VEHICLE });
    expect(queryable.query.mock.calls[0][1]).toEqual([UUID_VEHICLE, false, true]);
  });

  test('delete rejects vehicles with pass or request history and returns counts', async () => {
    const queryable = makeQueryable((sql) => {
      if (sql.includes('FROM vehicles')) return Promise.resolve({ rows: [{ owner_resident_id: UUID_RESIDENT }] });
      if (sql.includes('COUNT(*)::int FROM passes')) {
        return Promise.resolve({ rows: [{ passes_count: 1, requests_count: 2 }] });
      }
      throw new Error(`unexpected SQL: ${sql}`);
    });

    await expect(deleteVehicle({
      queryable,
      user: { uid: 'admin', role: 'admin' },
      isPropertyAdmin: true,
      vehicleId: UUID_VEHICLE,
    })).rejects.toMatchObject({
      status: 409,
      message: 'Cannot delete: vehicle has history',
      details: { passes: 1, access_requests: 2 },
    });
    expect(queryable.query.mock.calls.some(([sql]) => sql.includes('DELETE FROM vehicles'))).toBe(false);
  });
});
