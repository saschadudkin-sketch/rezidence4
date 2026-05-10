'use strict';

const {
  describe, test, expect, jest: jestApi,
} = require('@jest/globals');

const {
  flattenOperationsDashboard,
  getLatestPropertyAnalyticsSnapshot,
  materializePropertyAnalyticsSnapshot,
  renderMetricsCsv,
} = require('../v1/services/analyticsAggregationService');

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111';

function dashboard(overrides = {}) {
  return {
    property_id: PROPERTY_ID,
    generated_at: '2026-01-01T00:00:00.000Z',
    period: { key: '7d', hours: 168 },
    requests: {
      created: 12,
      completed: 7,
      open: 5,
      overdue_backlog: 2,
      sla_compliance_rate: 0.75,
      first_response_median_minutes: 14,
      resolution_median_minutes: 180,
      by_status: [{ status: 'pending', total: 5 }],
      by_priority: [{ priority: 'emergency', total: 1 }],
    },
    access: {
      requests_created: 10,
      requests_approved: 6,
      requests_rejected: 2,
      approval_rate: 0.75,
      allow_count: 31,
      denial_count: 4,
      vehicle_traffic_count: 18,
      active_passes: 22,
      used_passes: 9,
    },
    incidents: {
      open: 3,
      investigating: 2,
      closed: 8,
      high_priority_open: 1,
      blacklist_hits: 2,
      suspicious_attempts: 5,
      resolution_median_minutes: 42,
      by_type: [{ incident_type: 'blacklist_hit', total: 2 }],
    },
    notifications: {
      sent: 90,
      failed: 10,
      success_rate: 0.9,
      oldest_pending_age_seconds: 75,
      queue: { pending: 4, failed: 3 },
      per_channel: [{ channel: 'sms', sent: 10, failed: 5, success_rate: 0.67 }],
    },
    ...overrides,
  };
}

describe('analytics aggregation service', () => {
  test('flattens operations dashboard metrics into export-ready rows', () => {
    const rows = flattenOperationsDashboard(dashboard());

    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        metric_group: 'requests',
        metric_key: 'requests.sla_compliance_rate',
        value: 0.75,
        unit: 'ratio',
      }),
      expect.objectContaining({
        metric_group: 'incidents',
        metric_key: 'incidents.blacklist_hits',
        value: 2,
      }),
      expect.objectContaining({
        metric_group: 'notifications',
        metric_key: 'notifications.per_channel.success_rate',
        value: 0.67,
        dimensions: { channel: 'sms' },
      }),
    ]));
  });

  test('renders stable CSV with escaped dimension JSON', () => {
    const csv = renderMetricsCsv([
      {
        property_id: PROPERTY_ID,
        period: '7d',
        generated_at: '2026-01-01T00:00:00.000Z',
        metric_group: 'requests',
        metric_key: 'requests.by_status',
        value: 5,
        unit: 'count',
        dimensions: { status: 'pending, urgent' },
      },
    ]);

    expect(csv).toContain('property_id,period,generated_at,metric_group,metric_key,value,unit,dimensions');
    expect(csv).toContain('"{""status"":""pending, urgent""}"');
  });

  test('materializes dashboard formulas into analytics_kpi_snapshots', async () => {
    const fetchDashboard = jestApi.fn().mockResolvedValue(dashboard());
    const db = {
      query: jestApi.fn(async (_sql, args) => ({
        rows: [{
          id: 'snapshot-1',
          property_id: args[0],
          metric_group: args[1],
          period: args[2],
          window_started_at: args[3],
          window_ended_at: args[4],
          generated_at: args[5],
          generated_by: args[6],
          source_version: args[7],
          payload: args[8],
          flat_rows: args[9],
          row_count: args[10],
          created_at: args[5],
        }],
      })),
    };

    const result = await materializePropertyAnalyticsSnapshot(db, {
      propertyId: PROPERTY_ID,
      period: '7d',
      generatedBy: 'manual',
      generatedAt: '2026-01-08T00:00:00.000Z',
      fetchDashboard,
    });

    expect(fetchDashboard).toHaveBeenCalledWith(db, { propertyId: PROPERTY_ID, period: '7d' });
    const [[sql, params]] = db.query.mock.calls;
    expect(sql).toMatch(/INSERT INTO analytics_kpi_snapshots/i);
    expect(params[0]).toBe(PROPERTY_ID);
    expect(params[2]).toBe('7d');
    expect(params[3]).toBe('2026-01-01T00:00:00.000Z');
    expect(params[4]).toBe('2026-01-08T00:00:00.000Z');
    expect(params[6]).toBe('manual');
    expect(result.snapshot.payload.requests.created).toBe(12);
    expect(result.snapshot.flat_rows).toHaveLength(result.metrics.length);
    expect(result.snapshot.row_count).toBe(result.metrics.length);
  });

  test('reads latest snapshot and normalizes JSONB strings', async () => {
    const db = {
      query: jestApi.fn().mockResolvedValue({
        rows: [{
          id: 'snapshot-1',
          payload: JSON.stringify({ ok: true }),
          flat_rows: JSON.stringify([{ metric_key: 'requests.created', value: 1 }]),
          row_count: '1',
        }],
      }),
    };

    const snapshot = await getLatestPropertyAnalyticsSnapshot(db, {
      propertyId: PROPERTY_ID,
      period: '24h',
    });

    expect(snapshot.payload).toEqual({ ok: true });
    expect(snapshot.flat_rows).toEqual([{ metric_key: 'requests.created', value: 1 }]);
    expect(snapshot.row_count).toBe(1);
    expect(db.query.mock.calls[0][1]).toEqual([PROPERTY_ID, 'operations_dashboard', '24h', 1]);
  });
});
