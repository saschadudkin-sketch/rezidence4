/**
 * platform-v1 notification_log_v2 read client.
 * Backend: backend/src/v1/routes/notificationLog.js
 */

import { v1Client, type RequestOpts } from './client';
import type {
  NotificationChannel,
  NotificationLogListResponse,
  NotificationLogMetaResponse,
  NotificationLogMetrics,
  NotificationLogRow,
  NotificationLogStatus,
  NotificationRecipientType,
  UUID,
} from './types';

export type NotificationLogPeriod = '24h' | '7d' | '30d';

export interface ListNotificationLogParams {
  recipient_type?: NotificationRecipientType;
  recipient_id?: UUID;
  channel?: NotificationChannel;
  event_type?: string;
  status?: NotificationLogStatus;
  since?: string;
  until?: string;
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

export const notificationLogApi = {
  list(params: ListNotificationLogParams, opts?: RequestOpts) {
    return v1Client.get<NotificationLogListResponse>(
      `/admin/notification-log${toQuery(params)}`,
      opts,
    );
  },

  metrics(period: NotificationLogPeriod = '24h', opts?: RequestOpts) {
    return v1Client.get<NotificationLogMetrics>(
      `/admin/notification-log/metrics${toQuery({ period })}`,
      opts,
    );
  },

  meta(opts?: RequestOpts) {
    return v1Client.get<NotificationLogMetaResponse>('/notification-log/_meta', opts);
  },

  getById(id: UUID, opts?: RequestOpts) {
    return v1Client.get<{ ok: true; item: NotificationLogRow }>(
      `/admin/notification-log/${encodeURIComponent(id)}`,
      opts,
    );
  },

  mine(limit?: number, opts?: RequestOpts) {
    return v1Client.get<NotificationLogListResponse>(
      `/notification-log/mine${toQuery({ limit })}`,
      opts,
    );
  },
};
