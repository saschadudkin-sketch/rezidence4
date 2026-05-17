/**
 * platform-v1 webhook management client.
 * Backend: backend/src/routes/webhooks.js mounted at /api/v1/webhooks.
 */

import { v1Client, type RequestOpts } from './client';
import type { IsoDateTime, UUID } from './types';

export interface Webhook {
  id: UUID;
  name: string;
  url: string;
  events: string[];
  is_active: boolean;
  retry_count: number;
  last_attempt_at: IsoDateTime | null;
  last_success_at: IsoDateTime | null;
  last_error: string | null;
  created_by: UUID | string | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime | null;
}

export interface CreateWebhookBody {
  name: string;
  url: string;
  secret: string;
  events: string[];
}

export interface UpdateWebhookBody {
  name?: string;
  url?: string;
  secret?: string;
  events?: string[];
  is_active?: boolean;
}

export type WebhookDeliveryStatus = 'pending' | 'retrying' | 'success' | 'failed';

export interface WebhookDelivery {
  id: UUID;
  event_type: string;
  status: WebhookDeliveryStatus;
  attempt_count: number;
  next_attempt_at: IsoDateTime | null;
  response_status: number | null;
  response_body: string | null;
  error_message: string | null;
  created_at: IsoDateTime;
  completed_at: IsoDateTime | null;
}

export const webhooksApi = {
  list(opts?: RequestOpts) {
    return v1Client.get<{ webhooks: Webhook[] }>('/webhooks', opts);
  },

  create(body: CreateWebhookBody, opts?: RequestOpts) {
    return v1Client.post<{ webhook: Webhook }>('/webhooks', body, opts);
  },

  update(id: UUID, body: UpdateWebhookBody, opts?: RequestOpts) {
    return v1Client.patch<{ webhook: Webhook }>(
      `/webhooks/${encodeURIComponent(id)}`,
      body,
      opts,
    );
  },

  deactivate(id: UUID, opts?: RequestOpts) {
    return v1Client.delete<{ ok: true }>(`/webhooks/${encodeURIComponent(id)}`, opts);
  },

  testDelivery(id: UUID, opts?: RequestOpts) {
    return v1Client.post<{ deliveryId: UUID }>(
      `/webhooks/${encodeURIComponent(id)}/test`,
      undefined,
      opts,
    );
  },

  listDeliveries(id: UUID, opts?: RequestOpts) {
    return v1Client.get<{ deliveries: WebhookDelivery[] }>(
      `/webhooks/${encodeURIComponent(id)}/deliveries`,
      opts,
    );
  },
};
