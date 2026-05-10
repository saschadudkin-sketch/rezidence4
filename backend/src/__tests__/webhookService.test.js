'use strict';

const { describe, test, expect } = require('@jest/globals');
const {
  buildWebhookEnvelope,
  WEBHOOK_PAYLOAD_VERSION,
} = require('../services/webhookService');

describe('legacy webhookService outbound envelope', () => {
  test('uses webhook_deliveries.id as stable delivery/idempotency key', () => {
    const envelope = buildWebhookEnvelope({
      id: 'delivery-1',
      event_type: 'request.resolved',
      attempt_count: 2,
      payload: { requestId: 'req-1', correlationId: 'req-1' },
    });

    expect(envelope).toEqual(expect.objectContaining({
      version: WEBHOOK_PAYLOAD_VERSION,
      event: 'request.resolved',
      eventId: 'delivery-1',
      deliveryId: 'delivery-1',
      correlationId: 'req-1',
      attempt: 3,
      data: { requestId: 'req-1', correlationId: 'req-1' },
    }));
    expect(new Date(envelope.timestamp).toString()).not.toBe('Invalid Date');
  });
});
