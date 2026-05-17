/**
 * platform-v1 analytics client.
 * Backend: backend/src/routes/analytics.js and backend/src/v1/routes/analyticsAggregation.js.
 */

import { v1Client, type RequestOpts } from './client';
import type { IsoDateTime, UUID } from './types';

export type AnalyticsGranularity = 'hour' | 'day';
export type AnalyticsPeriod = '24h' | '7d' | '30d';

export interface AnalyticsDateRangeParams {
  from?: IsoDateTime | string;
  to?: IsoDateTime | string;
}

export interface TrafficAnalyticsParams extends AnalyticsDateRangeParams {
  granularity?: AnalyticsGranularity;
}

export interface TopResidentsAnalyticsParams extends AnalyticsDateRangeParams {
  limit?: number;
}

export interface AnalyticsSnapshotParams {
  property_id?: UUID;
  propertyId?: UUID;
  period?: AnalyticsPeriod;
  limit?: number;
}

export interface CreateAnalyticsSnapshotBody {
  property_id?: UUID;
  propertyId?: UUID;
  period?: AnalyticsPeriod;
}

export interface TrafficAnalyticsResponse {
  granularity: AnalyticsGranularity;
  from: IsoDateTime;
  to: IsoDateTime;
  labels: IsoDateTime[];
  series: {
    visits: number[];
    admitted: number[];
    denied: number[];
  };
}

export interface TopResidentsAnalyticsResponse {
  residents: Array<{
    uid: string;
    name: string | null;
    apartment: string | null;
    pass_count: number;
    guest_count: number;
  }>;
}

export interface SlaAnalyticsResponse {
  from: IsoDateTime;
  to: IsoDateTime;
  byType: Array<{
    type: string;
    total: number;
    within_sla: number;
    overdue: number;
    avg_resolution_hours: number | null;
  }>;
}

export interface RequestsAnalyticsResponse {
  byStatus: Record<string, number>;
  byType: Record<string, number>;
  byHour: Array<{ hour: number; count: number }>;
}

export interface PackagesAnalyticsResponse {
  received: number;
  picked_up: number;
  pending: number;
  avg_pickup_hours: number | null;
}

export interface AnalyticsSnapshot {
  id: UUID;
  property_id: UUID;
  metric_group?: string;
  period: AnalyticsPeriod;
  payload?: Record<string, unknown>;
  flat_rows?: Array<Record<string, unknown>>;
  generated_at?: IsoDateTime;
  window_started_at?: IsoDateTime | null;
  window_ended_at?: IsoDateTime | null;
}

export interface CreateAnalyticsSnapshotResponse {
  snapshot: AnalyticsSnapshot;
  metrics: Array<Record<string, unknown>>;
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

export const analyticsApi = {
  traffic(params?: TrafficAnalyticsParams, opts?: RequestOpts) {
    return v1Client.get<TrafficAnalyticsResponse>(`/analytics/traffic${toQuery(params)}`, opts);
  },

  topResidents(params?: TopResidentsAnalyticsParams, opts?: RequestOpts) {
    return v1Client.get<TopResidentsAnalyticsResponse>(
      `/analytics/top-residents${toQuery(params)}`,
      opts,
    );
  },

  sla(params?: AnalyticsDateRangeParams, opts?: RequestOpts) {
    return v1Client.get<SlaAnalyticsResponse>(`/analytics/sla${toQuery(params)}`, opts);
  },

  requests(params?: AnalyticsDateRangeParams, opts?: RequestOpts) {
    return v1Client.get<RequestsAnalyticsResponse>(`/analytics/requests${toQuery(params)}`, opts);
  },

  packages(params?: AnalyticsDateRangeParams, opts?: RequestOpts) {
    return v1Client.get<PackagesAnalyticsResponse>(`/analytics/packages${toQuery(params)}`, opts);
  },

  listSnapshots(params?: AnalyticsSnapshotParams, opts?: RequestOpts) {
    return v1Client.get<{ snapshots: AnalyticsSnapshot[] }>(
      `/analytics/snapshots${toQuery(params)}`,
      opts,
    );
  },

  latestSnapshot(params?: AnalyticsSnapshotParams, opts?: RequestOpts) {
    return v1Client.get<{ snapshot: AnalyticsSnapshot }>(
      `/analytics/snapshots/latest${toQuery(params)}`,
      opts,
    );
  },

  createSnapshot(body: CreateAnalyticsSnapshotBody, opts?: RequestOpts) {
    return v1Client.post<CreateAnalyticsSnapshotResponse>(
      '/analytics/snapshots',
      body,
      opts,
    );
  },
};
