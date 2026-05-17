/**
 * platform-v1 GIS/OSS readiness client.
 * Backend: backend/src/v1/routes/gisOssReadiness.js
 * Spec:    docs/product/specs/platform-v1/gis-oss-readiness-spec.md
 */

import { v1Client, type RequestOpts } from './client';
import type {
  GisOssBoundaryResponse,
  GisOssExportPackage,
  GisOssOperationalRef,
  GisOssPackageType,
  GisOssProtocolFile,
  UUID,
} from './types';

export interface ListGisOssExportPackagesParams {
  property_id?: UUID;
  propertyId?: UUID;
  package_type?: GisOssPackageType | '';
  limit?: number;
}

export interface CreateGisOssExportPackageBody {
  property_id?: UUID;
  propertyId?: UUID;
  package_type?: GisOssPackageType;
  packageType?: GisOssPackageType;
  title: string;
  period_start?: string | null;
  periodStart?: string | null;
  period_end?: string | null;
  periodEnd?: string | null;
  document_ids?: UUID[];
  documentIds?: UUID[];
  announcement_ids?: UUID[];
  announcementIds?: UUID[];
  protocol_files?: GisOssProtocolFile[];
  protocolFiles?: GisOssProtocolFile[];
  operational_record_refs?: GisOssOperationalRef[];
  operationalRecordRefs?: GisOssOperationalRef[];
}

function toQuery(params: object | undefined): string {
  if (!params) return '';
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== null && v !== '',
  );
  if (!entries.length) return '';
  const qs = new URLSearchParams();
  for (const [key, value] of entries) qs.set(key, String(value));
  return `?${qs.toString()}`;
}

export const gisOssReadinessApi = {
  getBoundary(opts?: RequestOpts) {
    return v1Client.get<GisOssBoundaryResponse>('/gis-oss/boundary', opts);
  },

  listExportPackages(params: ListGisOssExportPackagesParams, opts?: RequestOpts) {
    return v1Client.get<{
      export_packages: GisOssExportPackage[];
      boundary_notice: string;
    }>(`/gis-oss/export-packages${toQuery(params)}`, opts);
  },

  createExportPackage(body: CreateGisOssExportPackageBody, opts?: RequestOpts) {
    return v1Client.post<{
      export_package: GisOssExportPackage;
      payload: unknown;
      boundary_notice: string;
    }>('/gis-oss/export-packages', body, opts);
  },

  getExportPackage(propertyId: UUID, packageId: UUID, opts?: RequestOpts) {
    return v1Client.get<{
      export_package: GisOssExportPackage;
      payload: unknown;
      boundary_notice: string;
    }>(`/gis-oss/export-packages/${packageId}${toQuery({ property_id: propertyId })}`, opts);
  },
};

export type { GisOssPackageType };
