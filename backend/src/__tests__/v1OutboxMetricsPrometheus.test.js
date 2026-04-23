'use strict';

/**
 * Phase 5 — /api/metrics/prometheus outbox section.
 * Spec: notifications-outbox-spec.md §4.5 (observability).
 *
 * Scope:
 *   • Endpoint still gated on admin role (unchanged from baseline).
 *   • Empty metrics → zeroed per-channel counters still emitted (all 5 channels).
 *   • After recordOutboxDelivery calls → per-channel counter lines reflect
 *     counts exactly and duration summary emits quantile=0.5/0.95/0.99 lines.
 *   • HELP/TYPE comment blocks present for all 4 metric families.
 *   • Counter format matches Prometheus exposition: `name{labels} value`.
 */

const { describe, test, expect, beforeEach } = require('@jest/globals');
const express = require('express');
const supertest = require('supertest');

jest.mock('../logger', () => require('../__mocks__/logger'));

let mockCurrentUser = null;
jest.mock('../middleware/auth', () => (req, res, next) => {
  if (!mockCurrentUser) return res.status(401).json({ error: 'unauth' });
  req.user = mockCurrentUser;
  next();
});

const mockDb = {
  query: jest.fn(),
  pool: { totalCount: 2, idleCount: 1, waitingCount: 0 },
};

const { registerObservabilityRoutes } = require('../app/registerObservabilityRoutes');
const { recordOutboxDelivery, resetOutboxMetrics } = require('../metrics');

function buildApp() {
  const app = express();
  app.use(express.json());
  registerObservabilityRoutes(app, { db: mockDb });
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = null;
  resetOutboxMetrics();
});

// ══════════════════════════════════════════════════════════════════════════════
// auth (the endpoint already had tests elsewhere, but we sanity-check that the
// outbox section didn't break the gate).
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/metrics/prometheus — auth (with outbox block)', () => {
  test('401 when unauthenticated', async () => {
    const res = await supertest(buildApp()).get('/api/metrics/prometheus');
    expect(res.status).toBe(401);
  });

  test('403 for non-admin role', async () => {
    mockCurrentUser = { uid: 'u1', role: 'security' };
    const res = await supertest(buildApp()).get('/api/metrics/prometheus');
    expect(res.status).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// content-type + HELP/TYPE comments
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/metrics/prometheus — outbox HELP/TYPE comments', () => {
  beforeEach(() => { mockCurrentUser = { uid: 'admin1', role: 'admin' }; });

  test('text/plain Prometheus exposition content-type', async () => {
    const res = await supertest(buildApp()).get('/api/metrics/prometheus');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    expect(res.headers['content-type']).toMatch(/version=0\.0\.4/);
  });

  test('emits HELP/TYPE for all 4 outbox metric families', async () => {
    // Must emit these even with zero samples — Prometheus consumers expect
    // stable metadata for scrape-time metric discovery.
    recordOutboxDelivery('sms', 'sent', 10);
    const res = await supertest(buildApp()).get('/api/metrics/prometheus');
    const body = res.text;
    // counters
    expect(body).toMatch(/# HELP rez_outbox_sent_total /);
    expect(body).toMatch(/# TYPE rez_outbox_sent_total counter/);
    expect(body).toMatch(/# HELP rez_outbox_failed_total /);
    expect(body).toMatch(/# TYPE rez_outbox_failed_total counter/);
    expect(body).toMatch(/# HELP rez_outbox_dead_total /);
    expect(body).toMatch(/# TYPE rez_outbox_dead_total counter/);
    // summary
    expect(body).toMatch(/# HELP rez_outbox_send_duration_milliseconds /);
    expect(body).toMatch(/# TYPE rez_outbox_send_duration_milliseconds summary/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// counter values reflect recordOutboxDelivery calls
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/metrics/prometheus — counter values', () => {
  beforeEach(() => { mockCurrentUser = { uid: 'admin1', role: 'admin' }; });

  test('sent counter reflects per-channel counts exactly', async () => {
    recordOutboxDelivery('sms',      'sent', 100);
    recordOutboxDelivery('sms',      'sent', 200);
    recordOutboxDelivery('telegram', 'sent', 50);

    const res = await supertest(buildApp()).get('/api/metrics/prometheus');
    expect(res.text).toMatch(/rez_outbox_sent_total\{channel="sms"\} 2/);
    expect(res.text).toMatch(/rez_outbox_sent_total\{channel="telegram"\} 1/);
    expect(res.text).toMatch(/rez_outbox_sent_total\{channel="web_push"\} 0/);
  });

  test('failed + dead counters emitted for all 5 channels even when zero', async () => {
    const res = await supertest(buildApp()).get('/api/metrics/prometheus');
    for (const ch of ['web_push', 'sms', 'telegram', 'webhook', 'email']) {
      expect(res.text).toMatch(new RegExp(`rez_outbox_failed_total\\{channel="${ch}"\\} 0`));
      expect(res.text).toMatch(new RegExp(`rez_outbox_dead_total\\{channel="${ch}"\\} 0`));
    }
  });

  test('failed counter increments when outcome=failed recorded', async () => {
    recordOutboxDelivery('email', 'failed', 300);
    recordOutboxDelivery('email', 'failed', 400);
    const res = await supertest(buildApp()).get('/api/metrics/prometheus');
    expect(res.text).toMatch(/rez_outbox_failed_total\{channel="email"\} 2/);
    // And sent stays zero for email.
    expect(res.text).toMatch(/rez_outbox_sent_total\{channel="email"\} 0/);
  });

  test('dead counter increments when outcome=dead recorded', async () => {
    recordOutboxDelivery('webhook', 'dead', 5000);
    const res = await supertest(buildApp()).get('/api/metrics/prometheus');
    expect(res.text).toMatch(/rez_outbox_dead_total\{channel="webhook"\} 1/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// duration summary lines
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/metrics/prometheus — duration summary', () => {
  beforeEach(() => { mockCurrentUser = { uid: 'admin1', role: 'admin' }; });

  test('emits p50/p95/p99 quantile lines + count when samples present', async () => {
    // 100 samples 1..100ms on sms: p50=50, p95=95, p99=99.
    for (let i = 1; i <= 100; i++) recordOutboxDelivery('sms', 'sent', i);
    const res = await supertest(buildApp()).get('/api/metrics/prometheus');
    expect(res.text).toMatch(/rez_outbox_send_duration_milliseconds\{channel="sms",quantile="0\.5"\} 50/);
    expect(res.text).toMatch(/rez_outbox_send_duration_milliseconds\{channel="sms",quantile="0\.95"\} 95/);
    expect(res.text).toMatch(/rez_outbox_send_duration_milliseconds\{channel="sms",quantile="0\.99"\} 99/);
    expect(res.text).toMatch(/rez_outbox_send_duration_milliseconds_count\{channel="sms"\} 100/);
  });

  test('emits NaN quantiles when no samples recorded for channel', async () => {
    // Record on sms so overall block is emitted, but email has no samples.
    recordOutboxDelivery('sms', 'sent', 10);
    const res = await supertest(buildApp()).get('/api/metrics/prometheus');
    expect(res.text).toMatch(/rez_outbox_send_duration_milliseconds\{channel="email",quantile="0\.5"\} NaN/);
    expect(res.text).toMatch(/rez_outbox_send_duration_milliseconds_count\{channel="email"\} 0/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// backward compatibility — pre-existing metrics still emitted
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/metrics/prometheus — baseline metrics preserved', () => {
  beforeEach(() => { mockCurrentUser = { uid: 'admin1', role: 'admin' }; });

  test('still emits auth + db + http baseline metric families', async () => {
    const res = await supertest(buildApp()).get('/api/metrics/prometheus');
    expect(res.text).toMatch(/# TYPE rez_auth_refresh_requests_total counter/);
    expect(res.text).toMatch(/# TYPE rez_db_pool_total gauge/);
    expect(res.text).toMatch(/# TYPE rez_http_request_duration_milliseconds summary/);
    expect(res.text).toMatch(/rez_db_pool_total 2/);
    expect(res.text).toMatch(/rez_db_pool_idle 1/);
  });
});
