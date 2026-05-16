/**
 * platform-v1 units client (subset for Phase 4).
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
  listEntrances(buildingId: UUID, opts?: RequestOpts) {
    return v1Client.get<{ entrances: Entrance[] }>(
      `/buildings/${buildingId}/entrances`,
      opts,
    );
  },
  list(params?: ListUnitsParams, opts?: RequestOpts) {
    return v1Client.get<{ units: Unit[]; page?: PageMeta }>(
      `/units${toQuery(params)}`,
      opts,
    );
  },
  getById(id: UUID, opts?: RequestOpts) {
    return v1Client.get<UnitDetailResponse>(`/units/${id}`, opts);
  },
  importRows(payload: UnitImportPayload, opts?: RequestOpts) {
    return v1Client.post<UnitImportResponse>('/units/import', payload, opts);
  },
};
