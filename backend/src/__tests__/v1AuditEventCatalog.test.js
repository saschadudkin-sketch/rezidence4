'use strict';

const {
  classifyAuditRow,
  isKnownSensitiveCategory,
  isSensitiveAuditAction,
  listSensitiveAuditActions,
  normalizeAuditAction,
} = require('../v1/services/auditEventCatalog');

describe('auditEventCatalog', () => {
  test('classifies manual override as canonical sensitive action', () => {
    const result = normalizeAuditAction('override.created');

    expect(result).toMatchObject({
      canonical_event_type: 'access.manual_override.created',
      category: 'manual_override',
      sensitivity: 'sensitive',
      sensitive: true,
      review_required: true,
    });
  });

  test('groups vehicle decisions for focused review reports', () => {
    const vehicleActions = listSensitiveAuditActions({ category: 'vehicle_decision' });

    expect(vehicleActions).toEqual(expect.arrayContaining([
      'vehicle.blacklisted',
      'vehicle.whitelisted',
      'vehicle.flags_cleared',
    ]));
  });

  test('classifies hardware manual control as hardware boundary review', () => {
    const result = normalizeAuditAction('hardware.manual_control.executed');

    expect(result).toMatchObject({
      canonical_event_type: 'hardware.manual_control.executed',
      category: 'hardware_boundary',
      sensitivity: 'sensitive',
      review_required: true,
    });
  });

  test('classifies GIS/OSS readiness package generation as restricted export', () => {
    const result = normalizeAuditAction('gis_oss.export_package.generated');

    expect(result).toMatchObject({
      canonical_event_type: 'integration.gis_oss.export_package.generated',
      category: 'export',
      sensitivity: 'restricted',
      review_required: true,
    });
  });

  test('unknown actions remain internal and do not require review', () => {
    expect(isSensitiveAuditAction('package.received')).toBe(false);
    expect(normalizeAuditAction('package.received')).toMatchObject({
      canonical_event_type: 'package.received',
      category: 'general',
      sensitivity: 'internal',
      review_required: false,
    });
  });

  test('classifyAuditRow preserves row data and adds review metadata', () => {
    const row = {
      id: 'audit-1',
      action: 'staff.updated',
      resource_type: 'staff_user',
      resource_id: 'staff-1',
    };

    expect(classifyAuditRow(row)).toMatchObject({
      id: 'audit-1',
      action: 'staff.updated',
      resource_type: 'staff_user',
      canonical_event_type: 'identity.staff.updated',
      category: 'permission_change',
      review_required: true,
    });
  });

  test('exposes category validation for routes', () => {
    expect(isKnownSensitiveCategory('manual_override')).toBe(true);
    expect(isKnownSensitiveCategory('not-a-category')).toBe(false);
  });
});
