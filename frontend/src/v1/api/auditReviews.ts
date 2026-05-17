/**
 * platform-v1 sensitive action review reports.
 * Backend: backend/src/v1/routes/auditReviews.js
 */

import { v1Client, type RequestOpts } from './client';
import type {
  AuditEscalationStatus,
  AuditReviewPriority,
  AuditReviewStatus,
  IsoDateTime,
  SensitiveActionAntiAbuseResponse,
  SensitiveActionListResponse,
  SensitiveActionMetaResponse,
  SensitiveActionSummaryResponse,
  UUID,
} from './types';

export interface SensitiveActionReportParams {
  property_id?: UUID;
  category?: string;
}

export interface SensitiveActionListParams extends SensitiveActionReportParams {
  review_status?: AuditReviewStatus;
  priority?: AuditReviewPriority;
  escalation_status?: AuditEscalationStatus;
  assigned_reviewer_staff_id?: UUID;
  assigned_to_me?: boolean;
  overdue?: boolean;
  actor_uid?: string;
  resource_type?: string;
  from?: IsoDateTime;
  to?: IsoDateTime;
  limit?: number;
  offset?: number;
}

export interface SensitiveActionAntiAbuseParams extends SensitiveActionReportParams {
  window_hours?: number;
  min_actions?: number;
  limit?: number;
}

export type SensitiveActionReportEvidenceType =
  | 'summary'
  | 'anti_abuse'
  | 'escalation'
  | 'attestation'
  | 'live_rollout';

export type SensitiveActionReportEvidenceStatus = 'generated' | 'reviewed' | 'failed';

export type SensitiveActionReviewDecision = Exclude<AuditReviewStatus, 'pending'>;

export interface SensitiveActionReportEvidence {
  id: UUID;
  property_id: UUID;
  report_type: SensitiveActionReportEvidenceType;
  status: SensitiveActionReportEvidenceStatus;
  period_from: IsoDateTime | null;
  period_to: IsoDateTime | null;
  summary: Record<string, unknown>;
  generated_by_uid: string | null;
  created_at: IsoDateTime | null;
}

export interface SensitiveActionReportEvidenceParams {
  property_id?: UUID;
  report_type?: SensitiveActionReportEvidenceType;
  status?: SensitiveActionReportEvidenceStatus;
  limit?: number;
}

export interface RecordSensitiveActionReportEvidenceBody {
  property_id?: UUID;
  propertyId?: UUID;
  report_type?: SensitiveActionReportEvidenceType;
  reportType?: SensitiveActionReportEvidenceType;
  status?: SensitiveActionReportEvidenceStatus;
  period_from?: IsoDateTime | null;
  periodFrom?: IsoDateTime | null;
  period_to?: IsoDateTime | null;
  periodTo?: IsoDateTime | null;
  summary?: Record<string, unknown>;
}

export interface SampleSensitiveActionsBody extends SensitiveActionReportParams {
  window_hours?: number;
  sample_percent?: number;
  due_hours?: number;
  limit?: number;
}

export interface EscalateSensitiveActionsBody {
  property_id?: UUID;
  limit?: number;
  escalate_after_hours?: number;
}

export interface SensitiveActionReviewRecord {
  id: UUID;
  audit_log_id: UUID;
  property_id: UUID | null;
  category: string;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  review_status: AuditReviewStatus;
  review_reason: string | null;
  reviewer_staff_id: UUID | null;
  reviewed_at: IsoDateTime | null;
  comment: string | null;
  classification_snapshot?: Record<string, unknown> | null;
  assigned_reviewer_staff_id?: UUID | null;
  assigned_by_staff_id?: UUID | null;
  assigned_at?: IsoDateTime | null;
  due_at?: IsoDateTime | null;
  priority?: AuditReviewPriority;
  assignment_reason?: string | null;
  escalation_status?: AuditEscalationStatus;
  escalation_note?: string | null;
  last_escalated_at?: IsoDateTime | null;
  created_at?: IsoDateTime;
  updated_at?: IsoDateTime | null;
}

export interface AssignSensitiveActionReviewBody {
  assigned_reviewer_staff_id?: UUID | null;
  due_at?: IsoDateTime | null;
  priority?: AuditReviewPriority;
  reason?: string | null;
}

export interface ReviewSensitiveActionBody {
  decision: SensitiveActionReviewDecision;
  comment?: string | null;
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

export const auditReviewsApi = {
  meta(opts?: RequestOpts) {
    return v1Client.get<SensitiveActionMetaResponse>('/audit/sensitive-actions/_meta', opts);
  },

  summary(params?: SensitiveActionReportParams, opts?: RequestOpts) {
    return v1Client.get<SensitiveActionSummaryResponse>(
      `/audit/sensitive-actions/_summary${toQuery(params)}`,
      opts,
    );
  },

  antiAbuse(params?: SensitiveActionAntiAbuseParams, opts?: RequestOpts) {
    return v1Client.get<SensitiveActionAntiAbuseResponse>(
      `/audit/sensitive-actions/_anti-abuse${toQuery(params)}`,
      opts,
    );
  },

  list(params?: SensitiveActionListParams, opts?: RequestOpts) {
    return v1Client.get<SensitiveActionListResponse>(
      `/audit/sensitive-actions${toQuery(params)}`,
      opts,
    );
  },

  listReportEvidence(params?: SensitiveActionReportEvidenceParams, opts?: RequestOpts) {
    return v1Client.get<{ evidence: SensitiveActionReportEvidence[] }>(
      `/audit/sensitive-actions/_report-evidence${toQuery(params)}`,
      opts,
    );
  },

  recordReportEvidence(body: RecordSensitiveActionReportEvidenceBody, opts?: RequestOpts) {
    return v1Client.post<{ evidence: SensitiveActionReportEvidence }>(
      '/audit/sensitive-actions/_report-evidence',
      body,
      opts,
    );
  },

  sample(body: SampleSensitiveActionsBody, opts?: RequestOpts) {
    return v1Client.post<{ sampled_count: number; reviews: SensitiveActionReviewRecord[] }>(
      '/audit/sensitive-actions/_sample',
      body,
      opts,
    );
  },

  escalate(body?: EscalateSensitiveActionsBody, opts?: RequestOpts) {
    return v1Client.post<{
      escalated_count: number;
      overdue_count: number;
      hard_escalated_count: number;
      reviews: SensitiveActionReviewRecord[];
    }>(
      '/audit/sensitive-actions/_escalate',
      body,
      opts,
    );
  },

  assign(id: UUID, body: AssignSensitiveActionReviewBody, opts?: RequestOpts) {
    return v1Client.post<{ review: SensitiveActionReviewRecord }>(
      `/audit/sensitive-actions/${encodeURIComponent(id)}/assign`,
      body,
      opts,
    );
  },

  review(id: UUID, body: ReviewSensitiveActionBody, opts?: RequestOpts) {
    return v1Client.post<{ review: SensitiveActionReviewRecord }>(
      `/audit/sensitive-actions/${encodeURIComponent(id)}/review`,
      body,
      opts,
    );
  },
};
