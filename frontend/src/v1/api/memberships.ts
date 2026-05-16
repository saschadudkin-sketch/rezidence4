/**
 * platform-v1 role-scope memberships client.
 * Backend: backend/src/v1/routes/memberships.js
 */

import { v1Client, type RequestOpts } from './client';
import type {
  PageMeta,
  PaginationParams,
  RoleScopeMembership,
  UUID,
} from './types';

export interface ListMembershipsParams extends PaginationParams {
  property_id: UUID;
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
};
