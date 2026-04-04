'use strict';

describe('metrics module', () => {
  test('increments known counters and returns snapshot', () => {
    jest.resetModules();
    const metrics = require('../metrics');

    metrics.incrementCounter('authRefreshRequests');
    metrics.incrementCounter('authRefreshSuccess', 2);
    metrics.incrementCounter('unknownCounter'); // no throw

    const snap = metrics.getSnapshot();
    expect(snap.authRefreshRequests).toBeGreaterThanOrEqual(1);
    expect(snap.authRefreshSuccess).toBeGreaterThanOrEqual(2);
    expect(snap.authRefreshFailed).toBeGreaterThanOrEqual(0);
  });

  // DO-03: P95 latency tracking
  test('recordLatency stores samples and getLatencyPercentile calculates P95', () => {
    jest.resetModules();
    const metrics = require('../metrics');

    // Record 100 samples: 1ms, 2ms, ..., 100ms
    for (let i = 1; i <= 100; i++) metrics.recordLatency(i);

    // P95 of 1..100 = sample at index ceil(0.95 * 100) - 1 = 94 in sorted array = 95ms
    expect(metrics.getLatencyPercentile(0.95)).toBe(95);
    expect(metrics.getLatencyPercentile(0.5)).toBe(50);
  });

  test('getLatencyPercentile returns null when no samples recorded', () => {
    jest.resetModules();
    const metrics = require('../metrics');
    expect(metrics.getLatencyPercentile(0.95)).toBeNull();
  });

  test('recordLatency ignores invalid values', () => {
    jest.resetModules();
    const metrics = require('../metrics');
    metrics.recordLatency(NaN);
    metrics.recordLatency(-1);
    metrics.recordLatency('fast');
    expect(metrics.getLatencyPercentile(0.95)).toBeNull();
  });

  test('getSnapshot includes latency block', () => {
    jest.resetModules();
    const metrics = require('../metrics');
    metrics.recordLatency(42);
    const snap = metrics.getSnapshot();
    expect(snap.latency).toBeDefined();
    expect(snap.latency.sampleCount).toBe(1);
    expect(snap.latency.p95).toBe(42);
  });

  test('rolling window caps at 1000 samples', () => {
    jest.resetModules();
    const metrics = require('../metrics');
    for (let i = 0; i < 1100; i++) metrics.recordLatency(i);
    const snap = metrics.getSnapshot();
    expect(snap.latency.sampleCount).toBe(1000);
    // oldest 100 entries (0..99) should be evicted; min should be 100
    expect(metrics.getLatencyPercentile(0)).toBe(100);
  });
});
