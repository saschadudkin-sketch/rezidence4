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

function getSnapshot() {
  return {
    ...counters,
    latency: {
      sampleCount: latencySamples.length,
      p50: getLatencyPercentile(0.5),
      p95: getLatencyPercentile(0.95),
      p99: getLatencyPercentile(0.99),
    },
  };
}

module.exports = { incrementCounter, recordLatency, getLatencyPercentile, getSnapshot };
