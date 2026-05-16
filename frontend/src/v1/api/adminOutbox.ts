/**
 * platform-v1 per-property outbox observability client.
 * Backend: backend/src/v1/routes/adminOutbox.js
 */

import { v1Client, type RequestOpts } from './client';
import type {
  AdminOutboxListResponse,
  AdminOutboxMetrics,
  AdminOutboxRow,
  NotificationChannel,
  OutboxStatus,
  UUID,
} from './types';

export interface ListAdminOutboxParams {
  status?: OutboxStatus;
  channel?: NotificationChannel;
  from?: string;
  to?: string;
  q?: string;
  limit?: number;
  offset?: number;
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

export const adminOutboxApi = {
  list(params?: ListAdminOutboxParams, opts?: RequestOpts) {
    return v1Client.get<AdminOutboxListResponse>(`/admin/outbox${toQuery(params)}`, opts);
  },

  metrics(opts?: RequestOpts) {
    return v1Client.get<AdminOutboxMetrics>('/admin/outbox/metrics', opts);
  },

  getById(id: UUID, opts?: RequestOpts) {
    return v1Client.get<{ ok: true; item: AdminOutboxRow }>(
      `/admin/outbox/${id}`,
      opts,
    );
  },

  requeue(id: UUID, opts?: RequestOpts) {
    return v1Client.post<{ ok: true; id: UUID; previous_status: OutboxStatus }>(
      `/admin/outbox/${id}/requeue`,
      undefined,
      opts,
    );
  },

  cancel(id: UUID, opts?: RequestOpts) {
    return v1Client.post<{ ok: true; item: AdminOutboxRow }>(
      `/admin/outbox/${id}/cancel`,
      undefined,
      opts,
    );
  },
};
