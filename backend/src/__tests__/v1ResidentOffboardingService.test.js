'use strict';

const {
  getResidentOffboardingReport,
  isResidentOffboardingServiceError,
  offboardResident,
  transferResidentOwnership,
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
      if (sql.includes('UPDATE resident_notification_preferences')) {
        return Promise.resolve({ rows: [{ id: 'pref-1', channel: 'sms', event_scope: 'all', enabled: false }] });
      }
      if (sql.includes('UPDATE trusted_visitors')) {
        return Promise.resolve({ rows: [{ id: 'trusted-visitor-1', name: 'Mom', visitor_type: 'relative', is_active: false }] });
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
      notification_preferences_disabled: 1,
      trusted_visitors_deactivated: 1,
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
    expect(vehicleUpdate[0]).toContain('AND property_id = $3');
    expect(vehicleUpdate[1]).toEqual([UUID_RESIDENT, 'ownership transfer', UUID_PROPERTY]);

    const residentUpdate = queryable.query.mock.calls.find(([sql]) => sql.includes('UPDATE residents'));
    expect(residentUpdate[0]).toContain('AND property_id = $2');
    expect(residentUpdate[1]).toEqual([UUID_RESIDENT, UUID_PROPERTY]);

    const lifecycleInsert = queryable.query.mock.calls.find(([sql]) => sql.includes('resident_lifecycle_events'));
    const lifecycleMetadata = JSON.parse(lifecycleInsert[1][5]);
    expect(lifecycleMetadata.offboarding.pass_ids).toEqual(['pass-1']);
    expect(lifecycleMetadata.offboarding.vehicle_ids).toEqual(['vehicle-1']);
    expect(lifecycleMetadata.offboarding.notification_preference_ids).toEqual(['pref-1']);
    expect(lifecycleMetadata.offboarding.trusted_visitor_ids).toEqual(['trusted-visitor-1']);

    const trustedVisitorUpdate = queryable.query.mock.calls.find(([sql]) => sql.includes('UPDATE trusted_visitors'));
    expect(trustedVisitorUpdate[0]).toContain('WHERE property_id = $2');
    expect(trustedVisitorUpdate[0]).toContain('AND resident_id = $1');
    expect(trustedVisitorUpdate[0]).toContain('AND is_active = true');
    expect(trustedVisitorUpdate[1]).toEqual([UUID_RESIDENT, UUID_PROPERTY]);

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

  test('builds offboarding report from lifecycle events and vehicle review queue', async () => {
    const queryable = {
      query: jest.fn((sql) => {
        if (sql.includes('COUNT(*) FILTER')) {
          return Promise.resolve({ rows: [{ offboarded_residents: '3', offboarded_last_30d: '2' }] });
        }
        if (sql.includes('FROM resident_lifecycle_events e')) {
          return Promise.resolve({
            rows: [{
              id: 'event-1',
              property_id: UUID_PROPERTY,
              resident_id: UUID_RESIDENT,
              actor_uid: 'admin-1',
              actor_role: 'property_admin',
              metadata: {
                reason: 'ownership transfer',
                offboarding: {
                  revoked_passes: 1,
                  vehicles_marked_for_review: 1,
                },
              },
              created_at: '2026-05-11T08:00:00.000Z',
              full_name: 'Resident One',
              unit_id: UUID_UNIT,
              is_active: false,
            }],
          });
        }
        if (sql.includes('FROM vehicles')) {
          return Promise.resolve({
            rows: [{
              id: 'vehicle-1',
              owner_resident_id: UUID_RESIDENT,
              plate_number: 'A001AA77',
              review_required: true,
              offboarding_reason: 'ownership transfer',
            }],
          });
        }
        throw new Error(`unexpected SQL: ${sql}`);
      }),
    };

    const report = await getResidentOffboardingReport({
      queryable,
      propertyId: UUID_PROPERTY,
      limit: 10,
    });

    expect(report.summary).toMatchObject({
      offboarded_residents: 3,
      offboarded_last_30d: 2,
      vehicles_pending_review: 1,
      recent_offboarding_rows: 1,
    });
    expect(report.recent_offboardings[0]).toMatchObject({
      resident_name: 'Resident One',
      reason: 'ownership transfer',
      summary: {
        revoked_passes: 1,
        vehicles_marked_for_review: 1,
      },
    });
    expect(report.vehicle_review_queue[0].plate_number).toBe('A001AA77');
    expect(report.evidence.source_tables).toEqual(expect.arrayContaining([
      'resident_lifecycle_events',
      'vehicles',
      'trusted_visitors',
      'property_audit_log',
    ]));
    expect(queryable.query.mock.calls[1][1]).toEqual([UUID_PROPERTY, 10]);
  });

  test('transfers ownership, cascades preferences and offboards previous owner', async () => {
    const fromResidentId = UUID_RESIDENT;
    const toResidentId = '55555555-5555-4555-8555-555555555555';
    let residentLoadCount = 0;
    const queryable = {
      query: jest.fn((sql) => {
        if (sql.includes('FROM residents') && sql.includes('WHERE id = $1')) {
          residentLoadCount += 1;
          if (residentLoadCount === 2) {
            return Promise.resolve({
              rows: [{
                id: toResidentId,
                property_id: UUID_PROPERTY,
                unit_id: '66666666-6666-4666-8666-666666666666',
                external_uid: 'resident-2',
                is_active: true,
              }],
            });
          }
          return Promise.resolve({
            rows: [{
              id: fromResidentId,
              property_id: UUID_PROPERTY,
              unit_id: UUID_UNIT,
              external_uid: 'resident-1',
              is_active: true,
            }],
          });
        }
        if (sql.includes('INSERT INTO resident_notification_preferences')) {
          return Promise.resolve({ rows: [{ id: 'pref-copy-1', channel: 'sms', event_scope: 'all', enabled: true }] });
        }
        if (sql.includes('FROM staff_users') && sql.includes('external_uid')) {
          return Promise.resolve({ rows: [{ id: UUID_STAFF }] });
        }
        if (sql.includes('UPDATE residents') && sql.includes("resident_type = 'owner'")) {
          return Promise.resolve({
            rows: [{
              id: toResidentId,
              property_id: UUID_PROPERTY,
              unit_id: UUID_UNIT,
              is_active: true,
              resident_type: 'owner',
            }],
          });
        }
        if (sql.includes('UPDATE residents')) {
          return Promise.resolve({ rows: [{ id: fromResidentId, property_id: UUID_PROPERTY, unit_id: UUID_UNIT, is_active: false }] });
        }
        if (sql.includes('UPDATE role_scope_memberships')) return Promise.resolve({ rows: [{ id: 'membership-1' }] });
        if (sql.includes('UPDATE resident_unit_links') && sql.includes("relationship_type = 'owner'")) {
          return Promise.resolve({ rows: [{ id: 'old-owner-link', resident_id: fromResidentId, unit_id: UUID_UNIT }] });
        }
        if (sql.includes('UPDATE resident_unit_links')) return Promise.resolve({ rows: [{ id: 'unit-link-1', unit_id: UUID_UNIT }] });
        if (sql.includes('UPDATE passes')) return Promise.resolve({ rows: [{ id: 'pass-1' }] });
        if (sql.includes('UPDATE access_requests')) return Promise.resolve({ rows: [{ id: 'request-1' }] });
        if (sql.includes('UPDATE vehicles')) return Promise.resolve({ rows: [{ id: 'vehicle-1', review_required: true }] });
        if (sql.includes('UPDATE resident_notification_preferences')) {
          return Promise.resolve({ rows: [{ id: 'pref-1', channel: 'sms', event_scope: 'all', enabled: false }] });
        }
        if (sql.includes('UPDATE trusted_visitors')) {
          return Promise.resolve({ rows: [{ id: 'trusted-visitor-1', is_active: false }] });
        }
        if (sql.includes('INSERT INTO resident_unit_links')) {
          return Promise.resolve({ rows: [{ id: 'new-owner-link', resident_id: toResidentId, unit_id: UUID_UNIT }] });
        }
        if (sql.includes('INSERT INTO resident_ownership_transfers')) {
          return Promise.resolve({
            rows: [{
              id: 'transfer-1',
              property_id: UUID_PROPERTY,
              unit_id: UUID_UNIT,
              from_resident_id: fromResidentId,
              to_resident_id: toResidentId,
              transfer_reason: 'ownership transfer',
            }],
          });
        }
        if (sql.includes('INSERT INTO resident_lifecycle_events')) return Promise.resolve({ rows: [] });
        if (sql.includes('INSERT INTO property_audit_log')) return Promise.resolve({ rows: [] });
        throw new Error(`unexpected SQL: ${sql}`);
      }),
    };

    const result = await transferResidentOwnership({
      queryable,
      fromResidentId,
      toResidentId,
      actor: { uid: 'admin-1', role: 'property_admin' },
      reason: 'ownership transfer',
    });

    expect(result.summary).toMatchObject({
      previous_owner_links_closed: 1,
      new_owner_links_activated: 1,
      notification_preferences_copied: 1,
    });
    expect(result.summary.previous_owner_offboarding).toMatchObject({
      revoked_passes: 1,
      notification_preferences_disabled: 1,
      trusted_visitors_deactivated: 1,
    });
    expect(result.to_resident).toMatchObject({ id: toResidentId, resident_type: 'owner' });
    const targetOwnerUpdate = queryable.query.mock.calls.find(([sql]) => (
      sql.includes('UPDATE residents') && sql.includes("resident_type = 'owner'")
    ));
    expect(targetOwnerUpdate[0]).toContain('AND property_id = $3');
    expect(targetOwnerUpdate[1]).toEqual([toResidentId, UUID_UNIT, UUID_PROPERTY]);
    expect(queryable.query.mock.calls.find(([sql]) => sql.includes('resident_ownership_transfers'))[1][2])
      .toBe(fromResidentId);
    expect(queryable.query.mock.calls.find(([sql]) => sql.includes('resident.ownership_transferred'))[1][5])
      .toContain('"notification_preferences_copied":1');
  });

  test('exposes typed service errors', () => {
    const err = new (require('../v1/services/residentOffboardingService').ResidentOffboardingServiceError)(404, 'x');
    expect(isResidentOffboardingServiceError(err)).toBe(true);
  });
});
