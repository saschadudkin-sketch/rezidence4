'use strict';

/**
 * Phase 5 — v1 notificationDispatcher unit tests.
 * Spec: docs/product/specs/platform-v1/notifications-outbox-spec.md §4.1.
 *
 * Проверяем:
 *   • routing: flag off → inline; flag on + (no tx | no property) → inline;
 *     flag on + tx + property → outbox.
 *   • outbox path НЕ глотает ошибки — caller должен rollback'нуть tx
 *     вместе с бизнес-мутацией (spec §4.1).
 *   • inline path глотает (legacy behaviour), возвращает {mode:'inline', error}.
 *   • resolveUserIds: explicit userIds > userId > broadcast (getBroadcastRoles
 *     + getPropertyUsers).
 *   • buildRowsForUser: web_push → JSON snapshot; telegram → chat_id;
 *     sms → user.phone; не производит rows для disabled channels.
 *   • getActiveWebhooksForEvent: `is_active=true AND $event = ANY(events)`.
 *   • dispatchViaOutbox: webhook fan-out с external recipient_type.
 */

const {
  describe, test, expect, beforeEach, jest: jestApi,
} = require('@jest/globals');

// ─── Mock legacy notificationService ──────────────────────────────────────────
// NOTE: bare `jest.mock(...)` (not `jestApi.mock`) — babel-jest only hoists
// the literal `jest.mock` identifier above `require` calls.  Aliasing would
// register the mock after the dispatcher has already captured unmocked refs.
jest.mock('../services/notificationService', () => ({
  dispatch:             jest.fn(),
  buildMessages:        jest.fn(),
  getBroadcastRoles:    jest.fn(),
  getUserSubscriptions: jest.fn(),
  getUserById:          jest.fn(),
  getPropertyUsers:     jest.fn(),
  EVENT_CHANNELS: {
    'request.approved':       { push: true, sms: false, telegram: true  },
    'announcement.published': { push: true, sms: false, telegram: false },
    'blacklist.attempt':      { push: true, sms: true,  telegram: true  },
    'guest.arrived':          { push: true, sms: true,  telegram: false },
  },
}));

// ─── Mock outbox producer ─────────────────────────────────────────────────────
jest.mock('../v1/services/notificationOutbox', () => ({
  enqueueNotificationBatch: jest.fn(async () => []),
  isOutboxEnabled:          jest.fn(() => false),
}));

const notificationService = require('../services/notificationService');
const outbox               = require('../v1/services/notificationOutbox');
const dispatcher           = require('../v1/services/notificationDispatcher');

// Helper: pg-pool-like stub with query(). Returns empty rows unless overridden.
function makeDb(rows = []) {
  return { query: jestApi.fn().mockResolvedValue({ rows }) };
}

// ══════════════════════════════════════════════════════════════════════════════
// dispatchEvent — routing
// ══════════════════════════════════════════════════════════════════════════════

describe('dispatchEvent — routing', () => {
  beforeEach(() => {
    jestApi.clearAllMocks();
    // clearAllMocks wipes call history but preserves `.mockRejectedValue` /
    // `.mockImplementation` set in earlier tests.  Re-install defaults so
    // `fk_violation` from one test doesn't leak into the next one.
    outbox.isOutboxEnabled.mockReturnValue(false);
    outbox.enqueueNotificationBatch.mockImplementation(async () => []);
    notificationService.dispatch.mockResolvedValue();
  });

  test('flag off → inline delegates to notificationService.dispatch', async () => {
    const db = makeDb();
    const tx = { query: jestApi.fn() }; // present but ignored when flag off
    const property = { id: 'p1' };

    const r = await dispatcher.dispatchEvent({
      event: 'request.approved',
      data:  { userId: 'u1' },
      db, tx, property,
    });

    expect(r).toEqual({ mode: 'inline' });
    expect(notificationService.dispatch).toHaveBeenCalledTimes(1);
    expect(notificationService.dispatch).toHaveBeenCalledWith(
      'request.approved',
      { userId: 'u1' },
      db,
      property,
    );
    expect(outbox.enqueueNotificationBatch).not.toHaveBeenCalled();
  });

  test('flag on but no tx → inline fallback', async () => {
    outbox.isOutboxEnabled.mockReturnValue(true);
    const r = await dispatcher.dispatchEvent({
      event: 'request.approved',
      data:  {},
      db:    makeDb(),
      // tx omitted
      property: { id: 'p1' },
    });
    expect(r).toEqual({ mode: 'inline' });
    expect(notificationService.dispatch).toHaveBeenCalled();
    expect(outbox.enqueueNotificationBatch).not.toHaveBeenCalled();
  });

  test('flag on + tx but no property → inline fallback', async () => {
    outbox.isOutboxEnabled.mockReturnValue(true);
    const r = await dispatcher.dispatchEvent({
      event: 'request.approved',
      data:  {},
      db:    makeDb(),
      tx:    { query: jestApi.fn() },
      // property omitted
    });
    expect(r).toEqual({ mode: 'inline' });
    expect(outbox.enqueueNotificationBatch).not.toHaveBeenCalled();
  });

  test('inline dispatch rejects → swallowed, returns {mode:inline, error}', async () => {
    notificationService.dispatch.mockRejectedValue(new Error('boom'));
    const r = await dispatcher.dispatchEvent({
      event: 'request.approved', data: {}, db: makeDb(),
    });
    expect(r.mode).toBe('inline');
    expect(r.error).toBe('boom');
  });

  test('flag on + tx + property → outbox path, returns mode:outbox', async () => {
    outbox.isOutboxEnabled.mockReturnValue(true);
    notificationService.buildMessages.mockReturnValue({
      push: { title: 't', body: 'b' }, sms: null, telegram: 'hi',
    });
    notificationService.getBroadcastRoles.mockReturnValue([]);
    notificationService.getUserSubscriptions.mockResolvedValue([
      { id: 's1', platform: 'web', endpoint: 'e', p256dh: 'k', auth: 'a' },
    ]);

    const db = makeDb();   // webhooks query returns []
    const tx = { query: jestApi.fn() };
    const r = await dispatcher.dispatchEvent({
      event:    'request.approved',
      data:     { userId: 'u1' },
      db, tx,
      property: { id: 'p1' },
    });

    expect(r).toEqual({ mode: 'outbox', enqueued: 1 });
    expect(notificationService.dispatch).not.toHaveBeenCalled();
    expect(outbox.enqueueNotificationBatch).toHaveBeenCalledTimes(1);
    const [txArg, rows] = outbox.enqueueNotificationBatch.mock.calls[0];
    expect(txArg).toBe(tx);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      eventType:      'request.approved',
      channel:        'web_push',
      recipientType:  'resident',
      recipientId:    'u1',
      propertyId:     'p1',
    });
  });

  test('outbox path propagates errors (NO swallow — caller rollback contract)', async () => {
    outbox.isOutboxEnabled.mockReturnValue(true);
    notificationService.buildMessages.mockReturnValue({
      push: { title: 't', body: 'b' }, sms: null, telegram: null,
    });
    notificationService.getBroadcastRoles.mockReturnValue([]);
    notificationService.getUserSubscriptions.mockResolvedValue([
      { id: 's1', platform: 'web', endpoint: 'e', p256dh: 'k', auth: 'a' },
    ]);
    outbox.enqueueNotificationBatch.mockRejectedValue(new Error('fk_violation'));

    const p = dispatcher.dispatchEvent({
      event:    'request.approved',
      data:     { userId: 'u1' },
      db:       makeDb(),
      tx:       { query: jestApi.fn() },
      property: { id: 'p1' },
    });
    await expect(p).rejects.toThrow('fk_violation');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// resolveUserIds
// ══════════════════════════════════════════════════════════════════════════════

describe('resolveUserIds', () => {
  beforeEach(() => { jestApi.clearAllMocks(); });

  test('explicit userIds array wins over everything', async () => {
    const ids = await dispatcher.resolveUserIds('x', { userIds: ['a', 'b'] }, {});
    expect(ids).toEqual(['a', 'b']);
    expect(notificationService.getPropertyUsers).not.toHaveBeenCalled();
    expect(notificationService.getBroadcastRoles).not.toHaveBeenCalled();
  });

  test('single userId fallback (no userIds array)', async () => {
    const ids = await dispatcher.resolveUserIds('x', { userId: 'only' }, {});
    expect(ids).toEqual(['only']);
    expect(notificationService.getPropertyUsers).not.toHaveBeenCalled();
  });

  test('empty userIds array → NOT treated as explicit, falls through to broadcast', async () => {
    notificationService.getBroadcastRoles.mockReturnValue(['resident']);
    notificationService.getPropertyUsers.mockResolvedValue([{ uid: 'u1' }]);
    const ids = await dispatcher.resolveUserIds('announcement.published', { userIds: [] }, {});
    expect(ids).toEqual(['u1']);
  });

  test('broadcast path: getBroadcastRoles + getPropertyUsers', async () => {
    notificationService.getBroadcastRoles.mockReturnValue(['resident']);
    notificationService.getPropertyUsers.mockResolvedValue([
      { uid: 'u1' }, { uid: 'u2' },
    ]);
    const db = {};
    const ids = await dispatcher.resolveUserIds('announcement.published', {}, db);
    expect(ids).toEqual(['u1', 'u2']);
    expect(notificationService.getPropertyUsers).toHaveBeenCalledWith(['resident'], db);
  });

  test('no explicit and no broadcast roles → empty array', async () => {
    notificationService.getBroadcastRoles.mockReturnValue([]);
    const ids = await dispatcher.resolveUserIds('unknown_event', {}, {});
    expect(ids).toEqual([]);
    expect(notificationService.getPropertyUsers).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// buildRowsForUser
// ══════════════════════════════════════════════════════════════════════════════

describe('buildRowsForUser', () => {
  beforeEach(() => { jestApi.clearAllMocks(); });

  test('push enabled + web subs → web_push row per sub with JSON snapshot', async () => {
    notificationService.getUserSubscriptions.mockResolvedValue([
      { id: 's1', platform: 'web',      endpoint: 'e1', p256dh: 'k1', auth: 'a1' },
      { id: 's2', platform: 'web',      endpoint: 'e2', p256dh: 'k2', auth: 'a2' },
      { id: 's3', platform: 'telegram', telegram_chat_id: '555' },
    ]);
    const rows = await dispatcher.buildRowsForUser({
      userId:   'u1',
      event:    'announcement.published',
      data:     {},
      channels: { push: true, sms: false, telegram: false },
      messages: { push: { title: 't', body: 'b' }, sms: null, telegram: null },
      db:       {},
    });
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.channel).toBe('web_push');
      expect(r.recipientType).toBe('resident');
      expect(r.recipientId).toBe('u1');
    }
    const snap = JSON.parse(rows[0].recipientAddress);
    expect(snap).toEqual({
      subscription_id: 's1', endpoint: 'e1', p256dh: 'k1', auth: 'a1',
    });
    expect(rows[0].payload).toEqual({ title: 't', body: 'b' });
  });

  test('telegram enabled + tg subs → telegram rows with chat_id as address', async () => {
    notificationService.getUserSubscriptions.mockResolvedValue([
      { platform: 'telegram', telegram_chat_id: '1234' },
      { platform: 'telegram', telegram_chat_id: null },  // skipped
    ]);
    const rows = await dispatcher.buildRowsForUser({
      userId:   'u1',
      event:    'request.approved',
      data:     {},
      channels: { push: false, sms: false, telegram: true },
      messages: { push: null, sms: null, telegram: '<b>hi</b>' },
      db:       {},
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      channel:          'telegram',
      recipientType:    'resident',
      recipientAddress: '1234',
      payload:          { text: '<b>hi</b>' },
    });
  });

  test('sms enabled + user.phone present → one sms row', async () => {
    notificationService.getUserSubscriptions.mockResolvedValue([]);
    notificationService.getUserById.mockResolvedValue({ phone: '+79991234567' });

    const rows = await dispatcher.buildRowsForUser({
      userId:   'u1',
      event:    'guest.arrived',
      data:     {},
      channels: { push: false, sms: true, telegram: false },
      messages: { push: null, sms: 'DomHub: hi', telegram: null },
      db:       {},
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      channel:          'sms',
      recipientType:    'resident',
      recipientAddress: '+79991234567',
      payload:          { message: 'DomHub: hi' },
    });
  });

  test('sms enabled + no phone → no sms row', async () => {
    notificationService.getUserSubscriptions.mockResolvedValue([]);
    notificationService.getUserById.mockResolvedValue({ phone: null });

    const rows = await dispatcher.buildRowsForUser({
      userId:   'u1',
      event:    'guest.arrived',
      data:     {},
      channels: { push: false, sms: true, telegram: false },
      messages: { push: null, sms: 'DomHub: hi', telegram: null },
      db:       {},
    });
    expect(rows).toHaveLength(0);
  });

  test('push disabled → zero web_push rows even with subs', async () => {
    notificationService.getUserSubscriptions.mockResolvedValue([
      { id: 's1', platform: 'web', endpoint: 'e', p256dh: 'k', auth: 'a' },
    ]);
    const rows = await dispatcher.buildRowsForUser({
      userId:   'u1',
      event:    'request.approved',
      data:     {},
      channels: { push: false, sms: false, telegram: false },
      messages: { push: { title: 't', body: 'b' }, sms: null, telegram: null },
      db:       {},
    });
    expect(rows).toHaveLength(0);
  });

  test('channel enabled but message null → no row (defensive)', async () => {
    notificationService.getUserSubscriptions.mockResolvedValue([
      { id: 's1', platform: 'web', endpoint: 'e', p256dh: 'k', auth: 'a' },
    ]);
    const rows = await dispatcher.buildRowsForUser({
      userId:   'u1',
      event:    'announcement.published',
      data:     {},
      channels: { push: true, sms: false, telegram: false },
      messages: { push: null, sms: null, telegram: null },  // push=null
      db:       {},
    });
    expect(rows).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// getActiveWebhooksForEvent
// ══════════════════════════════════════════════════════════════════════════════

describe('getActiveWebhooksForEvent', () => {
  test('queries webhooks table, is_active=true AND event = ANY(events)', async () => {
    const db = makeDb([
      { id: 'wh1', url: 'https://a/' },
      { id: 'wh2', url: 'https://b/' },
    ]);
    const out = await dispatcher.getActiveWebhooksForEvent('request.approved', db);

    expect(out).toEqual([
      { id: 'wh1', url: 'https://a/' },
      { id: 'wh2', url: 'https://b/' },
    ]);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/FROM webhooks/i);
    expect(sql).toMatch(/is_active\s*=\s*true/i);
    expect(sql).toMatch(/=\s*ANY\(events\)/i);
    expect(params).toEqual(['request.approved']);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// dispatchViaOutbox — end-to-end per-path checks
// ══════════════════════════════════════════════════════════════════════════════

describe('dispatchViaOutbox', () => {
  beforeEach(() => {
    jestApi.clearAllMocks();
    outbox.enqueueNotificationBatch.mockImplementation(async () => []);
  });

  test('webhook fan-out — external rows with wh.id as recipientId, wh.url as address', async () => {
    notificationService.buildMessages.mockReturnValue({
      push: { title: 't', body: 'b' }, sms: null, telegram: null,
    });
    notificationService.getBroadcastRoles.mockReturnValue([]);
    notificationService.getUserSubscriptions.mockResolvedValue([]);   // no user rows
    const db = makeDb([{ id: 'wh1', url: 'https://hook/' }]);
    const tx = { query: jestApi.fn() };

    const r = await dispatcher.dispatchViaOutbox({
      event:    'request.approved',
      data:     { userId: 'u1', correlationId: 'corr-1' },
      property: { id: 'p1' },
      db, tx,
    });

    expect(r).toEqual({ mode: 'outbox', enqueued: 1 });
    const [, rows] = outbox.enqueueNotificationBatch.mock.calls[0];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      channel:          'webhook',
      recipientType:    'external',
      recipientId:      'wh1',
      recipientAddress: 'https://hook/',
      propertyId:       'p1',
      correlationId:    'corr-1',
    });
    expect(rows[0].payload).toEqual({
      event: 'request.approved',
      data:  { userId: 'u1', correlationId: 'corr-1' },
    });
  });

  test('no user rows AND no webhooks → zero enqueue, no batch INSERT', async () => {
    notificationService.buildMessages.mockReturnValue({
      push: { title: 't', body: 'b' }, sms: null, telegram: null,
    });
    notificationService.getBroadcastRoles.mockReturnValue([]);
    notificationService.getUserSubscriptions.mockResolvedValue([]);
    const r = await dispatcher.dispatchViaOutbox({
      event:    'request.approved',
      data:     {},
      property: { id: 'p1' },
      db:       makeDb(),
      tx:       { query: jestApi.fn() },
    });
    expect(r).toEqual({ mode: 'outbox', enqueued: 0 });
    expect(outbox.enqueueNotificationBatch).not.toHaveBeenCalled();
  });

  test('requires property.id (defensive throw)', async () => {
    await expect(dispatcher.dispatchViaOutbox({
      event: 'x', data: {}, property: {}, db: makeDb(),
      tx:    { query: jestApi.fn() },
    })).rejects.toThrow(/property\.id required/);
  });

  test('requires tx with .query method', async () => {
    await expect(dispatcher.dispatchViaOutbox({
      event: 'x', data: {}, property: { id: 'p1' }, db: makeDb(),
      tx:    { not: 'a pg client' },
    })).rejects.toThrow(/tx/i);
  });

  test('propagates correlationId from data into rows', async () => {
    notificationService.buildMessages.mockReturnValue({
      push: { title: 't', body: 'b' }, sms: null, telegram: null,
    });
    notificationService.getBroadcastRoles.mockReturnValue([]);
    notificationService.getUserSubscriptions.mockResolvedValue([
      { id: 's1', platform: 'web', endpoint: 'e', p256dh: 'k', auth: 'a' },
    ]);
    const db = makeDb();
    const tx = { query: jestApi.fn() };

    await dispatcher.dispatchViaOutbox({
      event:    'request.approved',
      data:     { userId: 'u1', correlationId: 'req-uuid-42' },
      property: { id: 'p1' },
      db, tx,
    });
    const [, rows] = outbox.enqueueNotificationBatch.mock.calls[0];
    expect(rows[0].correlationId).toBe('req-uuid-42');
  });
});
