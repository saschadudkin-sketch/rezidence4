/**
 * platform-v1 privacy / compliance client.
 * Backend: backend/src/routes/privacy.js mounted at /api/v1/privacy.
 */

import { v1Client, type RequestOpts } from './client';
import type { IsoDateTime, UUID } from './types';

export type DataSubjectRequestType = 'export' | 'delete' | 'correct' | 'restrict' | (string & {});
export type DataSubjectRequestStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'rejected'
  | 'cancelled'
  | (string & {});
export type DataSubjectRequestCompletionStatus =
  | 'in_progress'
  | 'completed'
  | 'rejected'
  | 'cancelled'
  | (string & {});
export type ComplianceEvidenceType =
  | 'dsar_workflow'
  | 'retention_sweep'
  | 'data_localization'
  | 'ispdn_readiness'
  | 'no_biometrics_release_guard'
  | 'consent_history'
  | 'deletion_procedure'
  | (string & {});
export type ComplianceEvidenceStatus = 'draft' | 'ready' | 'reviewed' | 'blocked' | (string & {});

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
  status?: DataSubjectRequestCompletionStatus;
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
  evidence_type?: ComplianceEvidenceType;
  evidenceType?: ComplianceEvidenceType;
  status?: ComplianceEvidenceStatus;
  limit?: number;
}

type ComplianceEvidenceTypeInput =
  | { evidence_type: ComplianceEvidenceType; evidenceType?: ComplianceEvidenceType; type?: ComplianceEvidenceType }
  | { evidence_type?: ComplianceEvidenceType; evidenceType: ComplianceEvidenceType; type?: ComplianceEvidenceType }
  | { evidence_type?: ComplianceEvidenceType; evidenceType?: ComplianceEvidenceType; type: ComplianceEvidenceType };

export type CreateComplianceEvidenceBody = ComplianceEvidenceTypeInput & {
  property_id?: UUID;
  propertyId?: UUID;
  status?: ComplianceEvidenceStatus;
  summary?: string | null;
  artifact_uri?: string | null;
  artifactUri?: string | null;
  evidence?: Record<string, unknown>;
};

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

function normalizeDataSubjectRequestParams(
  params?: ListDataSubjectRequestsParams,
): Record<string, unknown> | undefined {
  if (!params) return undefined;
  const normalized: Record<string, unknown> = { ...params };
  if (normalized.request_type === undefined && normalized.requestType !== undefined) {
    normalized.request_type = normalized.requestType;
  }
  delete normalized.requestType;
  return normalized;
}

function normalizeComplianceEvidenceParams(
  params?: ListComplianceEvidenceParams,
): Record<string, unknown> | undefined {
  if (!params) return undefined;
  const normalized: Record<string, unknown> = { ...params };
  if (normalized.evidence_type === undefined && normalized.evidenceType !== undefined) {
    normalized.evidence_type = normalized.evidenceType;
  }
  delete normalized.evidenceType;
  return normalized;
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
      `/privacy/data-subject-requests${toQuery(normalizeDataSubjectRequestParams(params))}`,
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
      `/privacy/compliance-evidence${toQuery(normalizeComplianceEvidenceParams(params))}`,
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
