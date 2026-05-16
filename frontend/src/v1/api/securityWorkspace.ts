/**
 * platform-v1 security workspace client.
 * Backend: backend/src/v1/routes/securityWorkspace.js
 */

import { v1Client, type RequestOpts } from './client';
import type {
  ManualSecurityDecisionRequest,
  ManualSecurityDecisionResponse,
  PaginationParams,
  SecurityOfflineReplayEvent,
  SecurityOfflineReplayResponse,
  SecurityWorkspaceBootstrapResponse,
  SecurityWorkspaceRecentEventsResponse,
  SecurityWorkspaceSearchResponse,
  UUID,
} from './types';

interface SecurityWorkspaceScopedParams extends PaginationParams {
  property_id: UUID;
  access_point_id?: UUID | null;
}

export interface SecurityWorkspaceBootstrapParams extends SecurityWorkspaceScopedParams {
  occurred_at?: string;
  active_passes_limit?: number;
  expected_guests_limit?: number;
  recent_events_limit?: number;
  blacklist_hits_limit?: number;
}

export interface SecurityWorkspaceSearchParams extends SecurityWorkspaceScopedParams {
  q: string;
}

function toQuery(params: object | undefined): string {
  if (!params) return '';
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (!entries.length) return '';
  const qs = new URLSearchParams();
  for (const [key, value] of entries) qs.set(key, String(value));
  return `?${qs.toString()}`;
}

export const securityWorkspaceApi = {
  bootstrap(params: SecurityWorkspaceBootstrapParams, opts?: RequestOpts) {
    return v1Client.get<SecurityWorkspaceBootstrapResponse>(
      `/security-workspace/bootstrap${toQuery(params)}`,
      opts,
    );
  },
  search(params: SecurityWorkspaceSearchParams, opts?: RequestOpts) {
    return v1Client.get<SecurityWorkspaceSearchResponse>(
      `/security-workspace/search${toQuery(params)}`,
      opts,
    );
  },
  recentEvents(params: SecurityWorkspaceScopedParams, opts?: RequestOpts) {
    return v1Client.get<SecurityWorkspaceRecentEventsResponse>(
      `/security-workspace/recent-events${toQuery(params)}`,
      opts,
    );
  },
  manualDecision(body: ManualSecurityDecisionRequest, opts?: RequestOpts) {
    return v1Client.post<ManualSecurityDecisionResponse>(
      '/security-workspace/manual-decision',
      body,
      {
        ...opts,
        skipRetry: true,
      },
    );
  },
  offlineReplay(body: { property_id: UUID; events: SecurityOfflineReplayEvent[] }, opts?: RequestOpts) {
    return v1Client.post<SecurityOfflineReplayResponse>(
      '/security-workspace/offline-replay',
      body,
      {
        ...opts,
        skipRetry: true,
      },
    );
  },
};
