/**
 * platform-v1 SKUD integration client.
 * Backend: backend/src/v1/routes/skudIntegrations.js
 */

import { v1Client, type RequestOpts } from './client';
import type { components } from '../../api/generated/openapi';
import type {
  SkudProviderFailureDashboardResponse,
  UUID,
} from './types';

type Schemas = components['schemas'];

export interface GetSkudProviderFailuresParams {
  property_id?: UUID;
  propertyId?: UUID;
  window_hours?: number;
  windowHours?: number;
  limit?: number;
}

export type SkudHardwareBoundaryBody = Schemas['SkudHardwareBoundaryRequest'];
export type SkudManualControlBody = Schemas['SkudManualControlRequest'];
export type SkudSyncPassBody = Schemas['SkudSyncPassRequest'];
type SkudFieldRolloutEvidenceGeneratedBody = Schemas['SkudFieldRolloutEvidenceRequest'];
export type SkudHardwareDeviceResponse = Schemas['SkudHardwareDeviceResponse'];
export type SkudHardwareDeviceListResponse = Schemas['SkudHardwareDeviceListResponse'];
export type SkudManualControlResponse = Schemas['SkudManualControlResponse'];
export type SkudManualControlEventListResponse = Schemas['SkudManualControlEventListResponse'];
export type SkudSyncPassResponse = Schemas['SkudSyncPassResponse'];
export type SkudFieldRolloutEvidenceResponse = Schemas['SkudFieldRolloutEvidenceResponse'];
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

type SkudFieldRolloutEvidenceTypeInput =
  | { evidence_type: SkudFieldRolloutEvidenceType; evidenceType?: SkudFieldRolloutEvidenceType }
  | { evidence_type?: SkudFieldRolloutEvidenceType; evidenceType: SkudFieldRolloutEvidenceType };

export type SkudFieldRolloutEvidenceBody =
  SkudFieldRolloutEvidenceGeneratedBody & SkudFieldRolloutEvidenceTypeInput;

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
    return v1Client.get<SkudHardwareDeviceListResponse>(
      `/skud/hardware-devices${toQuery(params)}`,
      opts,
    );
  },
  updateHardwareBoundary(hardwareDeviceId: UUID, body: SkudHardwareBoundaryBody, opts?: RequestOpts) {
    return v1Client.patch<SkudHardwareDeviceResponse>(
      `/skud/hardware-devices/${encodeURIComponent(hardwareDeviceId)}/boundary`,
      body,
      opts,
    );
  },
  manualControl(hardwareDeviceId: UUID, body: SkudManualControlBody, opts?: RequestOpts) {
    return v1Client.post<SkudManualControlResponse>(
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
    return v1Client.get<SkudManualControlEventListResponse>(
      `/skud/hardware-devices/${encodeURIComponent(hardwareDeviceId)}/manual-control-events${toQuery(params)}`,
      opts,
    );
  },
  recordFieldRolloutEvidence(body: SkudFieldRolloutEvidenceBody, opts?: RequestOpts) {
    return v1Client.post<SkudFieldRolloutEvidenceResponse>(
      '/skud/field-rollout-evidence',
      body,
      opts,
    );
  },
  syncPass(providerConfigId: UUID, body: SkudSyncPassBody, opts?: RequestOpts) {
    return v1Client.post<SkudSyncPassResponse>(
      `/skud/providers/${encodeURIComponent(providerConfigId)}/sync-pass`,
      body,
      opts,
    );
  },
};
