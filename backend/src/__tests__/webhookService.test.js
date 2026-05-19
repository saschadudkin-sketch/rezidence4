'use strict';

const { describe, test, expect } = require('@jest/globals');
const {
  buildWebhookEnvelope,
  deliverOne,
  processPendingDeliveries,
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

describe('legacy webhookService delivery runtime', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  test('processPendingDeliveries atomically claims due rows before delivery', async () => {
    const db = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
    };

    await processPendingDeliveries(db);

    const [sql] = db.query.mock.calls[0];
    expect(sql).toMatch(/WITH candidate AS/i);
    expect(sql).toMatch(/FOR UPDATE SKIP LOCKED/i);
    expect(sql).toMatch(/UPDATE webhook_deliveries d/i);
    expect(sql).toMatch(/SET status = 'retrying'/i);
    expect(sql).toMatch(/RETURNING d\.\*, w\.url, w\.secret, w\.name, w\.is_active/i);
  });

  test('deliverOne stops queued deliveries for inactive webhooks before fetch', async () => {
    const db = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
    };

    await deliverOne({
      id: 'delivery-1',
      webhook_id: 'wh-1',
      event_type: 'request.approved',
      attempt_count: 0,
      payload: { requestId: 'req-1' },
      url: 'https://partner.example/hook',
      secret: 'secret',
      is_active: false,
    }, db);

    expect(global.fetch).not.toHaveBeenCalled();
    const deliveryUpdate = db.query.mock.calls.find(([sql]) => /UPDATE webhook_deliveries/i.test(sql));
    const webhookUpdate = db.query.mock.calls.find(([sql]) => /UPDATE webhooks/i.test(sql));
    expect(deliveryUpdate[0]).toMatch(/status = 'failed'/);
    expect(deliveryUpdate[1]).toEqual([
      null,
      'webhook_inactive',
      'delivery-1',
    ]);
    expect(webhookUpdate[1]).toEqual([
      'webhook_inactive',
      'wh-1',
    ]);
  });

  test('deliverOne blocks unsafe stored URLs before fetch and marks failed', async () => {
    const db = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
    };

    await deliverOne({
      id: 'delivery-1',
      webhook_id: 'wh-1',
      event_type: 'request.approved',
      attempt_count: 0,
      payload: { requestId: 'req-1' },
      url: 'https://169.254.169.254/latest/meta-data',
      secret: 'secret',
    }, db);

    expect(global.fetch).not.toHaveBeenCalled();
    const deliveryUpdate = db.query.mock.calls.find(([sql]) => /UPDATE webhook_deliveries/i.test(sql));
    const webhookUpdate = db.query.mock.calls.find(([sql]) => /UPDATE webhooks/i.test(sql));
    expect(deliveryUpdate[0]).toMatch(/status = 'failed'/);
    expect(deliveryUpdate[1]).toEqual([
      null,
      expect.stringMatching(/^ssrf_blocked:forbidden_host/),
      'delivery-1',
    ]);
    expect(webhookUpdate[1]).toEqual([
      expect.stringMatching(/^ssrf_blocked:forbidden_host/),
      'wh-1',
    ]);
  });

  test('deliverOne stores HTTP non-2xx response evidence on retry', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'service unavailable',
    });
    const db = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
    };

    await deliverOne({
      id: 'delivery-1',
      webhook_id: 'wh-1',
      event_type: 'request.approved',
      attempt_count: 0,
      payload: { requestId: 'req-1' },
      url: 'https://partner.example/hook',
      secret: 'secret',
    }, db);

    const retryUpdate = db.query.mock.calls.find(([sql]) => /status = 'retrying'/i.test(sql));
    expect(retryUpdate[1]).toEqual([
      '60',
      503,
      'HTTP 503: service unavailable',
      'delivery-1',
    ]);
  });
});
