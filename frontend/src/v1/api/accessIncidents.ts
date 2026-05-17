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
  PageMeta,
  PaginationParams,
  Severity,
  UUID,
} from './types';

export interface ListIncidentsParams extends PaginationParams {
  property_id?: UUID;
  status?: IncidentStatus;
  severity?: Severity;
  incident_type?: IncidentType;
  assigned_to_staff_id?: UUID;
}

export interface ListOverridesParams extends PaginationParams {
  property_id?: UUID;
  pass_id?: UUID;
  incident_id?: UUID;
  performed_by_staff_id?: UUID;
  from?: IsoDateTime;
  to?: IsoDateTime;
}

export interface CreateIncidentBody {
  property_id: UUID;
  incident_type: IncidentType;
  severity?: Severity;
  title: string;
  description?: string | null;
  related_pass_id?: UUID | null;
  related_visit_log_id?: UUID | null;
  related_vehicle_id?: UUID | null;
}

export interface PatchIncidentBody {
  severity?: Severity;
  title?: string;
  description?: string | null;
}

export interface AssignIncidentBody {
  assigned_to_staff_id: UUID;
}

export interface IncidentReasonBody {
  reason: string;
}

export interface ResolveIncidentBody extends IncidentReasonBody {
  create_override?: {
    override_type: OverrideType;
    reason: string;
  } | null;
}

export interface UpdateIncidentStatusBody {
  status: Exclude<IncidentStatus, 'open'>;
  reason?: string;
  comment?: string;
  assigned_to_staff_id?: UUID;
}

export interface CreateIncidentVideoEvidenceBody {
  property_id?: UUID;
  provider_id?: UUID | null;
  camera_device_id?: UUID | string | null;
  evidence_url?: string;
  clip_url?: string;
  starts_at?: IsoDateTime | null;
  ends_at?: IsoDateTime | null;
  metadata?: Record<string, unknown>;
}

export interface FetchIncidentVideoEvidenceBody {
  property_id?: UUID;
  provider_id?: UUID | null;
  camera_device_id?: UUID | string | null;
  starts_at?: IsoDateTime | null;
  ends_at?: IsoDateTime | null;
  metadata?: Record<string, unknown>;
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
    return v1Client.get<{ incidents: AccessIncident[]; page?: PageMeta }>(
      `/access-incidents${toQuery(params)}`,
      opts,
    );
  },
  getById(id: UUID, opts?: RequestOpts) {
    return v1Client.get<IncidentDetailResponse>(
      `/access-incidents/${encodeURIComponent(id)}`,
      opts,
    );
  },
  listOverrides(params?: ListOverridesParams, opts?: RequestOpts) {
    return v1Client.get<{ overrides: AccessOverride[]; page?: PageMeta }>(
      `/access-overrides${toQuery(params)}`,
      opts,
    );
  },
  getOverride(id: UUID, opts?: RequestOpts) {
    return v1Client.get<{ override: AccessOverride }>(
      `/access-overrides/${encodeURIComponent(id)}`,
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
  create(body: CreateIncidentBody, opts?: RequestOpts) {
    return v1Client.post<{ incident: AccessIncident }>('/access-incidents', body, opts);
  },
  patch(id: UUID, body: PatchIncidentBody, opts?: RequestOpts) {
    return v1Client.patch<{ incident: AccessIncident }>(
      `/access-incidents/${encodeURIComponent(id)}`,
      body,
      opts,
    );
  },
  assign(id: UUID, body: AssignIncidentBody, opts?: RequestOpts) {
    return v1Client.post<{ incident: AccessIncident }>(
      `/access-incidents/${encodeURIComponent(id)}/assign`,
      body,
      opts,
    );
  },
  resolve(id: UUID, body: ResolveIncidentBody, opts?: RequestOpts) {
    return v1Client.post<{ incident: AccessIncident; override?: AccessOverride | null }>(
      `/access-incidents/${encodeURIComponent(id)}/resolve`,
      body,
      opts,
    );
  },
  dismiss(id: UUID, body: IncidentReasonBody, opts?: RequestOpts) {
    return v1Client.post<{ incident: AccessIncident }>(
      `/access-incidents/${encodeURIComponent(id)}/dismiss`,
      body,
      opts,
    );
  },
  reopen(id: UUID, body: IncidentReasonBody & Partial<AssignIncidentBody>, opts?: RequestOpts) {
    return v1Client.post<{ incident: AccessIncident }>(
      `/access-incidents/${encodeURIComponent(id)}/reopen`,
      body,
      opts,
    );
  },
  updateStatus(id: UUID, body: UpdateIncidentStatusBody, opts?: RequestOpts) {
    return v1Client.post<{ incident: AccessIncident }>(
      `/access-incidents/${encodeURIComponent(id)}/status`,
      body,
      opts,
    );
  },
  listVideoEvidence(id: UUID, opts?: RequestOpts) {
    return v1Client.get<{ evidence: unknown[] }>(
      `/access-incidents/${encodeURIComponent(id)}/video-evidence`,
      opts,
    );
  },
  createVideoEvidence(id: UUID, body: CreateIncidentVideoEvidenceBody, opts?: RequestOpts) {
    return v1Client.post<{ evidence: unknown }>(
      `/access-incidents/${encodeURIComponent(id)}/video-evidence`,
      body,
      opts,
    );
  },
  fetchVideoEvidence(id: UUID, body: FetchIncidentVideoEvidenceBody, opts?: RequestOpts) {
    return v1Client.post<{ evidence: unknown }>(
      `/access-incidents/${encodeURIComponent(id)}/video-evidence/fetch`,
      body,
      opts,
    );
  },
};
