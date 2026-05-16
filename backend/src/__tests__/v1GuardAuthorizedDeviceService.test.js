'use strict';

const {
  assertGuardDeviceAuthorized,
  enrollGuardAuthorizedDevice,
  listGuardAuthorizedDevices,
  revokeGuardAuthorizedDevice,
} = require('../v1/services/guardAuthorizedDeviceService');

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111';
const POINT_ID = '22222222-2222-4222-8222-222222222222';
const STAFF_ID = '33333333-3333-4333-8333-333333333333';
const DEVICE_ID = '44444444-4444-4444-8444-444444444444';
const FINGERPRINT = 'guard-device-fingerprint-123';

function makeQueryable(handler) {
  return { query: jest.fn(handler) };
}

describe('guardAuthorizedDeviceService', () => {
  test('enrolls guard device and writes audit row', async () => {
    const row = {
      id: DEVICE_ID,
      property_id: PROPERTY_ID,
      access_point_id: POINT_ID,
      staff_user_id: STAFF_ID,
      device_fingerprint: FINGERPRINT,
      label: 'КПП Север планшет',
      status: 'active',
    };
    const queryable = makeQueryable((sql) => {
      if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: STAFF_ID }] });
      if (sql.includes('FROM access_points')) return Promise.resolve({ rows: [{ id: POINT_ID }] });
      if (sql.includes('INSERT INTO guard_authorized_devices')) return Promise.resolve({ rows: [row] });
      if (sql.includes('INSERT INTO property_audit_log')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    await expect(enrollGuardAuthorizedDevice(queryable, {
      propertyId: PROPERTY_ID,
      accessPointId: POINT_ID,
      deviceFingerprint: FINGERPRINT,
      label: 'КПП Север планшет',
      user: { uid: 'guard-1', role: 'security' },
    })).resolves.toMatchObject(row);

    const insert = queryable.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO guard_authorized_devices'));
    expect(insert[1]).toEqual([PROPERTY_ID, POINT_ID, STAFF_ID, FINGERPRINT, 'КПП Север планшет']);
    const audit = queryable.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO property_audit_log'));
    expect(audit[1][4]).toBe('guard_authorized_device.enrolled');
    expect(audit[1][5]).toContain(DEVICE_ID);
  });

  test('rejects revoked device during sensitive action check', async () => {
    const queryable = makeQueryable((sql) => {
      if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: STAFF_ID }] });
      if (sql.includes('FROM guard_authorized_devices')) {
        return Promise.resolve({
          rows: [{
            id: DEVICE_ID,
            property_id: PROPERTY_ID,
            access_point_id: POINT_ID,
            staff_user_id: STAFF_ID,
            device_fingerprint: FINGERPRINT,
            status: 'revoked',
          }],
        });
      }
      throw new Error(`unexpected SQL: ${sql}`);
    });

    await expect(assertGuardDeviceAuthorized(queryable, {
      propertyId: PROPERTY_ID,
      accessPointId: POINT_ID,
      guardDeviceId: DEVICE_ID,
      deviceFingerprint: FINGERPRINT,
      user: { uid: 'guard-1', role: 'security' },
    })).rejects.toMatchObject({
      status: 403,
      message: 'Guard device is revoked',
    });
  });

  test('lists and revokes devices in property scope', async () => {
    const row = {
      id: DEVICE_ID,
      property_id: PROPERTY_ID,
      access_point_id: POINT_ID,
      staff_user_id: STAFF_ID,
      device_fingerprint: FINGERPRINT,
      label: 'КПП Север',
      status: 'active',
    };
    const queryable = makeQueryable((sql) => {
      if (sql.includes('SELECT') && sql.includes('FROM guard_authorized_devices')) {
        return Promise.resolve({ rows: [row] });
      }
      if (sql.includes('UPDATE guard_authorized_devices')) {
        return Promise.resolve({ rows: [{ ...row, status: 'revoked' }] });
      }
      if (sql.includes('INSERT INTO property_audit_log')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    await expect(listGuardAuthorizedDevices(queryable, {
      propertyId: PROPERTY_ID,
      accessPointId: POINT_ID,
      status: 'active',
    })).resolves.toEqual([row]);

    await expect(revokeGuardAuthorizedDevice(queryable, {
      propertyId: PROPERTY_ID,
      guardDeviceId: DEVICE_ID,
      user: { uid: 'admin-1', role: 'admin' },
      reason: 'lost tablet',
    })).resolves.toMatchObject({ status: 'revoked' });
  });
});
