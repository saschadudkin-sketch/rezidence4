/**
 * platform-v1 visits (visit_logs_v2) + verify client.
 * Backend: backend/src/v1/routes/visits.js
 * Spec:    docs/product/specs/platform-v1/qr-verification-spec.md
 *
 * NB: The spec uses /passes/verify; the actual mount is /visits/verify.
 * Phase 4 uses the real mount; spec addendum tracks the discrepancy.
 *
 * `verify` returns 200 OK even on deny — the verdict is business data, not an
 * HTTP error.  Callers should branch on `result.allowed`, not on thrown errors.
 */

import { normalizePlate } from './vehicles';
import { v1Client, type RequestOpts } from './client';
import type {
  IsoDateTime,
  UUID,
  VerifyRequest,
  VerifyResult,
  VisitLog,
} from './types';

export interface ListVisitsParams {
  pass_id?: UUID;
  point_id?: UUID;
  from?: IsoDateTime;
  to?: IsoDateTime;
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

export const visitsApi = {
  list(params?: ListVisitsParams, opts?: RequestOpts) {
    return v1Client.get<{ visits: VisitLog[] }>(`/visits${toQuery(params)}`, opts);
  },
  verify(body: VerifyRequest, opts?: RequestOpts) {
    const payload: VerifyRequest = {
      ...body,
      // Always uppercase/trim plate before sending; backend normalises too
      // but duplicate client-side for predictable request logs.
      plate: body.plate ? normalizePlate(body.plate) : body.plate,
    };
    return v1Client.post<VerifyResult>(`/visits/verify`, payload, {
      ...opts,
      // verify is non-idempotent (creates visit_log + possibly incident)
      // so no retry on this endpoint.
      skipRetry: true,
    });
  },
};
