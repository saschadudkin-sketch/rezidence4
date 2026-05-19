/**
 * platform-v1 residents client.
 * Backend: backend/src/v1/routes/residents.js
 */

import { v1Client, type RequestOpts } from './client';
import type {
  IsoDateTime,
  PageMeta,
  PaginationParams,
  Resident,
  ResidentOffboardingReportResponse,
  ResidentType,
  UUID,
} from './types';

export interface ListResidentsParams extends PaginationParams {
  unit_id?: UUID;
  q?: string;
  is_active?: boolean;
}

export interface GetResidentOffboardingReportParams {
  property_id: UUID;
  limit?: number;
}

export interface CreateResidentBody {
  property_id: UUID;
  unit_id: UUID;
  full_name: string;
  phone: string;
  email?: string | null;
  resident_type?: ResidentType;
  external_uid?: string | null;
}

export interface UpdateResidentBody {
  full_name?: string;
  email?: string | null;
  phone?: string;
  resident_type?: ResidentType;
  unit_id?: UUID;
}

export interface ResidentConsentBody {
  consent_version: string;
}

export interface DeactivateResidentBody {
  reason?: string | null;
}

export interface TransferResidentOwnershipBody {
  to_resident_id: UUID;
  reason?: string | null;
  effective_at?: IsoDateTime | null;
  cascade_notification_preferences?: boolean;
}

export interface ResidentOffboardingResult {
  resident: Pick<ResidentWithUnit, 'id' | 'property_id' | 'unit_id' | 'external_uid' | 'is_active'>;
  summary: {
    suspended_memberships: number;
    revoked_passes: number;
    deactivated_unit_links: number;
    vehicles_marked_for_review: number;
    cancelled_access_requests: number;
    notification_preferences_disabled: number;
    trusted_visitors_deactivated: number;
  };
  affected: Record<string, unknown[]>;
}

export interface ResidentOwnershipTransferResult {
  transfer: Record<string, unknown>;
  summary: {
    previous_owner_offboarding: ResidentOffboardingResult['summary'];
    previous_owner_links_closed: number;
    new_owner_links_activated: number;
    notification_preferences_copied: number;
  };
  from_resident: Pick<ResidentWithUnit, 'id' | 'property_id' | 'unit_id' | 'external_uid' | 'is_active'>;
  to_resident: Pick<ResidentWithUnit, 'id' | 'property_id' | 'unit_id' | 'external_uid' | 'is_active' | 'resident_type'>;
  affected: Record<string, unknown>;
}

export interface ResidentConsentResponse {
  resident: Pick<ResidentWithUnit, 'id' | 'property_id' | 'consent_given_at' | 'consent_version'>;
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

/**
 * Resident row as returned by /api/v1/residents/:id — the backend may return
 * a resident whose unit link was dissolved (unit_id = null), or whose
 * property attribution is still being migrated (property_id = null, for
 * legacy rows created before the multi-property migration).  We widen both
 * fields to nullable so consumer pages can gate on them before calling
 * endpoints that require property scope.
 *
 * Uses `Omit` because Resident narrows these to non-null — TypeScript won't
 * let an interface extension redeclare a property with a looser type.
 */
export interface ResidentWithUnit extends Omit<Resident, 'unit_id' | 'property_id'> {
  unit_id: UUID | null;
  property_id: UUID | null;
}

export const residentsApi = {
  list(params?: ListResidentsParams, opts?: RequestOpts) {
    return v1Client.get<{ residents: ResidentWithUnit[]; page?: PageMeta }>(
      `/residents${toQuery(params)}`,
      opts,
    );
  },
  getById(id: UUID, opts?: RequestOpts) {
    return v1Client.get<{ resident: ResidentWithUnit }>(
      `/residents/${encodeURIComponent(id)}`,
      opts,
    );
  },
  create(body: CreateResidentBody, opts?: RequestOpts) {
    return v1Client.post<{ resident: ResidentWithUnit }>('/residents', body, opts);
  },
  update(id: UUID, body: UpdateResidentBody, opts?: RequestOpts) {
    return v1Client.patch<{ resident: ResidentWithUnit }>(
      `/residents/${encodeURIComponent(id)}`,
      body,
      opts,
    );
  },
  deactivate(id: UUID, body?: DeactivateResidentBody, opts?: RequestOpts) {
    return v1Client.post<{ offboarding: ResidentOffboardingResult }>(
      `/residents/${encodeURIComponent(id)}/deactivate`,
      body,
      opts,
    );
  },
  transferOwnership(id: UUID, body: TransferResidentOwnershipBody, opts?: RequestOpts) {
    return v1Client.post<{ ownership_transfer: ResidentOwnershipTransferResult }>(
      `/residents/${encodeURIComponent(id)}/transfer-ownership`,
      body,
      opts,
    );
  },
  consent(id: UUID, body: ResidentConsentBody, opts?: RequestOpts) {
    return v1Client.post<ResidentConsentResponse>(
      `/residents/${encodeURIComponent(id)}/consent`,
      body,
      opts,
    );
  },
  offboardingReport(params: GetResidentOffboardingReportParams, opts?: RequestOpts) {
    return v1Client.get<ResidentOffboardingReportResponse>(
      `/residents/offboarding-report${toQuery(params)}`,
      opts,
    );
  },
};
