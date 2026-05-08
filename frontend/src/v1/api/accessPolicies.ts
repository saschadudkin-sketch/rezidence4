/**
 * platform-v1 access-policies client.
 * Backend: backend/src/v1/routes/accessPolicies.js
 */

import { v1Client, type RequestOpts } from './client';
import type {
  AccessPolicy,
  AccessPolicyApprovalMode,
  AccessPolicyEffect,
  AccessPolicyMethod,
  AccessPolicySubjectType,
  PageMeta,
  PaginationParams,
  UUID,
} from './types';

export interface ListAccessPoliciesParams extends PaginationParams {
  property_id: UUID;
  is_active?: boolean;
  subject_type?: AccessPolicySubjectType;
  access_method?: AccessPolicyMethod;
  effect?: AccessPolicyEffect;
  zone_id?: UUID;
  point_id?: UUID;
}

export interface CreateAccessPolicyBody {
  property_id: UUID;
  name: string;
  subject_type: AccessPolicySubjectType;
  subject_role?: string | null;
  zone_id?: UUID | null;
  point_id?: UUID | null;
  access_method: AccessPolicyMethod;
  approval_mode?: AccessPolicyApprovalMode;
  effect?: AccessPolicyEffect;
  priority?: number;
  schedule_json?: Record<string, unknown> | null;
  duration_minutes?: number | null;
  is_recurring?: boolean;
  metadata?: Record<string, unknown>;
}

function toQuery(params: object | undefined): string {
  if (!params) return '';
  const entries = Object.entries(params).filter(
    ([, value]) => value !== undefined && value !== null && value !== '',
  );
  if (!entries.length) return '';
  const qs = new URLSearchParams();
  for (const [key, value] of entries) qs.set(key, String(value));
  return `?${qs.toString()}`;
}

export const accessPoliciesApi = {
  list(params: ListAccessPoliciesParams, opts?: RequestOpts) {
    return v1Client.get<{ policies: AccessPolicy[]; page?: PageMeta }>(
      `/access-policies${toQuery(params)}`,
      opts,
    );
  },
  create(body: CreateAccessPolicyBody, opts?: RequestOpts) {
    return v1Client.post<{ policy: AccessPolicy }>('/access-policies', body, opts);
  },
  deactivate(id: UUID, opts?: RequestOpts) {
    return v1Client.post<void>(`/access-policies/${id}/deactivate`, undefined, opts);
  },
};
