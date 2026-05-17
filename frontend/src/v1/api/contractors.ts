/**
 * platform-v1 contractor companies and users client.
 * Backend: backend/src/v1/routes/contractors.js (mounted at /api/v1 root)
 */

import { v1Client, type RequestOpts } from './client';
import { apiV1Url } from '../../config/apiBaseUrl';
import type {
  ContractorCompany,
  ContractorCompanyStatus,
  ContractorUser,
  PageMeta,
  PaginationParams,
  UUID,
} from './types';

export interface ListContractorCompaniesParams extends PaginationParams {
  status?: ContractorCompanyStatus;
  q?: string;
}

export interface ListContractorUsersParams extends PaginationParams {
  contractor_company_id?: UUID;
  is_active?: boolean;
}

export interface CreateContractorCompanyBody {
  property_id: UUID;
  name: string;
  contact_name?: string | null;
  contact_phone?: string | null;
  contact_email?: string | null;
}

export interface UpdateContractorCompanyBody {
  name?: string;
  status?: ContractorCompanyStatus;
  contact_name?: string | null;
  contact_phone?: string | null;
  contact_email?: string | null;
}

export interface CreateContractorUserBody {
  contractor_company_id: UUID;
  property_id: UUID;
  full_name: string;
  phone?: string | null;
  email?: string | null;
  specialization?: string | null;
  external_uid?: string | null;
  access_expires_at?: string | null;
}

export interface UpdateContractorUserBody {
  full_name?: string;
  phone?: string | null;
  email?: string | null;
  specialization?: string | null;
  external_uid?: string | null;
  access_expires_at?: string | null;
}

export interface ContractorImportRowInput {
  company_name?: string;
  company?: string;
  company_contact_name?: string | null;
  contact_name?: string | null;
  company_contact_phone?: string | null;
  contact_phone?: string | null;
  company_contact_email?: string | null;
  contact_email?: string | null;
  user_full_name?: string;
  full_name?: string;
  user_phone?: string | null;
  phone?: string | null;
  user_email?: string | null;
  email?: string | null;
  specialization?: string | null;
  external_uid?: string | null;
  externalUid?: string | null;
  access_expires_at?: string | null;
  accessExpiresAt?: string | null;
}

export interface ContractorImportPayload {
  property_id: UUID;
  csv?: string;
  rows?: ContractorImportRowInput[];
}

export type ContractorImportAction =
  | 'ready'
  | 'invalid'
  | 'created'
  | 'skipped_existing'
  | 'company_created'
  | 'company_existing'
  | 'skipped_inactive_company';

export interface ContractorImportCounts {
  contractor_companies: number;
  contractor_users: number;
}

export interface ContractorImportPreviewRow {
  row_number: number;
  action: ContractorImportAction;
  errors: string[];
  company: Omit<CreateContractorCompanyBody, 'property_id'> | ContractorCompany | null;
  contractor_user?: Omit<CreateContractorUserBody, 'property_id' | 'contractor_company_id'> | ContractorUser | null;
  existing_id?: UUID;
}

export interface ContractorImportChecklist {
  resource: 'contractors';
  validation_ready: boolean;
  launch_ready: boolean;
  valid_count: number;
  invalid_count: number;
  imported?: ContractorImportCounts | null;
  skipped?: ContractorImportCounts | null;
}

export interface ContractorImportPreviewResponse {
  mode: 'preview';
  resource: 'contractors';
  valid_count: number;
  invalid_count: number;
  rows: ContractorImportPreviewRow[];
  checklist: ContractorImportChecklist;
}

export interface ContractorImportApplyResponse {
  mode: 'apply';
  resource: 'contractors';
  imported: ContractorImportCounts;
  skipped: ContractorImportCounts;
  rows: ContractorImportPreviewRow[];
  checklist: ContractorImportChecklist;
}

function toQuery(params: object | undefined): string {
  if (!params) return '';
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== null && v !== '',
  );
  if (!entries.length) return '';
  const qs = new URLSearchParams();
  for (const [k, v] of entries) qs.set(k, String(v));
  return `?${qs.toString()}`;
}

export const contractorsApi = {
  listCompanies(params?: ListContractorCompaniesParams, opts?: RequestOpts) {
    return v1Client.get<{ companies: ContractorCompany[]; page?: PageMeta }>(
      `/contractor-companies${toQuery(params)}`,
      opts,
    );
  },
  getCompanyById(id: UUID, opts?: RequestOpts) {
    return v1Client.get<{ company: ContractorCompany; users: ContractorUser[] }>(
      `/contractor-companies/${encodeURIComponent(id)}`,
      opts,
    );
  },
  createCompany(body: CreateContractorCompanyBody, opts?: RequestOpts) {
    return v1Client.post<{ company: ContractorCompany }>(
      '/contractor-companies',
      body,
      opts,
    );
  },
  updateCompany(id: UUID, body: UpdateContractorCompanyBody, opts?: RequestOpts) {
    return v1Client.patch<{ company: ContractorCompany }>(
      `/contractor-companies/${encodeURIComponent(id)}`,
      body,
      opts,
    );
  },
  listUsers(params?: ListContractorUsersParams, opts?: RequestOpts) {
    return v1Client.get<{ users: ContractorUser[]; page?: PageMeta }>(
      `/contractor-users${toQuery(params)}`,
      opts,
    );
  },
  createUser(body: CreateContractorUserBody, opts?: RequestOpts) {
    return v1Client.post<{ user: ContractorUser }>('/contractor-users', body, opts);
  },
  updateUser(id: UUID, body: UpdateContractorUserBody, opts?: RequestOpts) {
    return v1Client.patch<{ user: ContractorUser }>(
      `/contractor-users/${encodeURIComponent(id)}`,
      body,
      opts,
    );
  },
  deactivateUser(id: UUID, opts?: RequestOpts) {
    return v1Client.post<void>(
      `/contractor-users/${encodeURIComponent(id)}/deactivate`,
      undefined,
      opts,
    );
  },
  importTemplateUrl() {
    return apiV1Url('/contractors/import/template');
  },
  previewImport(body: ContractorImportPayload, opts?: RequestOpts) {
    return v1Client.post<ContractorImportPreviewResponse>(
      '/contractors/import/preview',
      body,
      opts,
    );
  },
  applyImport(body: ContractorImportPayload, opts?: RequestOpts) {
    return v1Client.post<ContractorImportApplyResponse>(
      '/contractors/import/apply',
      body,
      opts,
    );
  },
};
