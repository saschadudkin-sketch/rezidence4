/**
 * platform-v1 ERP/1C exchange client.
 * Backend: backend/src/v1/routes/erpExchange.js
 * Spec:    docs/product/specs/domhub-erp-1c-integration-spec.md
 */

import { v1Client, type RequestOpts } from './client';
import type { components } from '../../api/generated/openapi';
import type { UUID } from './types';

type Schemas = components['schemas'];

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
export type ErpProviderConfig = Schemas['ErpProviderConfig'];
export type CreateErpProviderBody = Schemas['CreateErpProviderRequest'];
export type ErpProviderStatus = 'active' | 'disabled' | 'degraded';
export type ErpHealthStatus = 'unknown' | 'healthy' | 'degraded' | 'down';
export type ErpSyncMode = 'import_only' | 'export_only' | 'hybrid' | 'manual';
export type ErpSyncJob = Schemas['ErpSyncJob'];
export type ErpSyncSource = 'csv' | 'rest' | 'webhook' | 'manual';
export type ErpImportDataset =
  | 'property_structure'
  | 'resident_registry'
  | 'staff_registry'
  | 'contractor_registry'
  | 'vehicle_registry';
export type ErpExportDataset = 'access_events_summary' | 'incident_summary' | 'request_summary';
export type ErpSyncDirection = ErpSyncJob['direction'];
export type ErpSyncJobMode = ErpSyncJob['mode'];
export type ErpSyncJobStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'dead_lettered';
export type ErpSyncRecord = Schemas['ErpSyncRecord'];
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
export type ErpImportSummary = Schemas['ErpImportSummary'];
export type ErpExportSummary = Schemas['ErpExportSummary'];
export type ErpImportBody = Schemas['ErpImportRequest'];
export type ErpExportBody = Schemas['ErpExportRequest'];
export type ErpImportResponse = Schemas['ErpImportResponse'];
export type ErpExportResponse = Schemas['ErpExportResponse'];
export type ErpSyncJobResponse = Schemas['ErpSyncJobResponse'];

export interface ListErpProvidersParams {
  property_id?: UUID;
  propertyId?: UUID;
  status?: ErpProviderStatus;
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
    return v1Client.get<Schemas['ErpProviderListResponse']>(
      `/erp/providers${toQuery(params)}`,
      opts,
    );
  },

  createProvider(body: CreateErpProviderBody, opts?: RequestOpts) {
    return v1Client.post<Schemas['ErpProviderResponse']>(
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
