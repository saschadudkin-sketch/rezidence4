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
  AccessIncident,
  IsoDateTime,
  PageMeta,
  PaginationParams,
  UUID,
  VerifyRequest,
  VerifyResult,
  VisitEventSource,
  VisitEventType,
  VisitLog,
} from './types';

export interface ListVisitsParams extends PaginationParams {
  pass_id?: UUID;
  vehicle_plate?: string;
  event_type?: VisitEventType;
  from?: IsoDateTime;
  to?: IsoDateTime;
}

export interface CreateVisitBody {
  property_id: UUID;
  pass_id?: UUID | null;
  access_point_id?: UUID | null;
  event_type: VisitEventType;
  event_source: VisitEventSource;
  person_label?: string | null;
  vehicle_plate?: string | null;
  provider_event_id?: string | null;
  provider_payload?: Record<string, unknown> | null;
  occurred_at?: IsoDateTime | null;
}

export type ScanPassBody = Omit<VerifyRequest, 'mode'> & {
  mode?: 'qr';
};

export type VisitIncidentSummary = Pick<
  AccessIncident,
  'id' | 'incident_type' | 'severity' | 'status' | 'title' | 'created_at'
>;

export interface VisitDetailResponse {
  visit_log: VisitLog;
  incidents: VisitIncidentSummary[];
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

function normalizeVisitBody(body: CreateVisitBody): CreateVisitBody {
  return {
    ...body,
    vehicle_plate: body.vehicle_plate ? normalizePlate(body.vehicle_plate) : body.vehicle_plate,
  };
}

function normalizeVerifyBody<T extends VerifyRequest | ScanPassBody>(body: T): T {
  return {
    ...body,
    plate: body.plate ? normalizePlate(body.plate) : body.plate,
  };
}

export const visitsApi = {
  list(params?: ListVisitsParams, opts?: RequestOpts) {
    const query = params?.vehicle_plate
      ? { ...params, vehicle_plate: normalizePlate(params.vehicle_plate) }
      : params;
    return v1Client.get<{ visit_logs: VisitLog[]; page?: PageMeta }>(
      `/visits${toQuery(query)}`,
      opts,
    );
  },
  getById(id: UUID, opts?: RequestOpts) {
    return v1Client.get<VisitDetailResponse>(
      `/visits/${encodeURIComponent(id)}`,
      opts,
    );
  },
  listByPass(passId: UUID, params?: PaginationParams, opts?: RequestOpts) {
    return v1Client.get<{ visit_logs: VisitLog[]; page?: PageMeta }>(
      `/visits/by-pass/${encodeURIComponent(passId)}${toQuery(params)}`,
      opts,
    );
  },
  listByPlate(plate: string, params?: PaginationParams, opts?: RequestOpts) {
    return v1Client.get<{ plate: string; visit_logs: VisitLog[]; page?: PageMeta }>(
      `/visits/by-plate/${encodeURIComponent(normalizePlate(plate))}${toQuery(params)}`,
      opts,
    );
  },
  create(body: CreateVisitBody, opts?: RequestOpts) {
    return v1Client.post<{ visit_log: VisitLog }>(
      '/visits',
      normalizeVisitBody(body),
      opts,
    );
  },
  verify(body: VerifyRequest, opts?: RequestOpts) {
    return v1Client.post<VerifyResult>(`/visits/verify`, normalizeVerifyBody(body), {
      ...opts,
      // verify is non-idempotent (creates visit_log + possibly incident)
      // so no retry on this endpoint.
      skipRetry: true,
    });
  },
  scanPass(body: ScanPassBody, opts?: RequestOpts) {
    return v1Client.post<VerifyResult>(
      '/visits/scan-pass',
      normalizeVerifyBody(body),
      {
        ...opts,
        skipRetry: true,
      },
    );
  },
};
