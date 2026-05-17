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

export type UpdateAccessPolicyBody = Partial<Omit<CreateAccessPolicyBody, 'property_id'>>;

export interface EvaluateAccessPolicyBody {
  property_id: UUID;
  subject_type?: AccessPolicySubjectType | null;
  pass_type?: string | null;
  access_method: AccessPolicyMethod;
  zone_id?: UUID | null;
  point_id?: UUID | null;
  occurred_at?: string | null;
}

export interface AccessPolicyDecision {
  allowed: boolean;
  decision: AccessPolicyEffect | 'allow';
  reason: string;
  incident_type?: string;
  severity?: string;
  matched_policy_id: UUID | null;
  matched_policy_name: string | null;
  trace: Array<Record<string, unknown>>;
}

export interface AccessPolicyTemplate extends Omit<CreateAccessPolicyBody, 'property_id'> {
  key: string;
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
  templates(params?: { property_id?: UUID }, opts?: RequestOpts) {
    return v1Client.get<{ templates: AccessPolicyTemplate[] }>(
      `/access-policy-templates${toQuery(params)}`,
      opts,
    );
  },
  list(params: ListAccessPoliciesParams, opts?: RequestOpts) {
    return v1Client.get<{ policies: AccessPolicy[]; page?: PageMeta }>(
      `/access-policies${toQuery(params)}`,
      opts,
    );
  },
  getById(id: UUID, opts?: RequestOpts) {
    return v1Client.get<{ policy: AccessPolicy }>(
      `/access-policies/${encodeURIComponent(id)}`,
      opts,
    );
  },
  create(body: CreateAccessPolicyBody, opts?: RequestOpts) {
    return v1Client.post<{ policy: AccessPolicy }>('/access-policies', body, opts);
  },
  update(id: UUID, body: UpdateAccessPolicyBody, opts?: RequestOpts) {
    return v1Client.patch<{ policy: AccessPolicy }>(
      `/access-policies/${encodeURIComponent(id)}`,
      body,
      opts,
    );
  },
  evaluate(body: EvaluateAccessPolicyBody, opts?: RequestOpts) {
    return v1Client.post<{ decision: AccessPolicyDecision }>(
      '/access-policies/evaluate',
      body,
      opts,
    );
  },
  deactivate(id: UUID, opts?: RequestOpts) {
    return v1Client.post<void>(
      `/access-policies/${encodeURIComponent(id)}/deactivate`,
      undefined,
      opts,
    );
  },
};
