/**
 * platform-v1 SKUD integration client.
 * Backend: backend/src/v1/routes/skudIntegrations.js
 */

import { v1Client, type RequestOpts } from './client';
import type {
  SkudProviderFailureDashboardResponse,
  UUID,
} from './types';

export interface GetSkudProviderFailuresParams {
  property_id?: UUID;
  propertyId?: UUID;
  window_hours?: number;
  windowHours?: number;
  limit?: number;
}

export type SkudManualControlPolicy =
  | 'guard_allowed'
  | 'admin_only'
  | 'provider_only'
  | 'prohibited';
export type SkudFailSafeMode =
  | 'fail_closed'
  | 'fail_open_guarded'
  | 'provider_default'
  | 'manual_guard';
export type SkudMaintenanceStatus = 'normal' | 'maintenance' | 'out_of_service';
export type SkudManualControlAction =
  | 'manual_open'
  | 'manual_close'
  | 'manual_block'
  | 'manual_unblock'
  | 'manual_reset'
  | 'mark_degraded'
  | 'mark_restored';
export type SkudManualControlDecisionSource =
  | 'guard'
  | 'admin'
  | 'incident'
  | 'provider_fallback';
export type SkudSyncPassAction = 'provision' | 'revoke';
export type SkudFieldRolloutStage = 'lab' | 'staging' | 'pilot' | 'production';
export type SkudFieldRolloutEvidenceType =
  | 'provider_delivery'
  | 'field_drill'
  | 'rollout_report'
  | 'vendor_health_probe';
export type SkudFieldRolloutStatus = 'planned' | 'running' | 'passed' | 'failed' | 'blocked';

export interface ListSkudHardwareDevicesParams {
  property_id?: UUID;
  propertyId?: UUID;
  provider_config_id?: UUID;
  access_point_id?: UUID;
}

export interface ListSkudManualControlEventsParams {
  property_id?: UUID;
  propertyId?: UUID;
  limit?: number;
}

export interface SkudHardwareBoundaryBody {
  property_id?: UUID;
  propertyId?: UUID;
  manual_control_policy?: SkudManualControlPolicy;
  manualControlPolicy?: SkudManualControlPolicy;
  fail_safe_mode?: SkudFailSafeMode;
  failSafeMode?: SkudFailSafeMode;
  maintenance_status?: SkudMaintenanceStatus;
  maintenanceStatus?: SkudMaintenanceStatus;
  manual_action_requires_reason?: boolean;
  manualActionRequiresReason?: boolean;
  manual_action_requires_approval?: boolean;
  manualActionRequiresApproval?: boolean;
}

export interface SkudManualControlBody {
  property_id?: UUID;
  propertyId?: UUID;
  action: SkudManualControlAction;
  reason: string;
  decision_source?: SkudManualControlDecisionSource;
  decisionSource?: SkudManualControlDecisionSource;
  guard_device_id?: UUID | null;
  guardDeviceId?: UUID | null;
  device_fingerprint?: string | null;
  deviceFingerprint?: string | null;
  metadata?: Record<string, unknown>;
}

export interface SkudSyncPassBody {
  property_id?: UUID;
  propertyId?: UUID;
  pass_id: UUID;
  action?: SkudSyncPassAction;
}

type SkudFieldRolloutEvidenceTypeInput =
  | { evidence_type: SkudFieldRolloutEvidenceType; evidenceType?: SkudFieldRolloutEvidenceType }
  | { evidence_type?: SkudFieldRolloutEvidenceType; evidenceType: SkudFieldRolloutEvidenceType };

export type SkudFieldRolloutEvidenceBody = SkudFieldRolloutEvidenceTypeInput & {
  property_id?: UUID;
  propertyId?: UUID;
  provider_config_id?: UUID | null;
  providerConfigId?: UUID | null;
  hardware_device_id?: UUID | null;
  hardwareDeviceId?: UUID | null;
  rollout_stage?: SkudFieldRolloutStage;
  rolloutStage?: SkudFieldRolloutStage;
  status?: SkudFieldRolloutStatus;
  summary?: string | null;
  metrics?: Record<string, unknown>;
  observed_at?: string | null;
  observedAt?: string | null;
};

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

export const skudIntegrationsApi = {
  getProviderFailures(params?: GetSkudProviderFailuresParams, opts?: RequestOpts) {
    return v1Client.get<SkudProviderFailureDashboardResponse>(
      `/skud/provider-failures${toQuery(params)}`,
      opts,
    );
  },
  listHardwareDevices(params?: ListSkudHardwareDevicesParams, opts?: RequestOpts) {
    return v1Client.get<{ hardware_devices: Array<Record<string, unknown>> }>(
      `/skud/hardware-devices${toQuery(params)}`,
      opts,
    );
  },
  updateHardwareBoundary(hardwareDeviceId: UUID, body: SkudHardwareBoundaryBody, opts?: RequestOpts) {
    return v1Client.patch<Record<string, unknown>>(
      `/skud/hardware-devices/${encodeURIComponent(hardwareDeviceId)}/boundary`,
      body,
      opts,
    );
  },
  manualControl(hardwareDeviceId: UUID, body: SkudManualControlBody, opts?: RequestOpts) {
    return v1Client.post<Record<string, unknown>>(
      `/skud/hardware-devices/${encodeURIComponent(hardwareDeviceId)}/manual-control`,
      body,
      opts,
    );
  },
  listManualControlEvents(
    hardwareDeviceId: UUID,
    params?: ListSkudManualControlEventsParams,
    opts?: RequestOpts,
  ) {
    return v1Client.get<{ manual_control_events: Array<Record<string, unknown>> }>(
      `/skud/hardware-devices/${encodeURIComponent(hardwareDeviceId)}/manual-control-events${toQuery(params)}`,
      opts,
    );
  },
  recordFieldRolloutEvidence(body: SkudFieldRolloutEvidenceBody, opts?: RequestOpts) {
    return v1Client.post<{ evidence: Record<string, unknown> }>(
      '/skud/field-rollout-evidence',
      body,
      opts,
    );
  },
  syncPass(providerConfigId: UUID, body: SkudSyncPassBody, opts?: RequestOpts) {
    return v1Client.post<{
      pass_id: UUID;
      provider_config_id: UUID;
      integration_event: Record<string, unknown>;
    }>(
      `/skud/providers/${encodeURIComponent(providerConfigId)}/sync-pass`,
      body,
      opts,
    );
  },
};
