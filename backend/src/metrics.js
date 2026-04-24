'use strict';

// DO-03: P95 request latency tracking

const counters = {
  authRefreshRequests: 0,
  authRefreshSuccess: 0,
  authRefreshFailed: 0,
  authRefreshLegacyFallbackUsed: 0,
  // OTP metrics — DO-03: track security-critical events for alerting
  otpSendSuccess: 0,         // SMS sent successfully
  otpSendRateLimited: 0,     // 429 returned — potential abuse signal
  otpSendSmsFailed: 0,       // SMS provider error
  otpVerifyFailed: 0,        // wrong code — potential brute-force signal
  otpVerifySuccess: 0,       // successful verification
  authLoginSuccess: 0,       // completed login
};

/** Rolling window for request latency samples (last 1000 requests) */
const MAX_LATENCY_SAMPLES = 1000;
const latencySamples = [];

// ─── platform-v1 notifications-outbox per-channel metrics ────────────────────
// Spec: notifications-outbox-spec.md §4.5 (observability).  Держим лёгкую
// in-process агрегацию (counter + rolling percentile window) — Prometheus
// слой просто скрейпит снимок через /api/metrics/prometheus.  Никаких
// prom-client'ов не тащим: 3 counter'а × 5 каналов + 1 summary — легко
// обслуживается 40 строками.

/** Валидные channel'ы.  Важно: должен совпадать с CHECK constraint
 *  notifications_outbox.channel (см. migration 016) — иначе unknown-каналы
 *  будут тихо теряться из метрик. */
const OUTBOX_CHANNELS = ['web_push', 'sms', 'telegram', 'webhook', 'email'];

/** Counters per (channel, outcome).  outcome ∈ {sent, failed, dead}. */
const outboxCounters = {
  sent:   Object.fromEntries(OUTBOX_CHANNELS.map((c) => [c, 0])),
  failed: Object.fromEntries(OUTBOX_CHANNELS.map((c) => [c, 0])),
  dead:   Object.fromEntries(OUTBOX_CHANNELS.map((c) => [c, 0])),
};

/** Rolling duration samples per channel (max 500 each ≈ 15 min at 30 rps). */
const MAX_OUTBOX_SAMPLES = 500;
const outboxDurationSamples = Object.fromEntries(OUTBOX_CHANNELS.map((c) => [c, []]));

function incrementCounter(name, by = 1) {
  if (!Object.prototype.hasOwnProperty.call(counters, name)) return;
  counters[name] += by;
}

/**
 * DO-03: Record a request latency sample in milliseconds.
 * Maintains a rolling window of the last MAX_LATENCY_SAMPLES entries.
 */
function recordLatency(ms) {
  if (typeof ms !== 'number' || !isFinite(ms) || ms < 0) return;
  latencySamples.push(ms);
  if (latencySamples.length > MAX_LATENCY_SAMPLES) latencySamples.shift();
}

/**
 * DO-03: Calculate a percentile from the collected latency samples.
 * Returns null when no samples have been recorded yet.
 * @param {number} p - Percentile as a fraction (0–1), e.g. 0.95 for P95
 */
function getLatencyPercentile(p) {
  if (latencySamples.length === 0) return null;
  const sorted = latencySamples.slice().sort((a, b) => a - b);
  const idx = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

/**
 * recordOutboxDelivery — single hook for worker state-machine.
 *
 * @param {string} channel  ∈ OUTBOX_CHANNELS (others silently dropped)
 * @param {'sent'|'failed'|'dead'} outcome
 * @param {?number} durationMs  adapter dispatch duration (positive finite)
 *
 * Why silently drop unknown channels: worker calls this from a try/catch
 * path; throwing here would mask an already-in-progress error.  We log a
 * warning via the outer `logger` on invalid channel, but metrics are
 * best-effort — this is observability, not control.
 */
function recordOutboxDelivery(channel, outcome, durationMs) {
  if (!Object.prototype.hasOwnProperty.call(outboxCounters, outcome)) return;
  const bucket = outboxCounters[outcome];
  if (!Object.prototype.hasOwnProperty.call(bucket, channel)) return;
  bucket[channel] += 1;

  if (typeof durationMs === 'number' && isFinite(durationMs) && durationMs >= 0) {
    const samples = outboxDurationSamples[channel];
    samples.push(durationMs);
    if (samples.length > MAX_OUTBOX_SAMPLES) samples.shift();
  }
}

/**
 * getOutboxChannelPercentile — percentile для rolling-window семплов
 * конкретного канала.  null, если нет данных.
 */
function getOutboxChannelPercentile(channel, p) {
  const samples = outboxDurationSamples[channel];
  if (!samples || samples.length === 0) return null;
  const sorted = samples.slice().sort((a, b) => a - b);
  const idx = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function getSnapshot() {
  const outboxChannels = {};
  for (const ch of OUTBOX_CHANNELS) {
    outboxChannels[ch] = {
      sent:   outboxCounters.sent[ch],
      failed: outboxCounters.failed[ch],
      dead:   outboxCounters.dead[ch],
      duration: {
        sampleCount: outboxDurationSamples[ch].length,
        p50: getOutboxChannelPercentile(ch, 0.5),
        p95: getOutboxChannelPercentile(ch, 0.95),
        p99: getOutboxChannelPercentile(ch, 0.99),
      },
    };
  }
  return {
    ...counters,
    latency: {
      sampleCount: latencySamples.length,
      p50: getLatencyPercentile(0.5),
      p95: getLatencyPercentile(0.95),
      p99: getLatencyPercentile(0.99),
    },
    outbox: { channels: outboxChannels },
  };
}

/** resetOutboxMetrics — только для тестов: обнуляет counter'ы и samples. */
function resetOutboxMetrics() {
  for (const outcome of Object.keys(outboxCounters)) {
    for (const ch of OUTBOX_CHANNELS) outboxCounters[outcome][ch] = 0;
  }
  for (const ch of OUTBOX_CHANNELS) outboxDurationSamples[ch].length = 0;
}

module.exports = {
  incrementCounter,
  recordLatency,
  getLatencyPercentile,
  getSnapshot,
  recordOutboxDelivery,
  getOutboxChannelPercentile,
  resetOutboxMetrics,
  OUTBOX_CHANNELS,
};
