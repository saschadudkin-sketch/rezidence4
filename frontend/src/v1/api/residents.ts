/**
 * platform-v1 residents client (subset for Phase 4).
 * Backend: backend/src/v1/routes/residents.js
 *
 * Phase 4 only needs "find my resident row(s) for the UI form".  For staff
 * admin workflows the full CRUD lives in Phase 2/5 UIs — intentionally
 * omitted here.
 */

import { v1Client, type RequestOpts } from './client';
import type {
  PageMeta,
  PaginationParams,
  Resident,
  ResidentOffboardingReportResponse,
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
    return v1Client.get<{ resident: ResidentWithUnit }>(`/residents/${id}`, opts);
  },
  offboardingReport(params: GetResidentOffboardingReportParams, opts?: RequestOpts) {
    return v1Client.get<ResidentOffboardingReportResponse>(
      `/residents/offboarding-report${toQuery(params)}`,
      opts,
    );
  },
};
