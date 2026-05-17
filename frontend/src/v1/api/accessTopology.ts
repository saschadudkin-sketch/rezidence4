/**
 * platform-v1 access topology client.
 * Backend: backend/src/v1/routes/accessTopology.js
 */

import { v1Client, type RequestOpts } from './client';
import type {
  AccessPoint,
  AccessPointType,
  AccessZone,
  AccessZoneType,
  PageMeta,
  PaginationParams,
  UUID,
} from './types';

export interface ListAccessZonesParams extends PaginationParams {
  property_id: UUID;
  is_active?: boolean;
  zone_type?: AccessZoneType;
}

export interface ListAccessPointsParams extends PaginationParams {
  property_id: UUID;
  zone_id?: UUID;
  is_active?: boolean;
  point_type?: AccessPointType;
}

export interface CreateAccessZoneBody {
  property_id: UUID;
  building_id?: UUID | null;
  name: string;
  zone_type: AccessZoneType;
  description?: string | null;
  sort_order?: number;
  metadata?: Record<string, unknown>;
}

export interface UpdateAccessZoneBody {
  building_id?: UUID | null;
  name?: string;
  zone_type?: AccessZoneType;
  description?: string | null;
  is_active?: boolean;
  sort_order?: number;
  metadata?: Record<string, unknown>;
}

export interface CreateAccessPointBody {
  property_id: UUID;
  zone_id: UUID;
  name: string;
  point_type: AccessPointType;
  provider?: string | null;
  provider_external_id?: string | null;
  description?: string | null;
  sort_order?: number;
  metadata?: Record<string, unknown>;
}

export interface UpdateAccessPointBody {
  zone_id?: UUID;
  name?: string;
  point_type?: AccessPointType;
  provider?: string | null;
  provider_external_id?: string | null;
  description?: string | null;
  is_active?: boolean;
  sort_order?: number;
  metadata?: Record<string, unknown>;
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

export const accessTopologyApi = {
  listZones(params: ListAccessZonesParams, opts?: RequestOpts) {
    return v1Client.get<{ zones: AccessZone[]; page?: PageMeta }>(
      `/access-zones${toQuery(params)}`,
      opts,
    );
  },
  listPoints(params: ListAccessPointsParams, opts?: RequestOpts) {
    return v1Client.get<{ points: AccessPoint[]; page?: PageMeta }>(
      `/access-points${toQuery(params)}`,
      opts,
    );
  },
  createZone(body: CreateAccessZoneBody, opts?: RequestOpts) {
    return v1Client.post<{ zone: AccessZone }>('/access-zones', body, opts);
  },
  updateZone(id: UUID, body: UpdateAccessZoneBody, opts?: RequestOpts) {
    return v1Client.patch<{ zone: AccessZone }>(
      `/access-zones/${encodeURIComponent(id)}`,
      body,
      opts,
    );
  },
  createPoint(body: CreateAccessPointBody, opts?: RequestOpts) {
    return v1Client.post<{ point: AccessPoint }>('/access-points', body, opts);
  },
  updatePoint(id: UUID, body: UpdateAccessPointBody, opts?: RequestOpts) {
    return v1Client.patch<{ point: AccessPoint }>(
      `/access-points/${encodeURIComponent(id)}`,
      body,
      opts,
    );
  },
  deactivateZone(id: UUID, opts?: RequestOpts) {
    return v1Client.post<void>(
      `/access-zones/${encodeURIComponent(id)}/deactivate`,
      undefined,
      opts,
    );
  },
  deactivatePoint(id: UUID, opts?: RequestOpts) {
    return v1Client.post<void>(
      `/access-points/${encodeURIComponent(id)}/deactivate`,
      undefined,
      opts,
    );
  },
};
