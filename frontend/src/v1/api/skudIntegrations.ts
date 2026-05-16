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
  window_hours?: number;
  limit?: number;
}

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
  access_point_id?: UUID | null;
  accessPointId?: UUID | null;
  manual_control_enabled?: boolean;
  manualControlEnabled?: boolean;
  fail_mode?: string;
  failMode?: string;
  notes?: string | null;
}

export interface SkudManualControlBody {
  property_id?: UUID;
  propertyId?: UUID;
  action: string;
  reason: string;
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
  action?: 'provision' | 'revoke' | 'refresh' | string;
}

export interface SkudFieldRolloutEvidenceBody {
  property_id?: UUID;
  propertyId?: UUID;
  provider_config_id?: UUID | null;
  hardware_device_id?: UUID | null;
  rollout_stage?: string;
  evidence_type?: string;
  status?: string;
  summary?: string | null;
  metrics?: Record<string, unknown>;
  observed_at?: string | null;
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
