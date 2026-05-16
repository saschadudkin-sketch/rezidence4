/**
 * platform-v1 passes client.
 * Backend: backend/src/v1/routes/passes.js
 * Spec:    docs/product/specs/platform-v1/passes-spec.md
 */

import { v1Client, type RequestOpts } from './client';
import type {
  PageMeta,
  PaginationParams,
  Pass,
  PinCredential,
  PassStatus,
  PassType,
  QrToken,
  UUID,
} from './types';

export interface ListPassesParams extends PaginationParams {
  status?: PassStatus;
  pass_type?: PassType;
  access_request_id?: UUID;
  subject_vehicle_id?: UUID;
  subject_resident_id?: UUID;
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
    return v1Client.get<{ passes: Pass[]; page?: PageMeta }>(
      `/passes${toQuery(params)}`,
      opts,
    );
  },
  getById(id: UUID, opts?: RequestOpts) {
    return v1Client.get<{ pass: Pass }>(`/passes/${id}`, opts);
  },
  getQr(id: UUID, opts?: RequestOpts) {
    return v1Client.get<{ qr: QrToken }>(`/passes/${id}/qr`, opts);
  },
  regenerateQr(id: UUID, opts?: RequestOpts) {
    return v1Client.post<{ qr: QrToken }>(`/passes/${id}/regenerate-qr`, undefined, opts);
  },
  getPin(id: UUID, opts?: RequestOpts) {
    return v1Client.get<{ pin: PinCredential }>(`/passes/${id}/pin`, opts);
  },
  regeneratePin(id: UUID, opts?: RequestOpts) {
    return v1Client.post<{ pin: PinCredential }>(`/passes/${id}/regenerate-pin`, undefined, opts);
  },
  revoke(id: UUID, reason: string, opts?: RequestOpts) {
    return v1Client.post<{ pass: Pass }>(`/passes/${id}/revoke`, { reason }, opts);
  },
  block(id: UUID, reason: string, opts?: RequestOpts) {
    return v1Client.post<{ pass: Pass }>(`/passes/${id}/block`, { reason }, opts);
  },
  unblock(id: UUID, opts?: RequestOpts) {
    return v1Client.post<{ pass: Pass }>(`/passes/${id}/unblock`, undefined, opts);
  },
};
