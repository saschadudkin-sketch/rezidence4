/**
 * platform-v1 webhook management client.
 * Backend: backend/src/routes/webhooks.js mounted at /api/v1/webhooks.
 */

import { v1Client, type RequestOpts } from './client';
import type { components } from '../../api/generated/openapi';
import type { UUID } from './types';

type Schemas = components['schemas'];

export type Webhook = Schemas['Webhook'];
export type CreateWebhookBody = Schemas['CreateWebhookRequest'];
export type UpdateWebhookBody = Schemas['UpdateWebhookRequest'];
export type WebhookDelivery = Schemas['WebhookDelivery'];
export type WebhookDeliveryStatus = 'pending' | 'retrying' | 'success' | 'failed';
export type WebhookResponse = Schemas['WebhookResponse'];
export type WebhookListResponse = Schemas['WebhookListResponse'];
export type WebhookDeactivateResponse = Schemas['WebhookDeactivateResponse'];
export type WebhookTestDeliveryResponse = Schemas['WebhookTestDeliveryResponse'];
export type WebhookDeliveryListResponse = Schemas['WebhookDeliveryListResponse'];

export const webhooksApi = {
  list(opts?: RequestOpts) {
    return v1Client.get<WebhookListResponse>('/webhooks', opts);
  },

  create(body: CreateWebhookBody, opts?: RequestOpts) {
    return v1Client.post<WebhookResponse>('/webhooks', body, opts);
  },

  update(id: UUID, body: UpdateWebhookBody, opts?: RequestOpts) {
    return v1Client.patch<WebhookResponse>(
      `/webhooks/${encodeURIComponent(id)}`,
      body,
      opts,
    );
  },

  deactivate(id: UUID, opts?: RequestOpts) {
    return v1Client.delete<WebhookDeactivateResponse>(`/webhooks/${encodeURIComponent(id)}`, opts);
  },

  testDelivery(id: UUID, opts?: RequestOpts) {
    return v1Client.post<WebhookTestDeliveryResponse>(
      `/webhooks/${encodeURIComponent(id)}/test`,
      undefined,
      opts,
    );
  },

  listDeliveries(id: UUID, opts?: RequestOpts) {
    return v1Client.get<WebhookDeliveryListResponse>(
      `/webhooks/${encodeURIComponent(id)}/deliveries`,
      opts,
    );
  },
};
