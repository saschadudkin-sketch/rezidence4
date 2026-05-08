/**
 * platform-v1 contractor workspace client.
 * Backend: backend/src/v1/routes/contractorWorkspace.js.
 */

import { v1Client, type RequestOpts } from './client';
import type {
  ContractorWorkspaceQueue,
  ContractorWorkspaceRequest,
  ContractorWorkspaceRequestDetail,
  PageMeta,
  PaginationParams,
  StaffRequestPriority,
  StaffRequestStatus,
  StaffRequestTargetType,
} from './types';

export interface ListContractorWorkspaceQueueParams extends PaginationParams {
  queue?: ContractorWorkspaceQueue;
  status?: StaffRequestStatus | string;
  contractor_user_id?: string;
  contractorUserId?: string;
  contractor_company_id?: string;
  contractorCompanyId?: string;
  category?: string;
  priority?: StaffRequestPriority;
  target_type?: StaffRequestTargetType;
  target_id?: string;
  unit_id?: string;
  home_id?: string;
  access_zone_id?: string;
  access_point_id?: string;
  q?: string;
}

export interface AssignContractorRequestBody {
  contractorUserId: string;
  note?: string;
}

export interface SetContractorWaitingBody {
  reason?: 'parts';
  note?: string;
}

export interface ResolveContractorRequestBody {
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

export const contractorWorkspaceApi = {
  listQueue(params?: ListContractorWorkspaceQueueParams, opts?: RequestOpts) {
    return v1Client.get<{
      requests: ContractorWorkspaceRequest[];
      total: number;
      page?: PageMeta;
    }>(`/contractor-workspace/queue${toQuery(params)}`, opts);
  },

  getRequestDetail(id: string, opts?: RequestOpts) {
    return v1Client.get<ContractorWorkspaceRequestDetail>(
      `/contractor-workspace/requests/${encodeURIComponent(id)}`,
      opts,
    );
  },

  assignRequest(id: string, body: AssignContractorRequestBody, opts?: RequestOpts) {
    return v1Client.post<{ request: ContractorWorkspaceRequest }>(
      `/contractor-workspace/requests/${encodeURIComponent(id)}/assign`,
      body,
      opts,
    );
  },

  startRequest(id: string, opts?: RequestOpts) {
    return v1Client.post<{ request: ContractorWorkspaceRequest }>(
      `/contractor-workspace/requests/${encodeURIComponent(id)}/start`,
      undefined,
      opts,
    );
  },

  resumeRequest(id: string, opts?: RequestOpts) {
    return v1Client.post<{ request: ContractorWorkspaceRequest }>(
      `/contractor-workspace/requests/${encodeURIComponent(id)}/resume`,
      undefined,
      opts,
    );
  },

  setWaiting(id: string, body: SetContractorWaitingBody, opts?: RequestOpts) {
    return v1Client.post<{ request: ContractorWorkspaceRequest }>(
      `/contractor-workspace/requests/${encodeURIComponent(id)}/waiting`,
      body,
      opts,
    );
  },

  resolveRequest(id: string, body: ResolveContractorRequestBody, opts?: RequestOpts) {
    return v1Client.post<{ request: ContractorWorkspaceRequest }>(
      `/contractor-workspace/requests/${encodeURIComponent(id)}/resolve`,
      body,
      opts,
    );
  },
};
