'use strict';

const {
  isResidentOffboardingServiceError,
  offboardResident,
} = require('../v1/services/residentOffboardingService');

const UUID_RESIDENT = '11111111-1111-4111-8111-111111111111';
const UUID_PROPERTY = '22222222-2222-4222-8222-222222222222';
const UUID_UNIT = '33333333-3333-4333-8333-333333333333';
const UUID_STAFF = '44444444-4444-4444-8444-444444444444';

function makeQueryable() {
  return {
    query: jest.fn((sql) => {
      if (sql.includes('FROM residents') && sql.includes('WHERE id = $1')) {
        return Promise.resolve({
          rows: [{
            id: UUID_RESIDENT,
            property_id: UUID_PROPERTY,
            unit_id: UUID_UNIT,
            external_uid: 'resident-1',
            is_active: true,
          }],
        });
      }
      if (sql.includes('FROM staff_users') && sql.includes('external_uid')) {
        return Promise.resolve({ rows: [{ id: UUID_STAFF }] });
      }
      if (sql.includes('UPDATE residents')) {
        return Promise.resolve({
          rows: [{
            id: UUID_RESIDENT,
            property_id: UUID_PROPERTY,
            unit_id: UUID_UNIT,
            external_uid: 'resident-1',
            is_active: false,
          }],
        });
      }
      if (sql.includes('UPDATE role_scope_memberships')) {
        return Promise.resolve({ rows: [{ id: 'membership-1' }, { id: 'membership-2' }] });
      }
      if (sql.includes('UPDATE resident_unit_links')) {
        return Promise.resolve({ rows: [{ id: 'unit-link-1', unit_id: UUID_UNIT }] });
      }
      if (sql.includes('UPDATE passes')) {
        return Promise.resolve({ rows: [{ id: 'pass-1', subject_type: 'resident' }] });
      }
      if (sql.includes('UPDATE access_requests')) {
        return Promise.resolve({ rows: [{ id: 'request-1', request_type: 'guest_access' }] });
      }
      if (sql.includes('UPDATE vehicles')) {
        return Promise.resolve({ rows: [{ id: 'vehicle-1', plate_number: 'A001AA77', review_required: true }] });
      }
      if (sql.includes('INSERT INTO resident_lifecycle_events')) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes('INSERT INTO property_audit_log')) {
        return Promise.resolve({ rows: [] });
      }
      throw new Error(`unexpected SQL: ${sql}`);
    }),
  };
}

describe('resident offboarding service', () => {
  test('deactivates resident and cascades memberships, unit links, passes, requests and vehicles', async () => {
    const queryable = makeQueryable();

    const result = await offboardResident({
      queryable,
      residentId: UUID_RESIDENT,
      actor: { uid: 'admin-1', role: 'property_admin', ipAddress: '127.0.0.1' },
      reason: 'ownership transfer',
    });

    expect(result.summary).toEqual({
      suspended_memberships: 2,
      revoked_passes: 1,
      deactivated_unit_links: 1,
      vehicles_marked_for_review: 1,
      cancelled_access_requests: 1,
    });
    expect(result.resident.is_active).toBe(false);

    const passUpdate = queryable.query.mock.calls.find(([sql]) => sql.includes('UPDATE passes'));
    expect(passUpdate[0]).toContain("p.status IN ('active','blocked')");
    expect(passUpdate[0]).toContain('p.subject_resident_id = $1');
    expect(passUpdate[0]).toContain('p.subject_vehicle_id IN');
    expect(passUpdate[1]).toEqual([
      UUID_RESIDENT,
      UUID_STAFF,
      'resident offboarded: ownership transfer',
      UUID_PROPERTY,
    ]);

    const vehicleUpdate = queryable.query.mock.calls.find(([sql]) => sql.includes('UPDATE vehicles'));
    expect(vehicleUpdate[0]).toContain('is_whitelisted = false');
    expect(vehicleUpdate[0]).toContain('review_required = true');
    expect(vehicleUpdate[1]).toEqual([UUID_RESIDENT, 'ownership transfer']);

    const lifecycleInsert = queryable.query.mock.calls.find(([sql]) => sql.includes('resident_lifecycle_events'));
    const lifecycleMetadata = JSON.parse(lifecycleInsert[1][5]);
    expect(lifecycleMetadata.offboarding.pass_ids).toEqual(['pass-1']);
    expect(lifecycleMetadata.offboarding.vehicle_ids).toEqual(['vehicle-1']);

    const auditInsert = queryable.query.mock.calls.find(([sql]) => sql.includes('property_audit_log'));
    expect(auditInsert[0]).toContain('resident.deactivated');
    expect(JSON.parse(auditInsert[1][4]).offboarding).toMatchObject(result.summary);
  });

  test('rejects overlong offboarding reason', async () => {
    await expect(offboardResident({
      queryable: makeQueryable(),
      residentId: UUID_RESIDENT,
      actor: { uid: 'admin-1', role: 'property_admin' },
      reason: 'x'.repeat(501),
    })).rejects.toMatchObject({
      status: 400,
      message: 'reason is too long',
    });
  });

  test('exposes typed service errors', () => {
    const err = new (require('../v1/services/residentOffboardingService').ResidentOffboardingServiceError)(404, 'x');
    expect(isResidentOffboardingServiceError(err)).toBe(true);
  });
});
