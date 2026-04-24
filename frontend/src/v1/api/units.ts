/**
 * platform-v1 units client (subset for Phase 4).
 * Backend: backend/src/v1/routes/structure.js  (mounted at /api/v1 root)
 */

import { v1Client, type RequestOpts } from './client';
import type { Unit, UnitDetailResponse, UnitType, UUID } from './types';

export interface ListUnitsParams {
  building_id?: UUID;
  entrance_id?: UUID;
  unit_type?: UnitType;
  q?: string;
  is_active?: boolean;
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

export const unitsApi = {
  list(params?: ListUnitsParams, opts?: RequestOpts) {
    return v1Client.get<{ units: Unit[] }>(`/units${toQuery(params)}`, opts);
  },
  getById(id: UUID, opts?: RequestOpts) {
    return v1Client.get<UnitDetailResponse>(`/units/${id}`, opts);
  },
};
