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
  RequestStatus,
  RequestType,
  UUID,
} from './types';

export interface ListAccessRequestsParams {
  status?: RequestStatus;
  request_type?: RequestType;
  target_unit_id?: UUID;
  created_by_resident_id?: UUID;
  from?: IsoDateTime;
  to?: IsoDateTime;
  limit?: number;
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
  approval_required?: boolean;
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

export const accessRequestsApi = {
  list(params?: ListAccessRequestsParams, opts?: RequestOpts) {
    return v1Client.get<{ access_requests: AccessRequest[] }>(
      `/access-requests${toQuery(params)}`,
      opts,
    );
  },
  getById(id: UUID, opts?: RequestOpts) {
    return v1Client.get<AccessRequestDetailResponse>(`/access-requests/${id}`, opts);
  },
  create(body: CreateAccessRequestBody, opts?: RequestOpts) {
    return v1Client.post<{ access_request: AccessRequest }>(`/access-requests`, body, opts);
  },
  submit(id: UUID, opts?: RequestOpts) {
    return v1Client.post<{ access_request: AccessRequest }>(
      `/access-requests/${id}/submit`,
      undefined,
      opts,
    );
  },
  approve(id: UUID, comment?: string, opts?: RequestOpts) {
    return v1Client.post<{ access_request: AccessRequest; pass: unknown }>(
      `/access-requests/${id}/approve`,
      comment !== undefined ? { comment } : undefined,
      opts,
    );
  },
  reject(id: UUID, reason: string, opts?: RequestOpts) {
    return v1Client.post<{ access_request: AccessRequest }>(
      `/access-requests/${id}/reject`,
      { reason },
      opts,
    );
  },
  cancel(id: UUID, opts?: RequestOpts) {
    return v1Client.post<{ access_request: AccessRequest }>(
      `/access-requests/${id}/cancel`,
      undefined,
      opts,
    );
  },
  escalate(id: UUID, comment?: string, opts?: RequestOpts) {
    return v1Client.post<{ ok: true; access_request_id: UUID }>(
      `/access-requests/${id}/escalate`,
      comment !== undefined ? { comment } : undefined,
      opts,
    );
  },
};
