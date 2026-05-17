/**
 * platform-v1 guard visit-log client.
 * Backend: backend/src/v1/routes/visits.js mounted at /api/v1/guard.
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

export interface ListGuardVisitsParams extends PaginationParams {
  pass_id?: UUID;
  vehicle_plate?: string;
  event_type?: VisitEventType;
  from?: IsoDateTime;
  to?: IsoDateTime;
}

export interface CreateGuardVisitBody {
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

export type GuardVisitIncidentSummary = Pick<
  AccessIncident,
  'id' | 'incident_type' | 'severity' | 'status' | 'title' | 'created_at'
>;

export interface GuardVisitDetailResponse {
  visit_log: VisitLog;
  incidents: GuardVisitIncidentSummary[];
}

function toQuery(params?: object): string {
  if (!params) return '';
  const entries = Object.entries(params).filter(
    ([, value]) => value !== undefined && value !== null && value !== '',
  );
  if (!entries.length) return '';
  const qs = new URLSearchParams();
  for (const [key, value] of entries) qs.set(key, String(value));
  return `?${qs.toString()}`;
}

function normalizeVisitBody(body: CreateGuardVisitBody): CreateGuardVisitBody {
  return {
    ...body,
    vehicle_plate: body.vehicle_plate ? normalizePlate(body.vehicle_plate) : body.vehicle_plate,
  };
}

function normalizeVerifyBody(body: VerifyRequest): VerifyRequest {
  return {
    ...body,
    plate: body.plate ? normalizePlate(body.plate) : body.plate,
  };
}

export const guardVisitsApi = {
  list(params?: ListGuardVisitsParams, opts?: RequestOpts) {
    const query = params?.vehicle_plate
      ? { ...params, vehicle_plate: normalizePlate(params.vehicle_plate) }
      : params;
    return v1Client.get<{ visit_logs: VisitLog[]; page?: PageMeta }>(
      `/guard${toQuery(query)}`,
      opts,
    );
  },

  getById(id: UUID, opts?: RequestOpts) {
    return v1Client.get<GuardVisitDetailResponse>(
      `/guard/${encodeURIComponent(id)}`,
      opts,
    );
  },

  listByPass(passId: UUID, params?: PaginationParams, opts?: RequestOpts) {
    return v1Client.get<{ visit_logs: VisitLog[]; page?: PageMeta }>(
      `/guard/by-pass/${encodeURIComponent(passId)}${toQuery(params)}`,
      opts,
    );
  },

  listByPlate(plate: string, params?: PaginationParams, opts?: RequestOpts) {
    return v1Client.get<{ plate: string; visit_logs: VisitLog[]; page?: PageMeta }>(
      `/guard/by-plate/${encodeURIComponent(normalizePlate(plate))}${toQuery(params)}`,
      opts,
    );
  },

  create(body: CreateGuardVisitBody, opts?: RequestOpts) {
    return v1Client.post<{ visit_log: VisitLog }>(
      '/guard',
      normalizeVisitBody(body),
      opts,
    );
  },

  verify(body: VerifyRequest, opts?: RequestOpts) {
    return v1Client.post<VerifyResult>(
      '/guard/verify',
      normalizeVerifyBody(body),
      {
        ...opts,
        skipRetry: true,
      },
    );
  },
};
