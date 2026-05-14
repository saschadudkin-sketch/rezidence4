/**
 * platform-v1 vehicles client.
 * Backend: backend/src/v1/routes/vehicles.js
 * Spec:    docs/product/specs/platform-v1/vehicles-spec.md
 *
 * Plate normalization mirrors backend's normalizePlate: upper-case, no spaces.
 * Used both by `getByPlate` (path segment) and by the scan-panel.
 *
 * Backend field naming note: the brand is `brand`, not `make` — earlier
 * drafts had mapped it wrong.  We expose what the backend returns so the UI
 * never has to translate names.
 */

import { v1Client, type RequestOpts } from './client';
import type {
  PageMeta,
  PaginationParams,
  UUID,
  Vehicle,
  VehicleKind,
  VehicleOwnerType,
} from './types';

export function normalizePlate(plate: string): string {
  return plate.replace(/[\s-]+/g, '').toUpperCase();
}

export interface ListVehiclesParams extends PaginationParams {
  property_id?: UUID;
  plate?: string;
  owner_type?: VehicleOwnerType;
  owner_resident_id?: UUID;
  owner_staff_id?: UUID;
  owner_contractor_user_id?: UUID;
  is_whitelisted?: boolean;
  is_blacklisted?: boolean;
}

export interface CreateVehicleBody {
  property_id: UUID;
  plate_number: string;
  owner_type: VehicleOwnerType;
  owner_resident_id?: UUID | null;
  owner_staff_id?: UUID | null;
  owner_contractor_user_id?: UUID | null;
  vehicle_type?: VehicleKind;
  color?: string | null;
  brand?: string | null;
  model?: string | null;
  notes?: string | null;
}

export interface UpdateVehicleBody {
  color?: string | null;
  brand?: string | null;
  model?: string | null;
  notes?: string | null;
  vehicle_type?: VehicleKind;
  is_whitelisted?: boolean;
  is_blacklisted?: boolean;
  reason?: string | null;
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

export const vehiclesApi = {
  list(params?: ListVehiclesParams, opts?: RequestOpts) {
    return v1Client.get<{ vehicles: Vehicle[]; page?: PageMeta }>(
      `/vehicles${toQuery(params)}`,
      opts,
    );
  },
  getByPlate(plate: string, opts?: RequestOpts) {
    return v1Client.get<{ vehicle: Vehicle }>(
      `/vehicles/by-plate/${encodeURIComponent(normalizePlate(plate))}`,
      opts,
    );
  },
  getById(id: UUID, opts?: RequestOpts) {
    return v1Client.get<{ vehicle: Vehicle }>(`/vehicles/${id}`, opts);
  },
  create(body: CreateVehicleBody, opts?: RequestOpts) {
    const payload: CreateVehicleBody = {
      ...body,
      plate_number: normalizePlate(body.plate_number),
    };
    return v1Client.post<{ vehicle: Vehicle }>(`/vehicles`, payload, opts);
  },
  update(id: UUID, body: UpdateVehicleBody, opts?: RequestOpts) {
    return v1Client.patch<{ vehicle: Vehicle }>(`/vehicles/${id}`, body, opts);
  },
  whitelist(id: UUID, opts?: RequestOpts) {
    return v1Client.patch<{ vehicle: Vehicle }>(`/vehicles/${id}`, { is_whitelisted: true }, opts);
  },
  blacklist(id: UUID, reason: string, opts?: RequestOpts) {
    return v1Client.patch<{ vehicle: Vehicle }>(`/vehicles/${id}`, { is_blacklisted: true, reason }, opts);
  },
  clearFlags(id: UUID, opts?: RequestOpts) {
    return v1Client.patch<{ vehicle: Vehicle }>(
      `/vehicles/${id}`,
      { is_whitelisted: false, is_blacklisted: false },
      opts,
    );
  },
};
