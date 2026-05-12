/**
 * platform-v1 SKUD integration client.
 * Backend: backend/src/v1/routes/skudIntegrations.js
 */

import { v1Client, type RequestOpts } from './client';
import type {
  SkudProviderFailureDashboardResponse,
  UUID,
} from './types';

export interface GetSkudProviderFailuresParams {
  property_id?: UUID;
  window_hours?: number;
  limit?: number;
}

function toQuery(params?: GetSkudProviderFailuresParams): string {
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
};
