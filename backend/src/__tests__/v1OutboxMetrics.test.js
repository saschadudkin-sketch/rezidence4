'use strict';

/**
 * Phase 5 — outbox per-channel metrics recorders.
 * Spec: notifications-outbox-spec.md §4.5 (observability).
 *
 * Scope:
 *   • recordOutboxDelivery: valid input increments counter + appends sample;
 *     invalid channel/outcome/duration silently dropped.
 *   • getOutboxChannelPercentile: p50/p95/p99 calculation, null for empty.
 *   • getSnapshot().outbox.channels shape: per-channel counters + duration.
 *   • resetOutboxMetrics: test-helper zeros counters and empties samples.
 *   • rolling-window cap at 500 samples per channel.
 *
 * All tests share ONE module instance — resetOutboxMetrics runs in beforeEach
 * instead of jest.resetModules to avoid the 5-module re-require cost.
 */

const { describe, test, expect, beforeEach } = require('@jest/globals');
const metrics = require('../metrics');
const { recordOutboxDelivery, getOutboxChannelPercentile, getSnapshot, resetOutboxMetrics, OUTBOX_CHANNELS } = metrics;

beforeEach(() => { resetOutboxMetrics(); });

// ══════════════════════════════════════════════════════════════════════════════
// OUTBOX_CHANNELS constant
// ══════════════════════════════════════════════════════════════════════════════

describe('OUTBOX_CHANNELS', () => {
  test('exposes exactly 5 canonical channels', () => {
    expect([...OUTBOX_CHANNELS].sort()).toEqual(
      ['email', 'sms', 'telegram', 'web_push', 'webhook'],
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// recordOutboxDelivery — happy path
// ══════════════════════════════════════════════════════════════════════════════

describe('recordOutboxDelivery — counters', () => {
  test('valid (channel, outcome) increments matching counter only', () => {
    recordOutboxDelivery('sms', 'sent', 50);
    recordOutboxDelivery('sms', 'sent', 75);
    recordOutboxDelivery('telegram', 'failed', 120);

    const snap = getSnapshot();
    expect(snap.outbox.channels.sms.sent).toBe(2);
    expect(snap.outbox.channels.sms.failed).toBe(0);
    expect(snap.outbox.channels.sms.dead).toBe(0);
    expect(snap.outbox.channels.telegram.failed).toBe(1);
    expect(snap.outbox.channels.telegram.sent).toBe(0);
    // Untouched channels stay zero.
    expect(snap.outbox.channels.web_push.sent).toBe(0);
    expect(snap.outbox.channels.email.sent).toBe(0);
    expect(snap.outbox.channels.webhook.sent).toBe(0);
  });

  test('three outcomes (sent/failed/dead) are counted independently', () => {
    recordOutboxDelivery('web_push', 'sent', 10);
    recordOutboxDelivery('web_push', 'failed', 20);
    recordOutboxDelivery('web_push', 'dead', 30);

    const ch = getSnapshot().outbox.channels.web_push;
    expect(ch.sent).toBe(1);
    expect(ch.failed).toBe(1);
    expect(ch.dead).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// recordOutboxDelivery — invalid input silently dropped
// ══════════════════════════════════════════════════════════════════════════════

describe('recordOutboxDelivery — invalid input silently dropped', () => {
  test('unknown channel does not throw and does not increment anything', () => {
    expect(() => recordOutboxDelivery('pigeon', 'sent', 10)).not.toThrow();
    const snap = getSnapshot();
    for (const ch of OUTBOX_CHANNELS) {
      expect(snap.outbox.channels[ch].sent).toBe(0);
    }
  });

  test('unknown outcome does not throw and does not increment anything', () => {
    expect(() => recordOutboxDelivery('sms', 'exploded', 10)).not.toThrow();
    const snap = getSnapshot();
    expect(snap.outbox.channels.sms.sent).toBe(0);
    expect(snap.outbox.channels.sms.failed).toBe(0);
    expect(snap.outbox.channels.sms.dead).toBe(0);
  });

  test('invalid duration still increments counter but skips sample', () => {
    recordOutboxDelivery('sms', 'sent', NaN);
    recordOutboxDelivery('sms', 'sent', -1);
    recordOutboxDelivery('sms', 'sent', 'fast');
    recordOutboxDelivery('sms', 'sent', null);
    recordOutboxDelivery('sms', 'sent', undefined);

    const ch = getSnapshot().outbox.channels.sms;
    // Counter still advanced for each valid (channel, outcome) call.
    expect(ch.sent).toBe(5);
    // But no durations were sampled.
    expect(ch.duration.sampleCount).toBe(0);
    expect(ch.duration.p95).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// duration samples + percentiles
// ══════════════════════════════════════════════════════════════════════════════

describe('duration percentiles', () => {
  test('samples appended per channel and p50/p95 computed correctly', () => {
    // 100 samples 1..100ms on sms channel.
    for (let i = 1; i <= 100; i++) recordOutboxDelivery('sms', 'sent', i);

    expect(getOutboxChannelPercentile('sms', 0.5)).toBe(50);
    expect(getOutboxChannelPercentile('sms', 0.95)).toBe(95);
    expect(getOutboxChannelPercentile('sms', 0.99)).toBe(99);
  });

  test('returns null for channel with no samples', () => {
    expect(getOutboxChannelPercentile('email', 0.95)).toBeNull();
  });

  test('returns null for unknown channel', () => {
    expect(getOutboxChannelPercentile('pigeon', 0.95)).toBeNull();
  });

  test('per-channel isolation — samples for sms do not leak into telegram', () => {
    for (let i = 1; i <= 50; i++) recordOutboxDelivery('sms', 'sent', 1000);
    for (let i = 1; i <= 50; i++) recordOutboxDelivery('telegram', 'sent', 10);
    expect(getOutboxChannelPercentile('sms', 0.5)).toBe(1000);
    expect(getOutboxChannelPercentile('telegram', 0.5)).toBe(10);
  });

  test('rolling window caps at 500 samples per channel', () => {
    // 600 samples → oldest 100 evicted.  Record 1..600ms; min after cap = 101.
    for (let i = 1; i <= 600; i++) recordOutboxDelivery('sms', 'sent', i);
    const snap = getSnapshot();
    expect(snap.outbox.channels.sms.duration.sampleCount).toBe(500);
    // Smallest remaining sample is 101 (since 1..100 evicted).
    expect(getOutboxChannelPercentile('sms', 0)).toBe(101);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// getSnapshot shape
// ══════════════════════════════════════════════════════════════════════════════

describe('getSnapshot outbox shape', () => {
  test('includes all 5 channels with full counter+duration shape', () => {
    const snap = getSnapshot();
    expect(snap.outbox).toBeDefined();
    expect(snap.outbox.channels).toBeDefined();
    for (const ch of OUTBOX_CHANNELS) {
      const entry = snap.outbox.channels[ch];
      expect(entry).toBeDefined();
      expect(entry).toHaveProperty('sent');
      expect(entry).toHaveProperty('failed');
      expect(entry).toHaveProperty('dead');
      expect(entry.duration).toBeDefined();
      expect(entry.duration).toHaveProperty('sampleCount');
      expect(entry.duration).toHaveProperty('p50');
      expect(entry.duration).toHaveProperty('p95');
      expect(entry.duration).toHaveProperty('p99');
    }
  });

  test('empty state returns zero counters and null percentiles', () => {
    const snap = getSnapshot();
    for (const ch of OUTBOX_CHANNELS) {
      const e = snap.outbox.channels[ch];
      expect(e.sent).toBe(0);
      expect(e.failed).toBe(0);
      expect(e.dead).toBe(0);
      expect(e.duration.sampleCount).toBe(0);
      expect(e.duration.p50).toBeNull();
      expect(e.duration.p95).toBeNull();
      expect(e.duration.p99).toBeNull();
    }
  });

  test('does not clobber the existing latency/auth fields', () => {
    // Snapshot must still include the pre-existing counters + latency block.
    const snap = getSnapshot();
    expect(snap).toHaveProperty('authRefreshRequests');
    expect(snap).toHaveProperty('latency');
    expect(snap.latency).toHaveProperty('p95');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// resetOutboxMetrics
// ══════════════════════════════════════════════════════════════════════════════

describe('resetOutboxMetrics', () => {
  test('zeros counters and empties duration samples for all channels', () => {
    for (const ch of OUTBOX_CHANNELS) {
      recordOutboxDelivery(ch, 'sent',   10);
      recordOutboxDelivery(ch, 'failed', 20);
      recordOutboxDelivery(ch, 'dead',   30);
    }
    resetOutboxMetrics();
    const snap = getSnapshot();
    for (const ch of OUTBOX_CHANNELS) {
      const e = snap.outbox.channels[ch];
      expect(e.sent).toBe(0);
      expect(e.failed).toBe(0);
      expect(e.dead).toBe(0);
      expect(e.duration.sampleCount).toBe(0);
    }
  });
});
