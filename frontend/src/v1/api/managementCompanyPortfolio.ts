import { v1Client, type RequestOpts } from './client';
import type {
  ManagementCompanyPortfolioResponse,
  OperationsDashboardPeriod,
} from './types';

export interface GetManagementCompanyPortfolioParams {
  period?: OperationsDashboardPeriod;
  propertySlugs?: string[];
  includeInactive?: boolean;
}

function toQuery(params?: GetManagementCompanyPortfolioParams): string {
  const qs = new URLSearchParams();
  if (params?.period) qs.set('period', params.period);
  const propertySlugs = params?.propertySlugs?.filter(Boolean) ?? [];
  if (propertySlugs.length) qs.set('property_slug', propertySlugs.join(','));
  if (params?.includeInactive) qs.set('include_inactive', 'true');
  const query = qs.toString();
  return query ? `?${query}` : '';
}

export const managementCompanyPortfolioApi = {
  get(params?: GetManagementCompanyPortfolioParams, opts?: RequestOpts) {
    return v1Client.get<ManagementCompanyPortfolioResponse>(
      `/management-company/portfolio${toQuery(params)}`,
      opts,
    );
  },
};
