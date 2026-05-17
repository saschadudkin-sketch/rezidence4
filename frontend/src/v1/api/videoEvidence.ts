/**
 * platform-v1 video provider and evidence client.
 * Backend: backend/src/v1/routes/videoEvidence.js (mounted at /api/v1 root)
 */

import { v1Client, type RequestOpts } from './client';
import type { IsoDateTime, UUID } from './types';

export type VideoProviderStatus = 'active' | 'inactive' | 'degraded' | 'down' | string;
export type VideoEvidenceType = 'clip' | 'snapshot' | 'event_reference' | 'camera_context' | 'unavailable';
export type VideoEvidenceSource = 'manual' | 'provider' | 'skud' | 'incident' | string;
export type VideoEvidenceStatus = 'linked' | 'unavailable' | 'pending' | 'failed' | string;
export type VideoEvidenceSensitivity = 'public' | 'internal' | 'restricted' | 'sensitive' | string;

export interface ListVideoProviderParams {
  property_id: UUID;
  status?: VideoProviderStatus;
}

export interface CreateVideoProviderBody {
  property_id: UUID;
  provider: string;
  display_name: string;
  status?: VideoProviderStatus;
  base_url?: string | null;
  auth_ref?: string | null;
  config_json?: Record<string, unknown>;
  capabilities?: string[];
}

export interface VideoProviderConfig {
  id: UUID;
  property_id: UUID;
  provider: string;
  display_name: string;
  status: VideoProviderStatus;
  base_url: string | null;
  auth_ref: string | null;
  config_json: Record<string, unknown>;
  capabilities: string[];
  created_by: UUID | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime | null;
  health_status?: string | null;
}

export interface ListVideoEvidenceCamerasParams {
  property_id: UUID;
  access_point_id?: UUID | null;
}

export interface VideoEvidenceCamera {
  id: UUID;
  property_id: UUID;
  access_point_id: UUID | null;
  provider_config_id: UUID | null;
  video_provider_config_id: UUID | null;
  name: string;
  status: string;
  metadata: Record<string, unknown> | null;
  video_provider?: string | null;
  video_provider_display_name?: string | null;
  video_provider_health_status?: string | null;
}

export interface LinkCameraVideoProviderBody {
  property_id: UUID;
  video_provider_config_id: UUID;
  camera_external_id?: string | null;
  provider_camera_id?: string | null;
  channel?: string | null;
  stream?: string | null;
  image_uri?: string | null;
  video_uri?: string | null;
  streaming_uri?: string | null;
}

export interface VideoEvidenceReference {
  id: UUID;
  property_id: UUID;
  access_incident_id: UUID | null;
  visit_log_id: UUID | null;
  skud_integration_event_id: UUID | null;
  camera_device_id: UUID | null;
  provider_config_id: UUID | null;
  video_provider_config_id: UUID | null;
  evidence_type: VideoEvidenceType;
  source: VideoEvidenceSource;
  status: VideoEvidenceStatus;
  title: string | null;
  clip_url: string | null;
  snapshot_url: string | null;
  external_ref: string | null;
  video_provider_event_id: string | null;
  video_timestamp_from: IsoDateTime | null;
  video_timestamp_to: IsoDateTime | null;
  sensitivity: VideoEvidenceSensitivity;
  metadata: Record<string, unknown> | null;
  created_by_staff_id: UUID | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime | null;
}

interface CreateVideoEvidenceBaseBody {
  property_id: UUID;
  camera_device_id?: UUID | null;
  provider_config_id?: UUID | null;
  video_provider_config_id?: UUID | null;
  evidence_type?: VideoEvidenceType;
  source?: VideoEvidenceSource;
  status?: VideoEvidenceStatus;
  title?: string | null;
  clip_url?: string | null;
  snapshot_url?: string | null;
  external_ref?: string | null;
  video_provider_event_id?: string | null;
  video_timestamp_from?: IsoDateTime | null;
  video_timestamp_to?: IsoDateTime | null;
  sensitivity?: VideoEvidenceSensitivity;
  metadata?: Record<string, unknown>;
}

export type VideoEvidenceAnchor =
  | {
    access_incident_id: UUID;
    visit_log_id?: UUID | null;
    skud_integration_event_id?: UUID | null;
  }
  | {
    access_incident_id?: UUID | null;
    visit_log_id: UUID;
    skud_integration_event_id?: UUID | null;
  }
  | {
    access_incident_id?: UUID | null;
    visit_log_id?: UUID | null;
    skud_integration_event_id: UUID;
  };

export type CreateVideoEvidenceBody = CreateVideoEvidenceBaseBody & VideoEvidenceAnchor;

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

export const videoEvidenceApi = {
  listProviders(params: ListVideoProviderParams, opts?: RequestOpts) {
    return v1Client.get<{ providers: VideoProviderConfig[] }>(
      `/video/providers${toQuery(params)}`,
      opts,
    );
  },
  createProvider(body: CreateVideoProviderBody, opts?: RequestOpts) {
    return v1Client.post<{ provider: VideoProviderConfig }>(
      '/video/providers',
      body,
      opts,
    );
  },
  linkCameraProvider(cameraDeviceId: UUID, body: LinkCameraVideoProviderBody, opts?: RequestOpts) {
    return v1Client.patch<{ camera: VideoEvidenceCamera; video_provider_config: VideoProviderConfig | null }>(
      `/video/cameras/${encodeURIComponent(cameraDeviceId)}/provider`,
      body,
      opts,
    );
  },
  listCameras(params: ListVideoEvidenceCamerasParams, opts?: RequestOpts) {
    return v1Client.get<{ cameras: VideoEvidenceCamera[] }>(
      `/video-evidence/cameras${toQuery(params)}`,
      opts,
    );
  },
  create(body: CreateVideoEvidenceBody, opts?: RequestOpts) {
    return v1Client.post<{ evidence: VideoEvidenceReference }>(
      '/video-evidence',
      body,
      opts,
    );
  },
  getById(id: UUID, params: { property_id: UUID }, opts?: RequestOpts) {
    return v1Client.get<{ evidence: VideoEvidenceReference }>(
      `/video-evidence/${encodeURIComponent(id)}${toQuery(params)}`,
      opts,
    );
  },
};
