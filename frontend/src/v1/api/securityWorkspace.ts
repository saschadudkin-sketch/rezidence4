/**
 * platform-v1 security workspace client.
 * Backend: backend/src/v1/routes/securityWorkspace.js
 */

import { v1Client, type RequestOpts } from './client';
import type {
  ManualSecurityDecisionRequest,
  ManualSecurityDecisionResponse,
  SecurityWorkspaceBootstrap,
  GuardAuthorizedDeviceContext,
  GuardAuthorizedDeviceResponse,
  GuardAuthorizedDevicesResponse,
  SecurityWorkspaceRecentEvent,
  PaginationParams,
  SecurityOfflineReplayEvent,
  SecurityOfflineReplayResponse,
  SecurityWorkspaceBootstrapResponse,
  SecurityWorkspaceRecentEventsResponse,
  SecurityWorkspaceSearchResponse,
  VisitLog,
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

export interface SecurityWorkspaceDashboardResponse {
  expectedArrivals: number;
  activePasses: number;
  openIncidents: number;
  recentEvents: SecurityWorkspaceRecentEvent[];
  workspace: SecurityWorkspaceBootstrap;
}

export interface SecurityWorkspaceSearchParams extends SecurityWorkspaceScopedParams {
  q: string;
}

export type ManualSecurityDecisionAliasBody = Omit<
  ManualSecurityDecisionRequest,
  'decision'
> & {
  decision?: ManualSecurityDecisionRequest['decision'];
};

export interface ReconcileDegradedEventBody {
  property_id: UUID;
  reconciliation_state: 'matched' | 'discrepancy' | 'dismissed';
  note?: string | null;
}

export interface EnrollGuardAuthorizedDeviceBody {
  property_id: UUID;
  access_point_id?: UUID | null;
  device_fingerprint: string;
  label?: string | null;
}

export interface ListGuardAuthorizedDevicesParams extends SecurityWorkspaceScopedParams {
  status?: 'pending' | 'active' | 'revoked';
}

export interface RevokeGuardAuthorizedDeviceBody {
  property_id: UUID;
  reason?: string | null;
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
  dashboard(params: SecurityWorkspaceBootstrapParams, opts?: RequestOpts) {
    return v1Client.get<SecurityWorkspaceDashboardResponse>(
      `/security-workspace/dashboard${toQuery(params)}`,
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
  manualAdmit(body: ManualSecurityDecisionAliasBody, opts?: RequestOpts) {
    return v1Client.post<ManualSecurityDecisionResponse>(
      '/security-workspace/manual-admit',
      body,
      {
        ...opts,
        skipRetry: true,
      },
    );
  },
  manualDeny(body: ManualSecurityDecisionAliasBody, opts?: RequestOpts) {
    return v1Client.post<ManualSecurityDecisionResponse>(
      '/security-workspace/manual-deny',
      body,
      {
        ...opts,
        skipRetry: true,
      },
    );
  },
  offlineReplay(
    body: { property_id: UUID; events: SecurityOfflineReplayEvent[] } & Partial<GuardAuthorizedDeviceContext>,
    opts?: RequestOpts,
  ) {
    return v1Client.post<SecurityOfflineReplayResponse>(
      '/security-workspace/offline-replay',
      body,
      {
        ...opts,
        skipRetry: true,
      },
    );
  },
  enrollAuthorizedDevice(body: EnrollGuardAuthorizedDeviceBody, opts?: RequestOpts) {
    return v1Client.post<GuardAuthorizedDeviceResponse>(
      '/security-workspace/authorized-devices/enroll',
      body,
      {
        ...opts,
        skipRetry: true,
      },
    );
  },
  listAuthorizedDevices(params: ListGuardAuthorizedDevicesParams, opts?: RequestOpts) {
    return v1Client.get<GuardAuthorizedDevicesResponse>(
      `/security-workspace/authorized-devices${toQuery(params)}`,
      opts,
    );
  },
  approveAuthorizedDevice(id: UUID, body: RevokeGuardAuthorizedDeviceBody, opts?: RequestOpts) {
    return v1Client.post<GuardAuthorizedDeviceResponse>(
      `/security-workspace/authorized-devices/${encodeURIComponent(id)}/approve`,
      body,
      {
        ...opts,
        skipRetry: true,
      },
    );
  },
  revokeAuthorizedDevice(id: UUID, body: RevokeGuardAuthorizedDeviceBody, opts?: RequestOpts) {
    return v1Client.post<GuardAuthorizedDeviceResponse>(
      `/security-workspace/authorized-devices/${encodeURIComponent(id)}/revoke`,
      body,
      {
        ...opts,
        skipRetry: true,
      },
    );
  },
  reconcileDegradedEvent(id: UUID, body: ReconcileDegradedEventBody, opts?: RequestOpts) {
    return v1Client.post<{ visit_log: VisitLog }>(
      `/security-workspace/degraded-events/${encodeURIComponent(id)}/reconcile`,
      body,
      {
        ...opts,
        skipRetry: true,
      },
    );
  },
};
