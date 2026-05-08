/**
 * Role-predicate smoke tests.
 *
 * These predicates drive RoleGate decisions across the v1 surface — if they
 * drift, the wrong role can land on the wrong page (a resident on the guard
 * console, or vice-versa).  We lock the truth table here so the test fails
 * loudly if the sets in store/session.tsx are edited without updating the
 * consumer pages.
 *
 * Truth table (from store/session.tsx):
 *   RESIDENT  = { resident } plus legacy { owner, tenant }
 *   STAFF     = { concierge, security, technician, property_admin, management_company_admin, platform_admin, staff }
 *   GUARD     = { security, property_admin, management_company_admin, platform_admin }
 *   CONCIERGE = { concierge, property_admin, management_company_admin, platform_admin }
 *
 * Legacy `user` falls through to "not any named set" — it is typed for safety
 * but not actionable in v1 pages.
 */

import { describe, expect, test } from 'vitest';
import {
  isConciergeRole,
  isGuardRole,
  normalizeUserRole,
  isResidentRole,
  isStaffRole,
} from './index';
import type { UserRole } from '../api/types';

// Using an object literal pinned to UserRole ensures every known role is
// enumerated — a new role in api/types.ts will trigger a TS error here until
// the matrix is updated, making the drift visible in CI.
const matrix: Record<UserRole, {
  resident: boolean;
  staff: boolean;
  guard: boolean;
  concierge: boolean;
}> = {
  resident:    { resident: true,  staff: false, guard: false, concierge: false },
  owner:       { resident: true,  staff: false, guard: false, concierge: false },
  tenant:      { resident: true,  staff: false, guard: false, concierge: false },
  contractor:  { resident: false, staff: false, guard: false, concierge: false },
  concierge:   { resident: false, staff: true,  guard: false, concierge: true  },
  security:    { resident: false, staff: true,  guard: true,  concierge: false },
  technician:  { resident: false, staff: true,  guard: false, concierge: false },
  property_admin: { resident: false, staff: true, guard: true, concierge: true },
  management_company_admin: { resident: false, staff: true, guard: true, concierge: true },
  platform_admin: { resident: false, staff: true, guard: true, concierge: true },
  admin:       { resident: false, staff: true,  guard: true,  concierge: true  },
  // Legacy roles — `user` is intentionally not a member of any v1 set.
  user:        { resident: false, staff: false, guard: false, concierge: false },
  staff:       { resident: false, staff: true,  guard: false, concierge: false },
};

describe('v1 role predicates', () => {
  for (const [role, expected] of Object.entries(matrix) as [UserRole, typeof matrix[UserRole]][]) {
    test(`${role} → resident=${expected.resident} staff=${expected.staff} guard=${expected.guard} concierge=${expected.concierge}`, () => {
      expect(isResidentRole(role)).toBe(expected.resident);
      expect(isStaffRole(role)).toBe(expected.staff);
      expect(isGuardRole(role)).toBe(expected.guard);
      expect(isConciergeRole(role)).toBe(expected.concierge);
    });
  }

  test('admin is both guard and concierge (matters for /v1 landing priority)', () => {
    expect(isGuardRole('admin')).toBe(true);
    expect(isConciergeRole('admin')).toBe(true);
  });

  test('security is guard-only (not concierge) — /v1 sends them to /v1/guard', () => {
    expect(isGuardRole('security')).toBe(true);
    expect(isConciergeRole('security')).toBe(false);
  });

  test('legacy roles normalize to the backend Phase 3 final roles', () => {
    expect(normalizeUserRole('owner')).toBe('resident');
    expect(normalizeUserRole('tenant')).toBe('resident');
    expect(normalizeUserRole('admin')).toBe('property_admin');
    expect(normalizeUserRole('contractor')).toBe('contractor');
  });
});
