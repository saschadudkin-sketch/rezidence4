'use strict';

const {
  describe, test, expect, jest: jestApi,
} = require('@jest/globals');

const {
  getOperationsDashboard,
  parsePeriod,
} = require('../v1/services/operationsDashboard');

const PROPERTY_ID = '11111111-2222-3333-4444-555555555555';

function makeDb(overrides = []) {
  return {
    query: jestApi.fn(async (sql, args) => {
      for (const [needle, result] of overrides) {
        if (needle instanceof RegExp && needle.test(sql)) {
          return typeof result === 'function' ? result(sql, args) : result;
        }
        if (typeof needle === 'string' && sql.includes(needle)) {
          return typeof result === 'function' ? result(sql, args) : result;
        }
      }
      return { rows: [] };
    }),
  };
}

describe('parsePeriod', () => {
  test('defaults to 7d and accepts whitelist values', () => {
    expect(parsePeriod(undefined)).toMatchObject({ key: '7d', hours: 168 });
    expect(parsePeriod('24h')).toMatchObject({ key: '24h', hours: 24 });
    expect(parsePeriod('30d')).toMatchObject({ key: '30d', hours: 720 });
  });

  test('rejects unsupported period', () => {
    expect(() => parsePeriod('90d')).toThrow(/unsupported period/);
  });
});

describe('getOperationsDashboard', () => {
  test('aggregates request/access/incident/notification formulas', async () => {
    const db = makeDb([
      [/PERCENTILE_CONT\(0\.5\)[\s\S]*FROM requests[\s\S]*WHERE deleted_at IS NULL/s, {
        rows: [{
          created: '12',
          completed: '7',
          open: '5',
          overdue_backlog: '2',
          resolved_within_sla: '6',
          resolved_with_sla: '8',
          first_response_median_minutes: '14.5',
          resolution_median_minutes: '180',
        }],
      }],
      [/SELECT status, COUNT\(\*\)::int AS total\s+FROM requests/s, {
        rows: [
          { status: 'pending', total: 4 },
          { status: 'completed', total: 7 },
        ],
      }],
      [/SELECT priority, COUNT\(\*\)::int AS total\s+FROM requests/s, {
        rows: [
          { priority: 'emergency', total: 1 },
          { priority: 'normal', total: 11 },
        ],
      }],
      [/FROM access_requests/s, (sql, args) => {
        expect(args).toEqual(['168 hours', PROPERTY_ID]);
        return {
          rows: [{
            created: '10',
            approved: '6',
            rejected: '2',
            pending: '3',
            expired: '1',
          }],
        };
      }],
      [/SELECT\s+COUNT\(\*\) FILTER \([\s\S]*AVG\(EXTRACT\(EPOCH FROM \(created_at - occurred_at\)\)\)[\s\S]*FROM visit_logs_v2/s, {
        rows: [{
          allow_count: '31',
          denial_count: '4',
          vehicle_traffic_count: '18',
          avg_decision_sample_count: '9',
          avg_decision_seconds: '22.5',
        }],
      }],
      [/FROM passes/s, {
        rows: [{ active: '22', used: '9' }],
      }],
      [/FROM visit_logs_v2 vl[\s\S]*LEFT JOIN access_points/s, {
        rows: [{
          access_point_id: 'point-1',
          name: 'КПП Север',
          allow_count: '12',
          denial_count: '2',
          total: '14',
        }],
      }],
      [/provider_payload->>'reason'/s, {
        rows: [{ reason: 'expired_pass', total: 3 }],
      }],
      [/date_trunc\('hour', occurred_at\)/s, {
        rows: [{ window_start: '2026-05-16T08:00:00.000Z', total: 15 }],
      }],
      [/FROM access_overrides/s, {
        rows: [{ override_type: 'manual_admit', total: 5 }],
      }],
      [/FROM security_offline_replay_events/s, {
        rows: [{ replay_status: 'accepted', total: 2 }],
      }],
      [/FROM trusted_visitors tv/s, (sql) => {
        expect(sql).toMatch(/COUNT\(DISTINCT tv\.id\) FILTER \(WHERE tv\.is_active = true\)/);
        expect(sql).toMatch(/COUNT\(DISTINCT ar\.id\) FILTER/);
        return { rows: [{ active: '7', passes_created: '4' }] };
      }],
      [/FROM skud_integration_events sie/s, {
        rows: [{ failed_events: '3', manual_control_events: '6' }],
      }],
      [/PERCENTILE_CONT\(0\.5\)[\s\S]*FROM access_incidents[\s\S]*WHERE property_id/s, {
        rows: [{
          open: '3',
          investigating: '2',
          closed: '8',
          high_priority_open: '1',
          blacklist_hits: '2',
          suspicious_attempts: '5',
          resolution_median_minutes: '42',
        }],
      }],
      [/SELECT incident_type, COUNT\(\*\)::int AS total\s+FROM access_incidents/s, {
        rows: [{ incident_type: 'blacklist_hit', total: 2 }],
      }],
      [/SELECT\s+COUNT\(\*\) FILTER \(WHERE status = 'pending'\)[\s\S]*FROM notifications_outbox/s, {
        rows: [{
          pending: '4',
          in_flight: '1',
          sent: '80',
          failed: '3',
          dead: '2',
          oldest_pending_age_seconds: '75.2',
        }],
      }],
      [/SELECT channel,\s+COUNT\(\*\) FILTER \(WHERE status = 'pending'\).*FROM notifications_outbox/s, {
        rows: [
          { channel: 'web_push', pending: '3', in_flight: '0', sent: '50', failed: '1', dead: '0' },
          { channel: 'sms', pending: '1', in_flight: '1', sent: '30', failed: '2', dead: '2' },
        ],
      }],
      [/SELECT event_type, COUNT\(\*\)::int AS total\s+FROM notifications_outbox/s, {
        rows: [{ event_type: 'package.received', total: 20 }],
      }],
      [/SELECT\s+COUNT\(\*\) FILTER \(WHERE status = 'sent'\)[\s\S]*FROM notification_log_v2/s, {
        rows: [{ sent: '90', failed: '10' }],
      }],
      [/FROM notification_log_v2\s+.*GROUP BY channel/s, {
        rows: [
          { channel: 'sms', sent: '10', failed: '5' },
          { channel: 'web_push', sent: '80', failed: '5' },
        ],
      }],
    ]);

    const out = await getOperationsDashboard(db, {
      propertyId: PROPERTY_ID,
      period: '7d',
    });

    expect(out.property_id).toBe(PROPERTY_ID);
    expect(out.period).toEqual({ key: '7d', hours: 168 });
    expect(out.requests).toMatchObject({
      created: 12,
      completed: 7,
      open: 5,
      overdue_backlog: 2,
      sla_compliance_rate: 0.75,
      first_response_median_minutes: 14.5,
      resolution_median_minutes: 180,
    });
    expect(out.requests.by_status).toEqual([
      { status: 'pending', total: 4 },
      { status: 'completed', total: 7 },
    ]);
    expect(out.access).toMatchObject({
      requests_created: 10,
      requests_approved: 6,
      requests_rejected: 2,
      approval_rate: 0.75,
      allow_count: 31,
      denial_count: 4,
      vehicle_traffic_count: 18,
      avg_decision_sample_count: 9,
      avg_decision_seconds: 22.5,
      active_passes: 22,
      manual_override_count: 5,
      offline_replay_count: 2,
      trusted_visitors_active: 7,
      trusted_visitor_passes_created: 4,
      skud_failed_events: 3,
      skud_manual_control_count: 6,
    });
    expect(out.access.by_access_point).toEqual([{
      access_point_id: 'point-1',
      name: 'КПП Север',
      allow_count: 12,
      denial_count: 2,
      total: 14,
    }]);
    expect(out.access.deny_reasons).toEqual([{ reason: 'expired_pass', total: 3 }]);
    expect(out.access.peak_traffic_windows).toEqual([{ window_start: '2026-05-16T08:00:00.000Z', total: 15 }]);
    expect(out.access.manual_overrides_by_type).toEqual([{ override_type: 'manual_admit', total: 5 }]);
    expect(out.access.offline_replay_by_status).toEqual([{ replay_status: 'accepted', total: 2 }]);
    expect(out.incidents).toMatchObject({
      open: 3,
      investigating: 2,
      closed: 8,
      high_priority_open: 1,
      blacklist_hits: 2,
      suspicious_attempts: 5,
      resolution_median_minutes: 42,
    });
    expect(out.notifications).toMatchObject({
      sent: 90,
      failed: 10,
      success_rate: 0.9,
      queue: {
        pending: 4,
        in_flight: 1,
        sent: 80,
        failed: 3,
        dead: 2,
      },
      oldest_pending_age_seconds: 75,
    });
  });

  test('requires propertyId and db', async () => {
    await expect(getOperationsDashboard(null, { propertyId: PROPERTY_ID }))
      .rejects.toThrow(/db with query/);
    await expect(getOperationsDashboard(makeDb(), {}))
      .rejects.toThrow(/propertyId required/);
  });
});
