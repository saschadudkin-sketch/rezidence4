/**
 * platform-v1 privacy / compliance client.
 * Backend: backend/src/routes/privacy.js mounted at /api/v1/privacy.
 */

import { v1Client, type RequestOpts } from './client';
import type { IsoDateTime, UUID } from './types';

export type DataSubjectRequestType = 'export' | 'delete' | 'correct' | 'restrict' | (string & {});
export type DataSubjectRequestStatus = 'pending' | 'completed' | 'rejected' | (string & {});

export interface PrivacyConsentStatus {
  currentVersion: string;
  acceptedVersion: string | null;
  acceptedAt: IsoDateTime | null;
  needsAcceptance: boolean;
}

export interface AcceptPrivacyConsentBody {
  version: string;
}

export interface DataSubjectExportParams {
  property_id?: UUID;
  propertyId?: UUID;
  subject_resident_id?: UUID;
  subjectResidentId?: UUID;
}

export interface ListDataSubjectRequestsParams {
  property_id?: UUID;
  propertyId?: UUID;
  status?: DataSubjectRequestStatus;
  request_type?: DataSubjectRequestType;
  requestType?: DataSubjectRequestType;
  subject_uid?: string;
  subjectUid?: string;
  subject_resident_id?: UUID;
  subjectResidentId?: UUID;
  limit?: number;
}

export interface CreateDataSubjectRequestBody {
  property_id?: UUID;
  propertyId?: UUID;
  request_type?: DataSubjectRequestType;
  requestType?: DataSubjectRequestType;
  subject_uid?: string;
  subjectUid?: string;
  subject_resident_id?: UUID | null;
  subjectResidentId?: UUID | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CompleteDataSubjectRequestBody {
  status?: DataSubjectRequestStatus;
  decision?: string;
  evidence?: Record<string, unknown>;
  export_payload?: Record<string, unknown>;
  exportPayload?: Record<string, unknown>;
  retention_reason?: string | null;
  retentionReason?: string | null;
}

export interface ListComplianceEvidenceParams {
  property_id?: UUID;
  propertyId?: UUID;
  control?: string;
  evidence_type?: string;
  evidenceType?: string;
  limit?: number;
}

export interface CreateComplianceEvidenceBody {
  property_id?: UUID;
  propertyId?: UUID;
  control: string;
  evidence_type?: string;
  evidenceType?: string;
  status?: string;
  payload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface DeleteAccountBody {
  reason?: string | null;
}

function toQuery(params?: object): string {
  if (!params) return '';
  const entries = Object.entries(params).filter(
    ([, value]) => value !== undefined && value !== null && value !== '',
  );
  if (!entries.length) return '';
  const qs = new URLSearchParams();
  for (const [key, value] of entries) qs.set(key, String(value));
  return `?${qs.toString()}`;
}

export const privacyComplianceApi = {
  getConsent(opts?: RequestOpts) {
    return v1Client.get<PrivacyConsentStatus>('/privacy/consent', opts);
  },

  acceptConsent(body: AcceptPrivacyConsentBody, opts?: RequestOpts) {
    return v1Client.post<{ ok: true; version: string; acceptedAt: IsoDateTime }>(
      '/privacy/consent',
      body,
      opts,
    );
  },

  getDataSubjectExport(params?: DataSubjectExportParams, opts?: RequestOpts) {
    return v1Client.get<{ export: Record<string, unknown> }>(
      `/privacy/data-subject-export${toQuery(params)}`,
      opts,
    );
  },

  listDataSubjectRequests(params?: ListDataSubjectRequestsParams, opts?: RequestOpts) {
    return v1Client.get<{ requests: Array<Record<string, unknown>> }>(
      `/privacy/data-subject-requests${toQuery(params)}`,
      opts,
    );
  },

  createDataSubjectRequest(body: CreateDataSubjectRequestBody, opts?: RequestOpts) {
    return v1Client.post<{ request: Record<string, unknown> }>(
      '/privacy/data-subject-requests',
      body,
      opts,
    );
  },

  completeDataSubjectRequest(id: UUID | string, body: CompleteDataSubjectRequestBody, opts?: RequestOpts) {
    return v1Client.post<{ request: Record<string, unknown> }>(
      `/privacy/data-subject-requests/${encodeURIComponent(id)}/complete`,
      body,
      opts,
    );
  },

  listComplianceEvidence(params?: ListComplianceEvidenceParams, opts?: RequestOpts) {
    return v1Client.get<{ evidence: Array<Record<string, unknown>> }>(
      `/privacy/compliance-evidence${toQuery(params)}`,
      opts,
    );
  },

  createComplianceEvidence(body: CreateComplianceEvidenceBody, opts?: RequestOpts) {
    return v1Client.post<{ evidence: Record<string, unknown> }>(
      '/privacy/compliance-evidence',
      body,
      opts,
    );
  },

  getReadiness(params?: { property_id?: UUID; propertyId?: UUID }, opts?: RequestOpts) {
    return v1Client.get<{ readiness: Record<string, unknown> }>(
      `/privacy/readiness${toQuery(params)}`,
      opts,
    );
  },

  deleteAccount(body: DeleteAccountBody = {}, opts?: RequestOpts) {
    return v1Client.post<{ ok: true; auditId: UUID | string }>(
      '/privacy/delete-account',
      body,
      opts,
    );
  },
};
