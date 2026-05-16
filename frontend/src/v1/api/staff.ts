/**
 * platform-v1 staff users client.
 * Backend: backend/src/v1/routes/staff.js (mounted at /api/v1/staff)
 */

import { v1Client, type RequestOpts } from './client';
import type {
  PageMeta,
  PaginationParams,
  StaffRole,
  StaffUser,
  UUID,
} from './types';

export interface ListStaffParams extends PaginationParams {
  role?: StaffRole;
  is_active?: boolean;
  q?: string;
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
    return v1Client.get<{ staff: StaffUser }>(`/staff/${id}`, opts);
  },
};
