/**
 * platform-v1 canonical service request client.
 * Backend: backend/src/routes/requests.js mounted at /api/v1/requests.
 */

import { v1Client, type RequestOpts } from './client';
import type {
  EmergencyDispatchProfile,
  EmergencyDispatchStatus,
  EmergencyEscalationTarget,
  EmergencyNotificationStatus,
  EmergencyProviderDeliveryChannel,
  EmergencyProviderDeliveryEvidence,
  EmergencyProviderDeliveryStatus,
  EmergencySeverity,
  EmergencyType,
  PageMeta,
  PaginationParams,
  ServiceRequest,
  ServiceRequestAttachment,
  ServiceRequestCategory,
  ServiceRequestCategoryDomain,
  ServiceRequestHistoryRow,
  ServiceRequestUpdate,
  StaffRequestPriority,
  StaffRequestStatus,
  StaffRequestTargetType,
  StaffRequestType,
  StaffSlaProfile,
  UUID,
} from './types';

export type AssignableServiceRequestRole =
  | 'security'
  | 'concierge'
  | 'technician'
  | 'contractor'
  | 'property_admin'
  | 'management_company_admin'
  | 'platform_admin'
  | 'admin';

export interface ListServiceRequestsParams extends PaginationParams {
  page?: number;
  limit?: number;
}

export interface ListServiceRequestCategoriesParams {
  /** @deprecated Use propertyId; backend /api/v1/requests reads propertyId. */
  property_id?: UUID;
  propertyId?: UUID;
}

export interface UpsertServiceRequestCategoryBody {
  propertyId?: UUID;
  /** @deprecated Use propertyId; backend /api/v1/requests reads propertyId. */
  property_id?: UUID;
  name: string;
  domain?: ServiceRequestCategoryDomain;
  targetScope?: StaffRequestTargetType;
  priority?: StaffRequestPriority;
  slaProfile?: StaffSlaProfile;
  firstResponseMinutes?: number | null;
  resolutionMinutes?: number | null;
  isEmergency?: boolean;
  metadata?: Record<string, unknown>;
}

export interface CreateServiceRequestBody {
  type: StaffRequestType;
  category: string;
  status?: StaffRequestStatus;
  createdByApt?: string;
  visitorName?: string;
  visitorPhone?: string;
  carPlate?: string;
  comment?: string;
  passDuration?: string;
  validUntil?: string | null;
  scheduledFor?: string | null;
  photos?: string[];
  targetType?: StaffRequestTargetType;
  targetId?: UUID;
  unitId?: UUID;
  homeId?: UUID;
  accessZoneId?: UUID;
  accessPointId?: UUID;
  emergencyType?: EmergencyType;
  severity?: EmergencySeverity;
  escalationTarget?: EmergencyEscalationTarget;
}

export interface UpdateServiceRequestBody {
  status?: StaffRequestStatus;
  expectedCurrentStatus?: StaffRequestStatus;
  historyLabel?: string;
  comment?: string;
  visitorName?: string;
  visitorPhone?: string;
  carPlate?: string;
  arrivedAt?: string | null;
  scheduledFor?: string | null;
  validUntil?: string | null;
  passDuration?: string;
  photos?: string[];
}

type AssignServiceRequestUidInput =
  | { assigneeUid: string; assignee_uid?: string }
  | { assigneeUid?: string; assignee_uid: string };

type AssignServiceRequestRoleInput =
  | { assigneeRole: AssignableServiceRequestRole; assignee_role?: AssignableServiceRequestRole }
  | { assigneeRole?: AssignableServiceRequestRole; assignee_role: AssignableServiceRequestRole };

export type AssignServiceRequestBody = AssignServiceRequestUidInput & AssignServiceRequestRoleInput & {
  assigneeName?: string;
  assignee_name?: string;
  expectedCurrentStatus?: StaffRequestStatus;
  expected_current_status?: StaffRequestStatus;
};

export interface CreateServiceRequestAttachmentBody {
  fileUrl: string;
  fileKind?: 'photo' | 'document' | 'other';
  visibility?: 'resident';
  metadata?: Record<string, unknown>;
}

export interface CreateServiceRequestUpdateBody {
  body: string;
  visibility?: 'resident';
  attachmentIds?: UUID[];
}

export interface ServiceRequestRateBody {
  rating: number;
  comment?: string;
}

export interface ServiceRequestEmergencyQueueParams {
  property_id?: UUID;
  propertyId?: UUID;
  status?: EmergencyDispatchStatus;
  severity?: EmergencySeverity;
  limit?: number;
}

export type ServiceRequestEmergencyDispatchAction =
  | 'acknowledge'
  | 'dispatch'
  | 'escalate'
  | 'resolve'
  | 'cancel';

export interface ServiceRequestEmergencyDispatchBody {
  action: ServiceRequestEmergencyDispatchAction;
  escalationTarget?: EmergencyEscalationTarget;
  reason?: string;
  notificationStatus?: EmergencyNotificationStatus;
}

export interface CreateEmergencyProviderDeliveryEvidenceBody {
  property_id?: UUID;
  propertyId?: UUID;
  requestId?: string;
  drillId?: UUID;
  provider: string;
  channel: EmergencyProviderDeliveryChannel;
  scenarioType?: EmergencyType;
  status?: EmergencyProviderDeliveryStatus;
  latencyMs?: number | null;
  externalDeliveryId?: string | null;
  observedAt?: string | null;
  payload?: Record<string, unknown>;
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

function normalizeCategoryParams(
  params: ListServiceRequestCategoriesParams | undefined,
): ListServiceRequestCategoriesParams | undefined {
  if (!params?.property_id) return params;
  const { property_id, ...rest } = params;
  return { ...rest, propertyId: rest.propertyId ?? property_id };
}

function normalizeCategoryBody(
  body: UpsertServiceRequestCategoryBody,
): UpsertServiceRequestCategoryBody {
  if (!body.property_id) return body;
  const { property_id, ...rest } = body;
  return { ...rest, propertyId: rest.propertyId ?? property_id };
}

export const serviceRequestsApi = {
  list(params?: ListServiceRequestsParams, opts?: RequestOpts) {
    return v1Client.get<{
      data: ServiceRequest[];
      total: number;
      page: number;
      limit: number;
      meta?: PageMeta;
    }>(`/requests${toQuery(params)}`, opts);
  },

  create(body: CreateServiceRequestBody, opts?: RequestOpts) {
    return v1Client.post<ServiceRequest>(
      '/requests',
      body,
      opts,
    );
  },

  getById(id: string, opts?: RequestOpts) {
    return v1Client.get<ServiceRequest>(
      `/requests/${encodeURIComponent(id)}`,
      opts,
    );
  },

  update(id: string, body: UpdateServiceRequestBody, opts?: RequestOpts) {
    return v1Client.patch<ServiceRequest>(
      `/requests/${encodeURIComponent(id)}`,
      body,
      opts,
    );
  },

  delete(id: string, opts?: RequestOpts) {
    return v1Client.delete<{ ok: true }>(
      `/requests/${encodeURIComponent(id)}`,
      opts,
    );
  },

  assign(id: string, body: AssignServiceRequestBody, opts?: RequestOpts) {
    return v1Client.post<ServiceRequest>(
      `/requests/${encodeURIComponent(id)}/assign`,
      body,
      opts,
    );
  },

  markFirstResponse(id: string, opts?: RequestOpts) {
    return v1Client.post<ServiceRequest>(
      `/requests/${encodeURIComponent(id)}/first-response`,
      undefined,
      opts,
    );
  },

  listCategories(params?: ListServiceRequestCategoriesParams, opts?: RequestOpts) {
    return v1Client.get<{ data: ServiceRequestCategory[] }>(
      `/requests/categories${toQuery(normalizeCategoryParams(params))}`,
      opts,
    );
  },

  upsertCategory(code: string, body: UpsertServiceRequestCategoryBody, opts?: RequestOpts) {
    return v1Client.put<ServiceRequestCategory>(
      `/requests/categories/${encodeURIComponent(code)}`,
      normalizeCategoryBody(body),
      opts,
    );
  },

  listAttachments(id: string, opts?: RequestOpts) {
    return v1Client.get<{ data: ServiceRequestAttachment[] }>(
      `/requests/${encodeURIComponent(id)}/attachments`,
      opts,
    );
  },

  createAttachment(id: string, body: CreateServiceRequestAttachmentBody, opts?: RequestOpts) {
    return v1Client.post<ServiceRequestAttachment>(
      `/requests/${encodeURIComponent(id)}/attachments`,
      body,
      opts,
    );
  },

  listUpdates(id: string, opts?: RequestOpts) {
    return v1Client.get<{ data: ServiceRequestUpdate[] }>(
      `/requests/${encodeURIComponent(id)}/updates`,
      opts,
    );
  },

  createUpdate(id: string, body: CreateServiceRequestUpdateBody, opts?: RequestOpts) {
    return v1Client.post<ServiceRequestUpdate>(
      `/requests/${encodeURIComponent(id)}/updates`,
      body,
      opts,
    );
  },

  getHistory(id: string, opts?: RequestOpts) {
    return v1Client.get<ServiceRequestHistoryRow[]>(
      `/requests/${encodeURIComponent(id)}/history`,
      opts,
    );
  },

  rate(id: string, body: ServiceRequestRateBody, opts?: RequestOpts) {
    return v1Client.post<{ ok: true; rating: unknown }>(
      `/requests/${encodeURIComponent(id)}/rate`,
      body,
      opts,
    );
  },

  emergencyQueue(params?: ServiceRequestEmergencyQueueParams, opts?: RequestOpts) {
    return v1Client.get<{ data: EmergencyDispatchProfile[] }>(
      `/requests/emergency/queue${toQuery(params)}`,
      opts,
    );
  },

  emergencyDispatch(id: string, body: ServiceRequestEmergencyDispatchBody, opts?: RequestOpts) {
    return v1Client.post<{ emergencyProfile: EmergencyDispatchProfile }>(
      `/requests/${encodeURIComponent(id)}/emergency-dispatch`,
      body,
      opts,
    );
  },

  recordProviderDeliveryEvidence(
    body: CreateEmergencyProviderDeliveryEvidenceBody,
    opts?: RequestOpts,
  ) {
    return v1Client.post<{ evidence: EmergencyProviderDeliveryEvidence }>(
      '/requests/emergency/provider-delivery-evidence',
      body,
      opts,
    );
  },
};
