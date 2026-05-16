/**
 * platform-v1 contractor companies and users client.
 * Backend: backend/src/v1/routes/contractors.js (mounted at /api/v1 root)
 */

import { v1Client, type RequestOpts } from './client';
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
      `/contractor-companies/${id}`,
      opts,
    );
  },
  listUsers(params?: ListContractorUsersParams, opts?: RequestOpts) {
    return v1Client.get<{ users: ContractorUser[]; page?: PageMeta }>(
      `/contractor-users${toQuery(params)}`,
      opts,
    );
  },
};
