/**
 * platform-v1 passes client.
 * Backend: backend/src/v1/routes/passes.js
 * Spec:    docs/product/specs/platform-v1/passes-spec.md
 */

import { v1Client, type RequestOpts } from './client';
import type { Pass, PassStatus, PassType, QrToken, UUID } from './types';

export interface ListPassesParams {
  status?: PassStatus;
  pass_type?: PassType;
  access_request_id?: UUID;
  subject_vehicle_id?: UUID;
  subject_resident_id?: UUID;
  limit?: number;
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
    return v1Client.get<{ passes: Pass[] }>(`/passes${toQuery(params)}`, opts);
  },
  getById(id: UUID, opts?: RequestOpts) {
    return v1Client.get<{ pass: Pass }>(`/passes/${id}`, opts);
  },
  getQr(id: UUID, opts?: RequestOpts) {
    return v1Client.get<QrToken>(`/passes/${id}/qr`, opts);
  },
  regenerateQr(id: UUID, opts?: RequestOpts) {
    return v1Client.post<QrToken>(`/passes/${id}/regenerate-qr`, undefined, opts);
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
