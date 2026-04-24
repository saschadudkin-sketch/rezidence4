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
 *   RESIDENT  = { owner, tenant, contractor }
 *   STAFF     = { concierge, security, admin }
 *   GUARD     = { security, admin }
 *   CONCIERGE = { concierge, admin }
 *
 * Legacy roles (`user`, `staff`) fall through to "not any named set" — they
 * are typed for safety but not actionable in v1 pages.
 */

import { describe, expect, test } from 'vitest';
import {
  isConciergeRole,
  isGuardRole,
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
  owner:       { resident: true,  staff: false, guard: false, concierge: false },
  tenant:      { resident: true,  staff: false, guard: false, concierge: false },
  contractor:  { resident: true,  staff: false, guard: false, concierge: false },
  concierge:   { resident: false, staff: true,  guard: false, concierge: true  },
  security:    { resident: false, staff: true,  guard: true,  concierge: false },
  admin:       { resident: false, staff: true,  guard: true,  concierge: true  },
  // Legacy roles — intentionally not members of any v1 set.
  user:        { resident: false, staff: false, guard: false, concierge: false },
  staff:       { resident: false, staff: false, guard: false, concierge: false },
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
});
