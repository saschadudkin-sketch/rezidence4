/**
 * platform-v1 units client.
 * Backend: backend/src/v1/routes/structure.js  (mounted at /api/v1 root)
 */

import { v1Client, type RequestOpts } from './client';
import type {
  AccessPointType,
  AccessZoneType,
  Building,
  Entrance,
  PageMeta,
  PaginationParams,
  PropertyType,
  Unit,
  UnitDetailResponse,
  UnitType,
  UUID,
} from './types';

export interface ListUnitsParams extends PaginationParams {
  building_id?: UUID;
  entrance_id?: UUID;
  unit_type?: UnitType;
  q?: string;
  is_active?: boolean;
}

export interface CreateBuildingBody {
  property_id: UUID;
  name: string;
  code?: string | null;
  sort_order?: number;
}

export interface CreateEntranceBody {
  building_id: UUID;
  name: string;
  code?: string | null;
  sort_order?: number;
}

export interface CreateUnitBody {
  property_id: UUID;
  building_id: UUID;
  entrance_id: UUID;
  unit_number: string;
  unit_type?: UnitType;
  floor?: number | null;
}

export interface UpdateUnitBody {
  unit_number?: string;
  unit_type?: UnitType;
  floor?: number | null;
}

export interface UnitImportPayload {
  property_id: UUID;
  property_type?: PropertyType | null;
  csv?: string;
  rows?: Array<Record<string, unknown>>;
}

export interface UnitImportResponse {
  property_type: PropertyType;
  imported: Record<'buildings' | 'entrances' | 'units' | 'residents' | 'vehicles', number>;
  skipped: Record<'buildings' | 'entrances' | 'units' | 'residents' | 'vehicles', number>;
  warnings: string[];
  planned_access_points: Array<{ name: string; point_type: string; notes: string | null }>;
  access_topology: {
    zones: Array<{ id: UUID; name: string; zone_type: AccessZoneType; created: boolean }>;
    points: Array<{
      id: UUID;
      zone_id: UUID;
      name: string;
      point_type: AccessPointType;
      notes: string | null;
      created: boolean;
    }>;
  };
  readiness: {
    ready: boolean;
    homes_plots: number;
    vehicles: number | null;
    planned_access_points: number | null;
  };
  rows: Array<{
    row: number;
    building_id: UUID;
    entrance_id: UUID;
    unit_id: UUID;
    resident_id: UUID;
    vehicle_ids: UUID[];
  }>;
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

export const unitsApi = {
  listBuildings(opts?: RequestOpts) {
    return v1Client.get<{ buildings: Building[] }>('/buildings', opts);
  },
  createBuilding(body: CreateBuildingBody, opts?: RequestOpts) {
    return v1Client.post<{ building: Building }>('/buildings', body, opts);
  },
  listEntrances(buildingId: UUID, opts?: RequestOpts) {
    return v1Client.get<{ entrances: Entrance[] }>(
      `/buildings/${encodeURIComponent(buildingId)}/entrances`,
      opts,
    );
  },
  createEntrance(body: CreateEntranceBody, opts?: RequestOpts) {
    return v1Client.post<{ entrance: Entrance }>('/entrances', body, opts);
  },
  list(params?: ListUnitsParams, opts?: RequestOpts) {
    return v1Client.get<{ units: Unit[]; page?: PageMeta }>(
      `/units${toQuery(params)}`,
      opts,
    );
  },
  getById(id: UUID, opts?: RequestOpts) {
    return v1Client.get<UnitDetailResponse>(`/units/${encodeURIComponent(id)}`, opts);
  },
  create(body: CreateUnitBody, opts?: RequestOpts) {
    return v1Client.post<{ unit: Unit }>('/units', body, opts);
  },
  update(id: UUID, body: UpdateUnitBody, opts?: RequestOpts) {
    return v1Client.patch<{ unit: Unit }>(
      `/units/${encodeURIComponent(id)}`,
      body,
      opts,
    );
  },
  deactivate(id: UUID, opts?: RequestOpts) {
    return v1Client.post<void>(
      `/units/${encodeURIComponent(id)}/deactivate`,
      undefined,
      opts,
    );
  },
  importRows(payload: UnitImportPayload, opts?: RequestOpts) {
    return v1Client.post<UnitImportResponse>('/units/import', payload, opts);
  },
};
