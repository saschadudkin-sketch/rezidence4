/**
 * platform-v1 technician workspace client.
 * Backend: backend/src/v1/routes/technicianWorkspace.js.
 */

import { v1Client, type RequestOpts } from './client';
import type {
  PageMeta,
  PaginationParams,
  StaffRequestPriority,
  StaffRequestStatus,
  StaffRequestTargetType,
  TechnicianWorkspaceQueue,
  TechnicianWorkspaceRequest,
  TechnicianWorkspaceRequestDetail,
} from './types';

export interface ListTechnicianWorkspaceQueueParams extends PaginationParams {
  queue?: TechnicianWorkspaceQueue;
  status?: StaffRequestStatus;
  category?: string;
  priority?: StaffRequestPriority;
  target_type?: StaffRequestTargetType;
  target_id?: string;
  unit_id?: string;
  home_id?: string;
  access_zone_id?: string;
  access_point_id?: string;
  assignee_uid?: string;
  q?: string;
}

export interface SetTechnicianWaitingBody {
  reason: 'resident' | 'parts';
  note?: string;
}

export interface ResolveTechnicianRequestBody {
  resolutionNote: string;
  requiresFollowUp?: boolean;
  attachmentIds?: string[];
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

export const technicianWorkspaceApi = {
  listQueue(params?: ListTechnicianWorkspaceQueueParams, opts?: RequestOpts) {
    return v1Client.get<{
      requests: TechnicianWorkspaceRequest[];
      total: number;
      page?: PageMeta;
    }>(`/technician-workspace/queue${toQuery(params)}`, opts);
  },

  getRequestDetail(id: string, opts?: RequestOpts) {
    return v1Client.get<TechnicianWorkspaceRequestDetail>(
      `/technician-workspace/requests/${encodeURIComponent(id)}`,
      opts,
    );
  },

  claimRequest(id: string, opts?: RequestOpts) {
    return v1Client.post<{ request: TechnicianWorkspaceRequest }>(
      `/technician-workspace/requests/${encodeURIComponent(id)}/claim`,
      undefined,
      opts,
    );
  },

  startRequest(id: string, opts?: RequestOpts) {
    return v1Client.post<{ request: TechnicianWorkspaceRequest }>(
      `/technician-workspace/requests/${encodeURIComponent(id)}/start`,
      undefined,
      opts,
    );
  },

  resumeRequest(id: string, opts?: RequestOpts) {
    return v1Client.post<{ request: TechnicianWorkspaceRequest }>(
      `/technician-workspace/requests/${encodeURIComponent(id)}/resume`,
      undefined,
      opts,
    );
  },

  setWaiting(id: string, body: SetTechnicianWaitingBody, opts?: RequestOpts) {
    return v1Client.post<{ request: TechnicianWorkspaceRequest }>(
      `/technician-workspace/requests/${encodeURIComponent(id)}/waiting`,
      body,
      opts,
    );
  },

  resolveRequest(id: string, body: ResolveTechnicianRequestBody, opts?: RequestOpts) {
    return v1Client.post<{ request: TechnicianWorkspaceRequest }>(
      `/technician-workspace/requests/${encodeURIComponent(id)}/resolve`,
      body,
      opts,
    );
  },
};
