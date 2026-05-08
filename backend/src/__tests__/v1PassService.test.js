'use strict';

const {
  blockPass,
  canReadPass,
  createPass,
  getOrCreateQr,
  revokePass,
  unblockPass,
} = require('../v1/services/passService');

const UUID_PASS = '66666666-6666-4666-8666-666666666666';
const UUID_PROPERTY = '11111111-1111-4111-8111-111111111111';
const UUID_RESIDENT = '33333333-3333-4333-8333-333333333333';
const UUID_STAFF = '44444444-4444-4444-8444-444444444444';
const UUID_ZONE = '77777777-7777-4777-8777-777777777777';
const UUID_POINT = '88888888-8888-4888-8888-888888888888';

function makeQueryable(handler) {
  return { query: jest.fn(handler) };
}

describe('PassService visibility', () => {
  test('resident can read pass created from own access request', async () => {
    const queryable = makeQueryable((sql) => {
      if (sql.includes('FROM residents')) return Promise.resolve({ rows: [{ id: UUID_RESIDENT }] });
      if (sql.includes('FROM access_requests')) return Promise.resolve({ rows: [{ '?column?': 1 }] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    await expect(canReadPass({
      queryable,
      user: { uid: 'legacy-resident-1', role: 'owner' },
      isStaffUser: false,
      pass: {
        subject_resident_id: null,
        access_request_id: '22222222-2222-4222-8222-222222222222',
      },
    })).resolves.toBe(true);
  });

  test('staff visibility short-circuits without resident lookup', async () => {
    const queryable = makeQueryable(() => {
      throw new Error('staff should not query resident mapping');
    });

    await expect(canReadPass({
      queryable,
      user: { uid: 'legacy-staff-1', role: 'security' },
      isStaffUser: true,
      pass: { subject_resident_id: null, access_request_id: null },
    })).resolves.toBe(true);
  });
});

describe('PassService QR and status transitions', () => {
  test('createPass stores access topology zone and point', async () => {
    const queryable = makeQueryable((sql) => {
      if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: UUID_STAFF }] });
      if (sql.includes('INSERT INTO passes')) {
        return Promise.resolve({ rows: [{ id: UUID_PASS, zone_id: UUID_ZONE, point_id: UUID_POINT }] });
      }
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const result = await createPass({
      queryable,
      user: { uid: 'legacy-staff-1', role: 'security' },
      input: {
        property_id: UUID_PROPERTY,
        access_request_id: null,
        pass_type: 'guest',
        subject_type: 'guest',
        subject_resident_id: null,
        subject_staff_id: null,
        subject_contractor_user_id: null,
        subject_vehicle_id: null,
        zone_id: UUID_ZONE,
        point_id: UUID_POINT,
        valid_from: '2026-05-05T10:00:00.000Z',
        valid_until: '2026-05-05T12:00:00.000Z',
      },
    });

    expect(result.pass.zone_id).toBe(UUID_ZONE);
    expect(result.pass.point_id).toBe(UUID_POINT);
    const insertCall = queryable.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO passes'));
    expect(insertCall[1][8]).toBe(UUID_ZONE);
    expect(insertCall[1][9]).toBe(UUID_POINT);
    expect(insertCall[1][12]).toBe(UUID_STAFF);
  });

  test('getOrCreateQr rejects terminal passes', async () => {
    const queryable = makeQueryable((sql) => {
      if (sql.includes('FROM passes')) {
        return Promise.resolve({
          rows: [{
            id: UUID_PASS,
            access_request_id: null,
            subject_resident_id: null,
            status: 'revoked',
          }],
        });
      }
      throw new Error(`unexpected SQL: ${sql}`);
    });

    await expect(getOrCreateQr({
      queryable,
      user: { uid: 'legacy-staff-1', role: 'security' },
      isStaffUser: true,
      passId: UUID_PASS,
    })).rejects.toMatchObject({
      status: 409,
      message: "Cannot fetch QR for pass in status 'revoked'",
    });
  });

  test('revokePass writes staff_users.id, not legacy uid', async () => {
    const queryable = makeQueryable((sql) => {
      if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: UUID_STAFF }] });
      if (sql.includes('SELECT status FROM passes')) return Promise.resolve({ rows: [{ status: 'active' }] });
      if (sql.includes('UPDATE passes SET')) return Promise.resolve({ rows: [{ id: UUID_PASS, status: 'revoked' }] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const result = await revokePass({
      queryable,
      user: { uid: 'legacy-staff-1', role: 'security' },
      passId: UUID_PASS,
      reason: 'duplicate',
    });

    expect(result.pass.status).toBe('revoked');
    const updateCall = queryable.query.mock.calls.find(([sql]) => sql.includes('UPDATE passes SET'));
    expect(updateCall[1]).toEqual([UUID_STAFF, 'duplicate', UUID_PASS]);
    expect(updateCall[1]).not.toContain('legacy-staff-1');
  });

  test('blockPass rejects expired passes', async () => {
    const queryable = makeQueryable((sql) => {
      if (sql.includes('SELECT status FROM passes')) return Promise.resolve({ rows: [{ status: 'expired' }] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    await expect(blockPass({ queryable, passId: UUID_PASS })).rejects.toMatchObject({
      status: 409,
      message: "Cannot block pass in status 'expired'",
    });
  });

  test('unblockPass only accepts blocked passes', async () => {
    const queryable = makeQueryable((sql) => {
      if (sql.includes('SELECT status FROM passes')) return Promise.resolve({ rows: [{ status: 'active' }] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    await expect(unblockPass({ queryable, passId: UUID_PASS })).rejects.toMatchObject({
      status: 409,
      message: "Pass is not blocked (status='active')",
    });
  });
});
