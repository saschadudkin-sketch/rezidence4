/**
 * platform-v1 role-scope memberships client.
 * Backend: backend/src/v1/routes/memberships.js
 */

import { v1Client, type RequestOpts } from './client';
import type {
  FinalUserRole,
  IsoDateTime,
  MembershipScopeLevel,
  MembershipProvisionedFrom,
  MembershipSubjectType,
  PageMeta,
  PaginationParams,
  RoleScopeMembership,
  UUID,
} from './types';

export interface ListMembershipsParams extends PaginationParams {
  property_id: UUID;
}

export interface CreateMembershipBody {
  property_id: UUID;
  subject_type: MembershipSubjectType;
  subject_id?: UUID | string | null;
  resident_id?: UUID | null;
  staff_user_id?: UUID | null;
  contractor_user_id?: UUID | null;
  external_subject_type?: string | null;
  external_subject_id?: string | null;
  role: FinalUserRole;
  scope_level?: MembershipScopeLevel;
  scope_id?: UUID | null;
  management_company_id?: UUID | null;
  starts_at?: IsoDateTime | null;
  ends_at?: IsoDateTime | null;
  created_by_staff_id?: UUID | null;
  provisioned_from?: MembershipProvisionedFrom;
}

export interface RevokeMembershipBody {
  reason?: string | null;
}

function toQuery(params: object | undefined): string {
  if (!params) return '';
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== null && v !== '',
  );
  if (!entries.length) return '';
  const qs = new URLSearchParams();
  for (const [k, v] of entries) qs.set(k, String(v));
  return `?${qs.toString()}`;
}

export const membershipsApi = {
  listMine(opts?: RequestOpts) {
    return v1Client.get<{ memberships: RoleScopeMembership[] }>('/memberships/me', opts);
  },
  list(params: ListMembershipsParams, opts?: RequestOpts) {
    return v1Client.get<{ memberships: RoleScopeMembership[]; page?: PageMeta }>(
      `/memberships${toQuery(params)}`,
      opts,
    );
  },
  create(body: CreateMembershipBody, opts?: RequestOpts) {
    return v1Client.post<{ membership: RoleScopeMembership }>(
      '/memberships',
      body,
      opts,
    );
  },
  revoke(id: UUID, body?: RevokeMembershipBody, opts?: RequestOpts) {
    return v1Client.post<{ membership: RoleScopeMembership }>(
      `/memberships/${encodeURIComponent(id)}/revoke`,
      body,
      opts,
    );
  },
};
