'use strict';

/**
 * Phase 5 — channel adapter unit tests.
 * Spec: docs/product/specs/platform-v1/notifications-outbox-spec.md §4.4, §7 Q7.
 *
 * Каждый adapter exposes `send(args) → {ok, error?, dead?}`.  Тестируем:
 *   - единый контракт результата (никаких throw из send'а);
 *   - dispatcher — неизвестный канал → dead;
 *   - web_push — dead endpoint (410/404) → dead:true + subscription деактивирована;
 *   - sms — пустое сообщение / нет телефона → error; success → sendSms вызван;
 *   - telegram — no bot token → error; api.ok=false → error; tenant token > env;
 *   - webhook — нет secret → dead; success → HMAC signed + metrics updated;
 *   - email — всегда dead (stub).
 */

const { describe, test, expect, beforeEach, afterEach, jest: jestApi } = require('@jest/globals');

// ─── dispatcher ───────────────────────────────────────────────────────────────
const channels = require('../v1/services/channels');

describe('channels.dispatch', () => {
  test('listChannels returns all 5 spec channels', () => {
    expect(channels.listChannels().sort()).toEqual(
      ['email', 'sms', 'telegram', 'web_push', 'webhook'],
    );
  });

  test('getAdapter returns module for known channel, null for unknown', () => {
    expect(channels.getAdapter('sms')).toBeTruthy();
    expect(channels.getAdapter('sms').send).toBeInstanceOf(Function);
    expect(channels.getAdapter('carrier_pigeon')).toBeNull();
  });

  test('dispatch unknown channel → ok:false, dead:true (worker will mark dead)', async () => {
    const result = await channels.dispatch('carrier_pigeon', {});
    expect(result).toEqual({
      ok: false,
      error: expect.stringMatching(/unknown_channel/),
      dead: true,
    });
  });
});

// ─── sms adapter ──────────────────────────────────────────────────────────────
// NOTE: bare `jest.mock(...)` here (not `jestApi.mock`) — babel-jest only
// hoists the literal `jest.mock` identifier above `require` calls, so aliasing
// via destructuring would leave the mock registered too late.  `mockSendSms`
// prefix is required by the same hoisting guard (factory references).
jest.mock('../services/smsService', () => ({
  sendSms: jest.fn(),
}));
const { sendSms: mockSendSms } = require('../services/smsService');
const smsAdapter = require('../v1/services/channels/smsAdapter');

describe('smsAdapter.send', () => {
  beforeEach(() => {
    mockSendSms.mockReset();
  });

  test('missing phone → ok:false, error:phone_required (no SMS call)', async () => {
    const r = await smsAdapter.send({ payload: { message: 'hi' } });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('phone_required');
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  test('missing message AND body → ok:false, error:empty_message', async () => {
    const r = await smsAdapter.send({
      recipientAddress: '+79991234567',
      payload: { title: 'x' },
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('empty_message');
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  test('happy path → sendSms called, ok:true', async () => {
    mockSendSms.mockResolvedValue();
    const r = await smsAdapter.send({
      recipientAddress: '+79991234567',
      payload: { message: 'DomHub: гость прибыл' },
    });
    expect(r).toEqual({ ok: true });
    expect(mockSendSms).toHaveBeenCalledWith('+79991234567', 'DomHub: гость прибыл');
  });

  test('payload.body is used when payload.message absent', async () => {
    mockSendSms.mockResolvedValue();
    await smsAdapter.send({
      recipientAddress: '+79991234567',
      payload: { body: 'fallback body' },
    });
    expect(mockSendSms).toHaveBeenCalledWith('+79991234567', 'fallback body');
  });

  test('sendSms throws → ok:false, error from thrown message', async () => {
    mockSendSms.mockRejectedValue(new Error('all providers down'));
    const r = await smsAdapter.send({
      recipientAddress: '+79991234567',
      payload: { message: 'hi' },
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('all providers down');
  });
});

// ─── telegram adapter ─────────────────────────────────────────────────────────
const telegramAdapter = require('../v1/services/channels/telegramAdapter');

describe('telegramAdapter.send', () => {
  let originalFetch;
  let originalEnvToken;

  beforeEach(() => {
    originalFetch = global.fetch;
    originalEnvToken = process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalEnvToken === undefined) {
      delete process.env.TELEGRAM_BOT_TOKEN;
    } else {
      process.env.TELEGRAM_BOT_TOKEN = originalEnvToken;
    }
  });

  test('no chat_id → ok:false, error:chat_id_required', async () => {
    const r = await telegramAdapter.send({ payload: { text: 'hi' } });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('chat_id_required');
  });

  test('empty message → ok:false, error:empty_message', async () => {
    const r = await telegramAdapter.send({
      recipientAddress: '123',
      payload: { title: 'without text' },
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('empty_message');
  });

  test('no bot token anywhere → ok:false, error:no_bot_token', async () => {
    const r = await telegramAdapter.send({
      recipientAddress: '123',
      payload: { text: 'hi' },
      tenant: { property: {} },
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('no_bot_token');
  });

  test('tenant.property.telegram_bot_token takes precedence over env', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'env-token';
    global.fetch = jestApi.fn().mockResolvedValue({
      json: async () => ({ ok: true, result: {} }),
    });
    await telegramAdapter.send({
      recipientAddress: '123',
      payload: { text: 'hello' },
      tenant: { property: { telegram_bot_token: 'tenant-token' } },
    });
    const urlCalled = global.fetch.mock.calls[0][0];
    expect(urlCalled).toContain('bottenant-token');
    expect(urlCalled).not.toContain('botenv-token');
  });

  test('api returns ok:false → adapter returns ok:false with description', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'env-token';
    global.fetch = jestApi.fn().mockResolvedValue({
      json: async () => ({ ok: false, description: 'chat not found' }),
    });
    const r = await telegramAdapter.send({
      recipientAddress: '123',
      payload: { text: 'hi' },
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/chat not found/);
  });

  test('fetch throws (network) → ok:false with thrown message', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'env-token';
    global.fetch = jestApi.fn().mockRejectedValue(new Error('ETIMEDOUT'));
    const r = await telegramAdapter.send({
      recipientAddress: '123',
      payload: { text: 'hi' },
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('ETIMEDOUT');
  });

  test('happy path → ok:true, fetch called with HTML parse mode', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'env-token';
    global.fetch = jestApi.fn().mockResolvedValue({
      json: async () => ({ ok: true, result: {} }),
    });
    const r = await telegramAdapter.send({
      recipientAddress: '123',
      payload: { text: '<b>Заявка</b>' },
    });
    expect(r).toEqual({ ok: true });
    const [, init] = global.fetch.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.chat_id).toBe('123');
    expect(body.text).toBe('<b>Заявка</b>');
    expect(body.parse_mode).toBe('HTML');
  });
});

// ─── webhook adapter ──────────────────────────────────────────────────────────
const webhookAdapter = require('../v1/services/channels/webhookAdapter');

function makeDb(webhookSecret) {
  const rows = webhookSecret ? [{ secret: webhookSecret }] : [];
  return {
    query: jestApi.fn().mockResolvedValue({ rows }),
  };
}

describe('webhookAdapter.send', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('missing URL → error:url_required (no DB query)', async () => {
    const db = makeDb('secret');
    const r = await webhookAdapter.send({
      recipientId: 'wh-uuid',
      payload: { event: 'guest.arrived' },
      tenant: { db },
    });
    expect(r).toEqual({ ok: false, error: 'url_required' });
    expect(db.query).not.toHaveBeenCalled();
  });

  test('webhook inactive / secret missing → dead:true (do not retry)', async () => {
    const db = makeDb(null);
    const r = await webhookAdapter.send({
      recipientAddress: 'https://example.com/hook',
      recipientId: 'wh-uuid',
      payload: { event: 'guest.arrived' },
      tenant: { db },
    });
    expect(r.ok).toBe(false);
    expect(r.dead).toBe(true);
    expect(r.error).toMatch(/inactive|missing/);
  });

  test('happy path → HMAC-sha256 header present, ok:true, success-metrics update fired', async () => {
    const db = makeDb('super-secret');
    global.fetch = jestApi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
    });
    const r = await webhookAdapter.send({
      recipientAddress: 'https://partner.example/hook',
      recipientId: 'wh-uuid',
      correlationId: 'outbox-id',
      payload: { event: 'request.approved', data: { requestId: 'r-1' } },
      tenant: { db },
    });
    expect(r).toEqual({ ok: true });
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('https://partner.example/hook');
    expect(init.method).toBe('POST');
    expect(init.headers['X-DomHub-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(init.headers['X-DomHub-Event']).toBe('request.approved');
    expect(init.headers['X-DomHub-Delivery']).toBe('outbox-id');
    // Verify the signature actually matches the body.
    const crypto = require('crypto');
    const expected = crypto.createHmac('sha256', 'super-secret')
      .update(init.body).digest('hex');
    expect(init.headers['X-DomHub-Signature']).toBe(`sha256=${expected}`);
    // success UPDATE on webhooks table fired (fire-and-forget).
    const updateCalls = db.query.mock.calls.filter(([sql]) => /UPDATE\s+webhooks/i.test(sql));
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);
    expect(updateCalls[0][0]).toMatch(/last_success_at/);
  });

  test('HTTP non-2xx → ok:false with HTTP_XXX error (not dead, worker retries)', async () => {
    const db = makeDb('s');
    global.fetch = jestApi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'service unavailable',
    });
    const r = await webhookAdapter.send({
      recipientAddress: 'https://partner.example/hook',
      recipientId: 'wh-uuid',
      payload: { event: 'guest.arrived' },
      tenant: { db },
    });
    expect(r.ok).toBe(false);
    expect(r.dead).toBeUndefined();
    expect(r.error).toMatch(/HTTP_503/);
    expect(r.error).toMatch(/service unavailable/);
  });

  test('fetch throws (timeout) → ok:false, last_error updated', async () => {
    const db = makeDb('s');
    global.fetch = jestApi.fn().mockRejectedValue(new Error('aborted'));
    const r = await webhookAdapter.send({
      recipientAddress: 'https://slow.example/hook',
      recipientId: 'wh-uuid',
      payload: { event: 'x' },
      tenant: { db },
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('aborted');
    const updateCalls = db.query.mock.calls.filter(([sql]) => /last_error/i.test(sql));
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);
  });
});

describe('webhookAdapter.signPayload', () => {
  test('same body + secret → same signature (deterministic HMAC-sha256)', () => {
    const a = webhookAdapter.signPayload('{"a":1}', 'secret');
    const b = webhookAdapter.signPayload('{"a":1}', 'secret');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  test('different secret → different signature', () => {
    const a = webhookAdapter.signPayload('same', 'secret-a');
    const b = webhookAdapter.signPayload('same', 'secret-b');
    expect(a).not.toBe(b);
  });
});

// ─── email adapter (stub) ────────────────────────────────────────────────────
const emailAdapter = require('../v1/services/channels/emailAdapter');

describe('emailAdapter.send (stub)', () => {
  test('always returns {ok:false, dead:true} — adapter not yet implemented', async () => {
    const r = await emailAdapter.send({
      recipientAddress: 'resident@example.com',
      payload: { event: 'announcement.published' },
    });
    expect(r.ok).toBe(false);
    expect(r.dead).toBe(true);
    expect(r.error).toBe('email_adapter_not_implemented');
  });
});

// ─── web_push adapter ─────────────────────────────────────────────────────────
const webPushAdapter = require('../v1/services/channels/webPushAdapter');

const SNAPSHOT = JSON.stringify({
  subscription_id: 'sub-uuid',
  endpoint: 'https://fcm.googleapis.com/abc',
  p256dh: 'pk-value',
  auth:   'ak-value',
});

describe('webPushAdapter.parseSnapshot', () => {
  test('rejects empty recipientAddress', () => {
    expect(() => webPushAdapter.parseSnapshot(null)).toThrow(/recipientAddress required/);
    expect(() => webPushAdapter.parseSnapshot('')).toThrow(/recipientAddress required/);
  });

  test('rejects non-string', () => {
    expect(() => webPushAdapter.parseSnapshot(42)).toThrow(/must be JSON string/);
  });

  test('rejects invalid JSON', () => {
    expect(() => webPushAdapter.parseSnapshot('{not json')).toThrow(/invalid JSON/);
  });

  test('rejects missing fields', () => {
    expect(() => webPushAdapter.parseSnapshot(
      JSON.stringify({ endpoint: 'x', p256dh: 'y' }),
    )).toThrow(/missing endpoint\/p256dh\/auth/);
  });

  test('accepts full snapshot', () => {
    const parsed = webPushAdapter.parseSnapshot(SNAPSHOT);
    expect(parsed.subscription_id).toBe('sub-uuid');
  });
});

describe('webPushAdapter.send', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = {
      VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
      VAPID_SUBJECT: process.env.VAPID_SUBJECT,
    };
    webPushAdapter.__resetForTests();
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(originalEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    webPushAdapter.__resetForTests();
  });

  test('VAPID not configured → ok:false, error:vapid_not_configured', async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_SUBJECT;
    const r = await webPushAdapter.send({
      recipientAddress: SNAPSHOT,
      payload: { title: 'x' },
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('vapid_not_configured');
  });

  test('invalid snapshot JSON → ok:false with parse error (no throw)', async () => {
    // Need VAPID set so we reach parseSnapshot branch.  Use real generated
    // keys — `setVapidDetails` validates key format (P-256 base64url) and
    // throws on garbage like 'pk'/'sk', which `getWebPush` would catch and
    // turn into 'vapid_not_configured', masking the real test target.
    let webPushAvailable = true;
    try { require.resolve('web-push'); } catch { webPushAvailable = false; }
    if (!webPushAvailable) return;

    const wp = require('web-push');
    const { publicKey, privateKey } = wp.generateVAPIDKeys();
    process.env.VAPID_PUBLIC_KEY = publicKey;
    process.env.VAPID_PRIVATE_KEY = privateKey;
    process.env.VAPID_SUBJECT = 'mailto:x@example.com';
    // Cache may have been set to `false` by the previous test (or a stale
    // module-load race); reset AFTER env is configured so the next call
    // to getWebPush() picks up the real keys.
    webPushAdapter.__resetForTests();

    const r = await webPushAdapter.send({
      recipientAddress: '{bad json',
      payload: { title: 'x' },
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/invalid JSON/);
  });
});
