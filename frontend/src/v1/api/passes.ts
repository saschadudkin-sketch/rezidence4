/**
 * platform-v1 passes client.
 * Backend: backend/src/v1/routes/passes.js
 * Spec:    docs/product/specs/platform-v1/passes-spec.md
 */

import { v1Client, type RequestOpts } from './client';
import type {
  AdminPassListItem,
  PageMeta,
  PaginationParams,
  Pass,
  PinCredential,
  PassStatus,
  PassType,
  QrToken,
  SubjectType,
  UUID,
} from './types';

export interface ListPassesParams extends PaginationParams {
  property_id?: UUID;
  status?: PassStatus;
  pass_type?: PassType;
  access_request_id?: UUID;
  subject_vehicle_id?: UUID;
  subject_resident_id?: UUID;
  q?: string;
}

export interface CreatePassBody {
  property_id: UUID;
  pass_type: PassType;
  subject_type: SubjectType;
  subject_resident_id?: UUID | null;
  subject_staff_id?: UUID | null;
  subject_contractor_user_id?: UUID | null;
  subject_vehicle_id?: UUID | null;
  zone_id?: UUID | null;
  point_id?: UUID | null;
  valid_from: string;
  valid_until: string;
  access_request_id?: UUID | null;
}

export interface UnblockPassBody {
  reason: string;
  policy_id?: UUID | null;
  override_id?: UUID | null;
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

export const passesApi = {
  list(params?: ListPassesParams, opts?: RequestOpts) {
    return v1Client.get<{ passes: AdminPassListItem[]; page?: PageMeta }>(
      `/passes${toQuery(params)}`,
      opts,
    );
  },
  getById(id: UUID, opts?: RequestOpts) {
    return v1Client.get<{ pass: Pass; qr: QrToken | null }>(
      `/passes/${encodeURIComponent(id)}`,
      opts,
    );
  },
  getQr(id: UUID, opts?: RequestOpts) {
    return v1Client.get<{ qr: QrToken }>(`/passes/${encodeURIComponent(id)}/qr`, opts);
  },
  regenerateQr(id: UUID, opts?: RequestOpts) {
    return v1Client.post<{ qr: QrToken }>(
      `/passes/${encodeURIComponent(id)}/regenerate-qr`,
      undefined,
      opts,
    );
  },
  getPin(id: UUID, opts?: RequestOpts) {
    return v1Client.get<{ pin: PinCredential }>(`/passes/${encodeURIComponent(id)}/pin`, opts);
  },
  regeneratePin(id: UUID, opts?: RequestOpts) {
    return v1Client.post<{ pin: PinCredential }>(
      `/passes/${encodeURIComponent(id)}/regenerate-pin`,
      undefined,
      opts,
    );
  },
  create(body: CreatePassBody, opts?: RequestOpts) {
    return v1Client.post<{ pass: Pass }>('/passes', body, opts);
  },
  revoke(id: UUID, reason: string, opts?: RequestOpts) {
    return v1Client.post<{ pass: Pass }>(
      `/passes/${encodeURIComponent(id)}/revoke`,
      { reason },
      opts,
    );
  },
  block(id: UUID, reason: string, opts?: RequestOpts) {
    return v1Client.post<{ pass: Pass }>(
      `/passes/${encodeURIComponent(id)}/block`,
      { reason },
      opts,
    );
  },
  unblock(id: UUID, body: UnblockPassBody, opts?: RequestOpts) {
    return v1Client.post<{ pass: Pass }>(
      `/passes/${encodeURIComponent(id)}/unblock`,
      body,
      opts,
    );
  },
};
