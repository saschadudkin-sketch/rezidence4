/**
 * platform-v1 access-requests client.
 * Backend: backend/src/v1/routes/accessRequests.js
 * Spec:    docs/product/specs/platform-v1/access-requests-spec.md
 *
 * Field name note: backend uses `reason`, not `comment`, on the create body.
 * We expose the same name so nothing has to translate.
 */

import { v1Client, type RequestOpts } from './client';
import type {
  AccessRequest,
  AccessRequestDetailResponse,
  IsoDateTime,
  PageMeta,
  PaginationParams,
  PassSummary,
  RequestStatus,
  RequestType,
  UUID,
} from './types';

export interface ListAccessRequestsParams extends PaginationParams {
  status?: RequestStatus;
  request_type?: RequestType;
  target_unit_id?: UUID;
  created_by_resident_id?: UUID;
  from?: IsoDateTime;
  to?: IsoDateTime;
}

export interface CreateAccessRequestBody {
  property_id: UUID;
  target_unit_id?: UUID | null;
  target_zone_id?: UUID | null;
  target_point_id?: UUID | null;
  request_type: RequestType;
  starts_at: IsoDateTime;
  ends_at: IsoDateTime;
  visitor_name?: string | null;
  visitor_phone?: string | null;
  vehicle_id?: UUID | null;
  reason?: string | null;
  guest_instructions?: string | null;
  guard_notes?: string | null;
  share_delivery_channels?: string[];
  approval_required?: boolean;
}

type TransitionOpts = RequestOpts & {
  expectedCurrentStatus?: RequestStatus;
};

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

export const accessRequestsApi = {
  list(params?: ListAccessRequestsParams, opts?: RequestOpts) {
    return v1Client.get<{ access_requests: AccessRequest[]; page?: PageMeta }>(
      `/access-requests${toQuery(params)}`,
      opts,
    );
  },
  getById(id: UUID, opts?: RequestOpts) {
    return v1Client.get<AccessRequestDetailResponse>(`/access-requests/${id}`, opts);
  },
  create(body: CreateAccessRequestBody, opts?: RequestOpts) {
    return v1Client.post<{ access_request: AccessRequest; pass?: PassSummary | null }>(
      `/access-requests`,
      body,
      opts,
    );
  },
  submit(id: UUID, opts?: RequestOpts) {
    return v1Client.post<{ access_request: AccessRequest }>(
      `/access-requests/${id}/submit`,
      undefined,
      opts,
    );
  },
  approve(id: UUID, comment?: string, opts?: TransitionOpts) {
    const { expectedCurrentStatus, ...requestOpts } = opts ?? {};
    return v1Client.post<{ access_request: AccessRequest; pass: unknown }>(
      `/access-requests/${id}/approve`,
      { ...(comment !== undefined ? { comment } : {}), ...(expectedCurrentStatus ? { expectedCurrentStatus } : {}) },
      requestOpts,
    );
  },
  reject(id: UUID, reason: string, opts?: TransitionOpts) {
    const { expectedCurrentStatus, ...requestOpts } = opts ?? {};
    return v1Client.post<{ access_request: AccessRequest }>(
      `/access-requests/${id}/reject`,
      { reason, ...(expectedCurrentStatus ? { expectedCurrentStatus } : {}) },
      requestOpts,
    );
  },
  cancel(id: UUID, opts?: TransitionOpts) {
    const { expectedCurrentStatus, ...requestOpts } = opts ?? {};
    return v1Client.post<{ access_request: AccessRequest }>(
      `/access-requests/${id}/cancel`,
      expectedCurrentStatus ? { expectedCurrentStatus } : undefined,
      requestOpts,
    );
  },
  escalate(id: UUID, comment?: string, opts?: TransitionOpts) {
    const { expectedCurrentStatus, ...requestOpts } = opts ?? {};
    return v1Client.post<{ ok: true; access_request_id: UUID }>(
      `/access-requests/${id}/escalate`,
      { ...(comment !== undefined ? { comment } : {}), ...(expectedCurrentStatus ? { expectedCurrentStatus } : {}) },
      requestOpts,
    );
  },
};
