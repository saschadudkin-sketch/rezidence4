/**
 * TEST-04: RBAC edge case tests.
 *
 * Covers permission boundaries that are critical for security:
 * - Concierge cannot approve/reject requests (security/admin only)
 * - Scheduled requests are not editable after they activate
 * - Owner can only edit/delete their own requests
 * - Admin can delete any request regardless of owner
 */

import { describe, it, expect } from 'vitest';
import {
  can,
  canApproveRequest,
  canRejectRequest,
  canEditRequest,
  canDeleteRequest,
  ROLES,
} from './permissions';

const makeUser = (role, uid = 'u1') => ({ uid, role, name: 'Test' });
const makeReq  = (overrides = {}) => ({
  id: 'r1',
  createdByUid: 'u1',
  status: 'pending',
  type: 'pass',
  passDuration: 'once',
  ...overrides,
});

// ─── Approve / Reject ─────────────────────────────────────────────────────────

describe('canApproveRequest', () => {
  it('security can approve pending request', () => {
    expect(canApproveRequest(makeUser(ROLES.SECURITY), makeReq())).toBe(true);
  });

  it('admin can approve pending request', () => {
    expect(canApproveRequest(makeUser(ROLES.ADMIN), makeReq())).toBe(true);
  });

  it('concierge CANNOT approve requests (view-only role)', () => {
    expect(canApproveRequest(makeUser(ROLES.CONCIERGE), makeReq())).toBe(false);
  });

  it('owner CANNOT approve their own request', () => {
    expect(canApproveRequest(makeUser(ROLES.OWNER), makeReq())).toBe(false);
  });

  it('nobody can approve an already-approved request', () => {
    const req = makeReq({ status: 'approved' });
    expect(canApproveRequest(makeUser(ROLES.SECURITY), req)).toBe(false);
    expect(canApproveRequest(makeUser(ROLES.ADMIN), req)).toBe(false);
  });

  it('nobody can approve an arrived request', () => {
    const req = makeReq({ status: 'arrived' });
    expect(canApproveRequest(makeUser(ROLES.SECURITY), req)).toBe(false);
  });
});

describe('canRejectRequest', () => {
  it('concierge CANNOT reject requests', () => {
    expect(canRejectRequest(makeUser(ROLES.CONCIERGE), makeReq())).toBe(false);
  });

  it('security can reject pending request', () => {
    expect(canRejectRequest(makeUser(ROLES.SECURITY), makeReq())).toBe(true);
  });

  it('security can reject an already-approved pass', () => {
    expect(canRejectRequest(makeUser(ROLES.SECURITY), makeReq({ status: 'approved', type: 'pass' }))).toBe(true);
  });
});

// ─── Edit / Delete ────────────────────────────────────────────────────────────

describe('canEditRequest', () => {
  it('owner can edit their own pending pass', () => {
    expect(canEditRequest(makeUser(ROLES.OWNER, 'u1'), makeReq({ createdByUid: 'u1' }))).toBe(true);
  });

  it('owner CANNOT edit another user\'s request', () => {
    expect(canEditRequest(makeUser(ROLES.OWNER, 'u1'), makeReq({ createdByUid: 'u2' }))).toBe(false);
  });

  it('owner CANNOT edit an approved request', () => {
    const req = makeReq({ createdByUid: 'u1', status: 'approved' });
    expect(canEditRequest(makeUser(ROLES.OWNER, 'u1'), req)).toBe(false);
  });

  it('owner CANNOT edit an arrived request', () => {
    const req = makeReq({ createdByUid: 'u1', status: 'arrived' });
    expect(canEditRequest(makeUser(ROLES.OWNER, 'u1'), req)).toBe(false);
  });
});

describe('canDeleteRequest', () => {
  it('admin can delete any request', () => {
    const req = makeReq({ createdByUid: 'other-user' });
    expect(canDeleteRequest(makeUser(ROLES.ADMIN, 'admin1'), req)).toBe(true);
  });

  it('owner can delete their own pending request', () => {
    expect(canDeleteRequest(makeUser(ROLES.OWNER, 'u1'), makeReq({ createdByUid: 'u1' }))).toBe(true);
  });

  it('owner CANNOT delete another user\'s request', () => {
    expect(canDeleteRequest(makeUser(ROLES.OWNER, 'u1'), makeReq({ createdByUid: 'u2' }))).toBe(false);
  });
});

// ─── can() fluent API ────────────────────────────────────────────────────────

describe('can() fluent API mirrors individual predicates', () => {
  it('can(concierge).approveRequest returns false', () => {
    const c = makeUser(ROLES.CONCIERGE);
    const req = makeReq();
    expect(can(c).approveRequest(req)).toBe(false);
  });

  it('can(security).approveRequest returns true for pending', () => {
    const s = makeUser(ROLES.SECURITY);
    const req = makeReq({ status: 'pending' });
    expect(can(s).approveRequest(req)).toBe(true);
  });

  it('can(owner).editRequest returns false for approved', () => {
    const o = makeUser(ROLES.OWNER, 'u1');
    const req = makeReq({ createdByUid: 'u1', status: 'approved' });
    expect(can(o).editRequest(req)).toBe(false);
  });
});
