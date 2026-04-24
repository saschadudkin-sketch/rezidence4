/**
 * platform-v1 access-incidents (+ overrides) client.
 * Backend: backend/src/v1/routes/accessIncidents.js
 * Spec:    docs/product/specs/platform-v1/access-incidents-spec.md
 *
 * Phase 4 uses READ-ONLY subset (list + getById).  Management endpoints
 * (assign/resolve/dismiss/patch, override create) are wired but gated on
 * Phase 5 UI.
 */

import { v1Client, type RequestOpts } from './client';
import type {
  AccessIncident,
  AccessOverride,
  IncidentDetailResponse,
  IncidentStatus,
  IncidentType,
  IsoDateTime,
  OverrideType,
  Severity,
  UUID,
} from './types';

export interface ListIncidentsParams {
  status?: IncidentStatus;
  severity?: Severity;
  incident_type?: IncidentType;
  assigned_to_staff_id?: UUID;
}

export interface ListOverridesParams {
  pass_id?: UUID;
  incident_id?: UUID;
  performed_by_staff_id?: UUID;
  from?: IsoDateTime;
  to?: IsoDateTime;
}

// Narrow interfaces like ListIncidentsParams don't have an index signature,
// so accepting `object` keeps the helper assignable from every caller.
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

export const accessIncidentsApi = {
  list(params?: ListIncidentsParams, opts?: RequestOpts) {
    return v1Client.get<{ incidents: AccessIncident[] }>(
      `/access-incidents${toQuery(params)}`,
      opts,
    );
  },
  getById(id: UUID, opts?: RequestOpts) {
    return v1Client.get<IncidentDetailResponse>(`/access-incidents/${id}`, opts);
  },
  listOverrides(params?: ListOverridesParams, opts?: RequestOpts) {
    return v1Client.get<{ overrides: AccessOverride[] }>(
      `/access-overrides${toQuery(params)}`,
      opts,
    );
  },
  createOverride(
    body: {
      property_id: UUID;
      incident_id?: UUID | null;
      pass_id?: UUID | null;
      override_type: OverrideType;
      reason: string;
    },
    opts?: RequestOpts,
  ) {
    return v1Client.post<{ override: AccessOverride }>(`/access-overrides`, body, opts);
  },
};
