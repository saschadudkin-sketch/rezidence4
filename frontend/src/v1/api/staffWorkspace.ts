/**
 * platform-v1 staff workspace client.
 * Backend: backend/src/v1/routes/staffWorkspace.js + /api/v1/requests shims.
 */

import { v1Client, type RequestOpts } from './client';
import type {
  PageMeta,
  PaginationParams,
  StaffRequestPriority,
  StaffRequestStatus,
  StaffRequestTargetType,
  StaffSlaProfile,
  StaffWorkspaceProperty,
  StaffWorkspaceQueue,
  StaffWorkspaceRequest,
  StaffWorkspaceRequestDetail,
  StaffResidentQuickView,
  UserRole,
} from './types';

export interface ListStaffWorkspaceInboxParams extends PaginationParams {
  queue?: StaffWorkspaceQueue;
  status?: StaffRequestStatus | string;
  category?: string;
  priority?: StaffRequestPriority;
  sla_profile?: StaffSlaProfile;
  target_type?: StaffRequestTargetType;
  target_id?: string;
  unit_id?: string;
  home_id?: string;
  access_zone_id?: string;
  access_point_id?: string;
  assignee_uid?: string;
  q?: string;
}

export interface CreateInternalCommentBody {
  body: string;
}

export interface AssignStaffRequestBody {
  assigneeUid: string;
  assigneeName: string;
  assigneeRole: UserRole | string;
}

export interface UpdateStaffRequestStatusBody {
  status: StaffRequestStatus;
  expectedCurrentStatus?: StaffRequestStatus;
  historyLabel?: string;
}

function toQuery(params: object | undefined): string {
  if (!params) return '';
  const entries = Object.entries(params).filter(
    ([, value]) => value !== undefined && value !== null && value !== '',
  );
  if (!entries.length) return '';
  const qs = new URLSearchParams();
  for (const [key, value] of entries) qs.set(key, String(value));
  return `?${qs.toString()}`;
}

export const staffWorkspaceApi = {
  listInbox(params?: ListStaffWorkspaceInboxParams, opts?: RequestOpts) {
    return v1Client.get<{
      requests: StaffWorkspaceRequest[];
      total: number;
      page?: PageMeta;
      property?: StaffWorkspaceProperty | null;
    }>(`/staff-workspace/inbox${toQuery(params)}`, opts);
  },

  listOverdue(params?: Omit<ListStaffWorkspaceInboxParams, 'queue'>, opts?: RequestOpts) {
    return v1Client.get<{
      requests: StaffWorkspaceRequest[];
      total: number;
      page?: PageMeta;
    }>(`/staff-workspace/overdue${toQuery(params)}`, opts);
  },

  getRequestDetail(id: string, opts?: RequestOpts) {
    return v1Client.get<StaffWorkspaceRequestDetail>(
      `/staff-workspace/requests/${encodeURIComponent(id)}`,
      opts,
    );
  },

  createInternalComment(id: string, body: CreateInternalCommentBody, opts?: RequestOpts) {
    return v1Client.post<{ comment: StaffWorkspaceRequestDetail['internalComments'][number] }>(
      `/staff-workspace/requests/${encodeURIComponent(id)}/internal-comments`,
      body,
      opts,
    );
  },

  getResidentQuickView(id: string, opts?: RequestOpts) {
    return v1Client.get<StaffResidentQuickView>(
      `/staff-workspace/residents/${encodeURIComponent(id)}/quick-view`,
      opts,
    );
  },

  assignRequest(id: string, body: AssignStaffRequestBody, opts?: RequestOpts) {
    return v1Client.post<StaffWorkspaceRequest>(
      `/requests/${encodeURIComponent(id)}/assign`,
      body,
      opts,
    );
  },

  markFirstResponse(id: string, opts?: RequestOpts) {
    return v1Client.post<StaffWorkspaceRequest>(
      `/requests/${encodeURIComponent(id)}/first-response`,
      undefined,
      opts,
    );
  },

  updateStatus(id: string, body: UpdateStaffRequestStatusBody, opts?: RequestOpts) {
    return v1Client.patch<StaffWorkspaceRequest>(
      `/requests/${encodeURIComponent(id)}`,
      body,
      opts,
    );
  },
};
