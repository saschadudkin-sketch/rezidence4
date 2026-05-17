/**
 * platform-v1 staff users client.
 * Backend: backend/src/v1/routes/staff.js (mounted at /api/v1/staff)
 */

import { v1Client, type RequestOpts } from './client';
import { apiV1Url } from '../../config/apiBaseUrl';
import type {
  PageMeta,
  PaginationParams,
  StaffRole,
  StaffSpecialization,
  StaffUser,
  UUID,
} from './types';

export interface ListStaffParams extends PaginationParams {
  role?: StaffRole;
  is_active?: boolean;
  q?: string;
}

export interface CreateStaffBody {
  property_id: UUID;
  full_name: string;
  email: string;
  role: StaffRole;
  phone?: string | null;
  specialization?: StaffSpecialization | null;
  external_uid?: string | null;
  can_view_resident_phone?: boolean;
  can_assign_requests?: boolean;
}

export interface UpdateStaffBody {
  full_name?: string;
  phone?: string | null;
  role?: StaffRole;
  specialization?: StaffSpecialization | null;
  external_uid?: string | null;
  can_view_resident_phone?: boolean;
  can_assign_requests?: boolean;
}

export interface StaffImportRowInput {
  full_name?: string;
  name?: string;
  email?: string;
  role?: StaffRole | string;
  phone?: string | null;
  specialization?: StaffSpecialization | string | null;
  external_uid?: string | null;
  externalUid?: string | null;
  can_view_resident_phone?: boolean | string | null;
  canViewResidentPhone?: boolean | string | null;
  can_assign_requests?: boolean | string | null;
  canAssignRequests?: boolean | string | null;
}

export interface StaffImportPayload {
  property_id: UUID;
  csv?: string;
  rows?: StaffImportRowInput[];
}

export type StaffImportAction = 'ready' | 'invalid' | 'created' | 'skipped_existing';

export interface StaffImportPreviewRow {
  row_number: number;
  action: StaffImportAction;
  errors: string[];
  staff: Omit<CreateStaffBody, 'property_id'> | StaffUser | null;
  existing_id?: UUID;
}

export interface StaffImportChecklist {
  resource: 'staff';
  validation_ready: boolean;
  launch_ready: boolean;
  valid_count: number;
  invalid_count: number;
  imported?: { staff: number } | null;
  skipped?: { staff: number } | null;
}

export interface StaffImportPreviewResponse {
  mode: 'preview';
  resource: 'staff';
  valid_count: number;
  invalid_count: number;
  rows: StaffImportPreviewRow[];
  checklist: StaffImportChecklist;
}

export interface StaffImportApplyResponse {
  mode: 'apply';
  resource: 'staff';
  imported: { staff: number };
  skipped: { staff: number };
  rows: StaffImportPreviewRow[];
  checklist: StaffImportChecklist;
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

export const staffApi = {
  list(params?: ListStaffParams, opts?: RequestOpts) {
    return v1Client.get<{ staff: StaffUser[]; page?: PageMeta }>(
      `/staff${toQuery(params)}`,
      opts,
    );
  },
  getById(id: UUID, opts?: RequestOpts) {
    return v1Client.get<{ staff: StaffUser }>(`/staff/${encodeURIComponent(id)}`, opts);
  },
  create(body: CreateStaffBody, opts?: RequestOpts) {
    return v1Client.post<{ staff: StaffUser }>('/staff', body, opts);
  },
  update(id: UUID, body: UpdateStaffBody, opts?: RequestOpts) {
    return v1Client.patch<{ staff: StaffUser }>(
      `/staff/${encodeURIComponent(id)}`,
      body,
      opts,
    );
  },
  deactivate(id: UUID, opts?: RequestOpts) {
    return v1Client.post<void>(
      `/staff/${encodeURIComponent(id)}/deactivate`,
      undefined,
      opts,
    );
  },
  importTemplateUrl() {
    return apiV1Url('/staff/import/template');
  },
  previewImport(body: StaffImportPayload, opts?: RequestOpts) {
    return v1Client.post<StaffImportPreviewResponse>(
      '/staff/import/preview',
      body,
      opts,
    );
  },
  applyImport(body: StaffImportPayload, opts?: RequestOpts) {
    return v1Client.post<StaffImportApplyResponse>(
      '/staff/import/apply',
      body,
      opts,
    );
  },
};
