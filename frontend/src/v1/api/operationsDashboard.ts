import { v1Client, type RequestOpts } from './client';
import type {
  OperationsDashboardPeriod,
  OperationsDashboardResponse,
  UUID,
} from './types';

export interface GetOperationsDashboardParams {
  period?: OperationsDashboardPeriod;
  property_id?: UUID;
  propertyId?: UUID;
}

function toQuery(params?: GetOperationsDashboardParams): string {
  if (!params) return '';
  const qs = new URLSearchParams();
  if (params.period) qs.set('period', params.period);
  const propertyId = params.property_id ?? params.propertyId;
  if (propertyId) qs.set('property_id', propertyId);
  const query = qs.toString();
  return query ? `?${query}` : '';
}

export const operationsDashboardApi = {
  get(params?: GetOperationsDashboardParams, opts?: RequestOpts) {
    return v1Client.get<OperationsDashboardResponse>(
      `/admin/operations-dashboard${toQuery(params)}`,
      opts,
    );
  },
};
