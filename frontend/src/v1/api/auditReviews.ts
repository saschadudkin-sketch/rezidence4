/**
 * platform-v1 sensitive action review reports.
 * Backend: backend/src/v1/routes/auditReviews.js
 */

import { v1Client, type RequestOpts } from './client';
import type {
  AuditReviewPriority,
  AuditReviewStatus,
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
  overdue?: boolean;
  limit?: number;
  offset?: number;
}

export interface SensitiveActionAntiAbuseParams extends SensitiveActionReportParams {
  window_hours?: number;
  min_actions?: number;
  limit?: number;
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
};
