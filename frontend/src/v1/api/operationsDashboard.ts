import { v1Client, type RequestOpts } from './client';
import type {
  OperationsDashboardPeriod,
  OperationsDashboardResponse,
} from './types';

export interface GetOperationsDashboardParams {
  period?: OperationsDashboardPeriod;
}

function toQuery(params?: GetOperationsDashboardParams): string {
  if (!params?.period) return '';
  return `?period=${encodeURIComponent(params.period)}`;
}

export const operationsDashboardApi = {
  get(params?: GetOperationsDashboardParams, opts?: RequestOpts) {
    return v1Client.get<OperationsDashboardResponse>(
      `/admin/operations-dashboard${toQuery(params)}`,
      opts,
    );
  },
};
