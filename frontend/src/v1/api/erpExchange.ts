/**
 * platform-v1 ERP/1C exchange client.
 * Backend: backend/src/v1/routes/erpExchange.js
 * Spec:    docs/product/specs/domhub-erp-1c-integration-spec.md
 */

import { v1Client, type RequestOpts } from './client';
import type { IsoDateTime, UUID } from './types';

export type ErpProvider =
  | 'one_c'
  | 'one_c_zhkh'
  | 'housing_erp'
  | 'generic_csv'
  | 'generic_rest'
  | 'generic_webhook';
export type ErpProviderInput =
  | ErpProvider
  | '1c'
  | '1c_zhkh'
  | '1c:zhkh'
  | '1c_uk'
  | 'csv'
  | 'rest'
  | 'webhook';

export type ErpProviderStatus = 'active' | 'disabled' | 'degraded';
export type ErpHealthStatus = 'unknown' | 'healthy' | 'degraded' | 'down';
export type ErpSyncMode = 'import_only' | 'export_only' | 'hybrid' | 'manual';
export type ErpSyncSource = 'csv' | 'rest' | 'webhook' | 'manual';
export type ErpImportDataset =
  | 'property_structure'
  | 'resident_registry'
  | 'staff_registry'
  | 'contractor_registry'
  | 'vehicle_registry';
export type ErpExportDataset = 'access_events_summary' | 'incident_summary' | 'request_summary';
export type ErpSyncDirection = 'import' | 'export';
export type ErpSyncJobMode = 'dry_run' | 'apply';
export type ErpSyncJobStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'dead_lettered';
export type ErpSyncRecordStatus = 'valid' | 'invalid' | 'conflict' | 'applied' | 'failed' | 'skipped';
export type ErpSyncRecordOperation =
  | 'preview_create'
  | 'preview_update'
  | 'preview_conflict'
  | 'preview_ignore'
  | 'applied_create'
  | 'applied_update'
  | 'failed'
  | 'skipped';

export interface ErpProviderConfig {
  id: UUID;
  property_id: UUID;
  provider: ErpProvider;
  display_name: string;
  status: ErpProviderStatus;
  sync_mode: ErpSyncMode;
  base_url: string | null;
  auth_ref: string | null;
  config_json: Record<string, unknown>;
  capabilities: string[];
  health_status: ErpHealthStatus;
  last_success_at?: IsoDateTime | null;
  last_failure_at?: IsoDateTime | null;
  last_error?: string | null;
  created_by: UUID | string | null;
  created_at?: IsoDateTime;
  updated_at?: IsoDateTime | null;
}

export interface ListErpProvidersParams {
  property_id?: UUID;
  propertyId?: UUID;
  status?: ErpProviderStatus;
}

export interface CreateErpProviderBody {
  property_id?: UUID;
  propertyId?: UUID;
  provider: ErpProviderInput;
  display_name?: string;
  displayName?: string;
  status?: ErpProviderStatus;
  sync_mode?: ErpSyncMode;
  syncMode?: ErpSyncMode;
  base_url?: string | null;
  baseUrl?: string | null;
  auth_ref?: string | null;
  authRef?: string | null;
  config_json?: Record<string, unknown>;
  configJson?: Record<string, unknown>;
  config?: Record<string, unknown>;
  capabilities?: string[];
  health_status?: ErpHealthStatus;
  healthStatus?: ErpHealthStatus;
}

export interface ErpSyncJob {
  id: UUID;
  property_id: UUID;
  provider_config_id: UUID;
  direction: ErpSyncDirection;
  dataset: ErpImportDataset | ErpExportDataset;
  source: ErpSyncSource;
  mode: ErpSyncJobMode;
  status: ErpSyncJobStatus;
  summary: Record<string, unknown>;
  error_message?: string | null;
  created_by: UUID | string | null;
  started_at?: IsoDateTime | null;
  completed_at?: IsoDateTime | null;
  created_at?: IsoDateTime;
  updated_at?: IsoDateTime | null;
}

export interface ErpSyncRecord {
  id?: UUID;
  property_id?: UUID;
  sync_job_id?: UUID;
  provider_config_id?: UUID;
  row_index: number;
  external_entity_type: string | null;
  external_id: string | null;
  operation: ErpSyncRecordOperation;
  status: ErpSyncRecordStatus;
  domhub_entity_type: string | null;
  domhub_entity_id: UUID | string | null;
  validation_errors: string[];
  payload: Record<string, unknown>;
  normalized_payload: Record<string, unknown>;
  created_at?: IsoDateTime;
}

export interface ErpImportSummary {
  total: number;
  valid: number;
  invalid: number;
  conflicts: number;
  creates: number;
  updates: number;
  applied: number;
  skipped: number;
  mode: ErpSyncJobMode;
  access_grants_created: 0;
  mapping_only: true;
}

export interface ErpExportSummary {
  dataset: ErpExportDataset;
  total: number;
  format: 'json';
  delivered: boolean;
  no_financial_payload: true;
  access_grants_created: 0;
}

export interface ErpImportBody {
  property_id?: UUID;
  propertyId?: UUID;
  dataset: ErpImportDataset;
  source?: ErpSyncSource;
  rows: Array<Record<string, unknown>>;
}

export interface ErpExportBody {
  property_id?: UUID;
  propertyId?: UUID;
  dataset: ErpExportDataset;
  source?: ErpSyncSource;
  from?: IsoDateTime;
  from_at?: IsoDateTime;
  fromAt?: IsoDateTime;
  to?: IsoDateTime;
  to_at?: IsoDateTime;
  toAt?: IsoDateTime;
  limit?: number;
}

export interface ErpImportResponse {
  provider_config: ErpProviderConfig;
  sync_job: ErpSyncJob;
  summary: ErpImportSummary;
  records: ErpSyncRecord[];
}

export interface ErpExportResponse {
  provider_config: ErpProviderConfig;
  sync_job: ErpSyncJob;
  summary: ErpExportSummary;
  records: Array<Record<string, unknown>>;
}

export interface ErpSyncJobResponse {
  sync_job: ErpSyncJob;
  records: ErpSyncRecord[];
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

export const erpExchangeApi = {
  listProviders(params?: ListErpProvidersParams, opts?: RequestOpts) {
    return v1Client.get<{ providers: ErpProviderConfig[] }>(
      `/erp/providers${toQuery(params)}`,
      opts,
    );
  },

  createProvider(body: CreateErpProviderBody, opts?: RequestOpts) {
    return v1Client.post<{ provider: ErpProviderConfig }>(
      '/erp/providers',
      body,
      opts,
    );
  },

  previewImport(providerConfigId: UUID, body: ErpImportBody, opts?: RequestOpts) {
    return v1Client.post<ErpImportResponse>(
      `/erp/providers/${encodeURIComponent(providerConfigId)}/import/preview`,
      body,
      opts,
    );
  },

  applyImport(providerConfigId: UUID, body: ErpImportBody, opts?: RequestOpts) {
    return v1Client.post<ErpImportResponse>(
      `/erp/providers/${encodeURIComponent(providerConfigId)}/import/apply`,
      body,
      opts,
    );
  },

  exportDataset(providerConfigId: UUID, body: ErpExportBody, opts?: RequestOpts) {
    return v1Client.post<ErpExportResponse>(
      `/erp/providers/${encodeURIComponent(providerConfigId)}/export`,
      body,
      opts,
    );
  },

  getSyncJob(syncJobId: UUID, params?: { property_id?: UUID; propertyId?: UUID }, opts?: RequestOpts) {
    return v1Client.get<ErpSyncJobResponse>(
      `/erp/sync-jobs/${encodeURIComponent(syncJobId)}${toQuery(params)}`,
      opts,
    );
  },
};
