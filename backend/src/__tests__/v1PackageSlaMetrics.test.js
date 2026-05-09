'use strict';

// Phase 5 — packageSla observability service tests.
// Spec: packages-v2-spec.md §5 (SLA reminders + follow-up/admin alerts).

const {
  describe, test, expect, jest: jestApi,
} = require('@jest/globals');

const {
  getPackageSlaSnapshot,
  renderSlaAsPrometheus,
  PICKUP_REMINDER_EVENT_TYPE,
  FOLLOWUP_EVENT_TYPE,
  ADMIN_ALERT_EVENT_TYPE,
} = require('../v1/services/packageSla');

describe('getPackageSlaSnapshot', () => {
  test('throws when db missing .query', async () => {
    await expect(getPackageSlaSnapshot(null)).rejects.toThrow(/db with \.query/);
    await expect(getPackageSlaSnapshot({})).rejects.toThrow(/db with \.query/);
  });

  test('throws when thresholds are inverted', async () => {
    const db = { query: jestApi.fn() };
    await expect(
      getPackageSlaSnapshot(db, { remindDays: 7, followupDays: 7 }),
    ).rejects.toThrow(/followupDays > remindDays/);
    await expect(
      getPackageSlaSnapshot(db, { remindDays: 0, followupDays: 14 }),
    ).rejects.toThrow(/remindDays > 0/);
    await expect(
      getPackageSlaSnapshot(db, { remindDays: 7, followupDays: 14, adminAlertDays: 14 }),
    ).rejects.toThrow(/adminAlertDays > followupDays/);
  });

  test('fires 2 queries with expected shape and coerces BIGINT strings', async () => {
    const query = jestApi.fn()
      .mockResolvedValueOnce({
        rows: [{
          awaiting_pickup_total: '42',
          awaiting_pickup_over_remind: '3',
          awaiting_pickup_over_followup: '2',
          awaiting_pickup_over_admin_alert: '1',
          received_24h: '17',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          reminders_sent_24h: '8',
          followups_sent_24h: '5',
          admin_alerts_sent_24h: '2',
        }],
      });

    const snap = await getPackageSlaSnapshot({ query });

    expect(snap).toMatchObject({
      awaiting_pickup_total: 42,
      awaiting_pickup_over_7d: 3,
      awaiting_pickup_over_14d: 2,
      awaiting_pickup_over_30d: 1,
      reminders_sent_24h: 8,
      followups_sent_24h: 5,
      admin_alerts_sent_24h: 2,
      received_24h: 17,
      thresholds: { remind_days: 7, followup_days: 14, admin_alert_days: 30 },
    });
    expect(snap.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const [sql1, args1] = query.mock.calls[0];
    expect(sql1).toMatch(/FROM packages_v2/);
    expect(sql1).toMatch(/status = 'awaiting_pickup'/);
    expect(sql1).toMatch(/INTERVAL '24 hours'/);
    expect(args1).toEqual(['7', '14', '30']);

    const [sql2, args2] = query.mock.calls[1];
    expect(sql2).toMatch(/FROM notifications_outbox/);
    expect(sql2).toMatch(/event_type = ANY/);
    expect(sql2).toMatch(/INTERVAL '24 hours'/);
    expect(args2).toEqual([
      PICKUP_REMINDER_EVENT_TYPE,
      FOLLOWUP_EVENT_TYPE,
      ADMIN_ALERT_EVENT_TYPE,
      [PICKUP_REMINDER_EVENT_TYPE, FOLLOWUP_EVENT_TYPE, ADMIN_ALERT_EVENT_TYPE],
    ]);
  });

  test('handles empty rows without crash', async () => {
    const query = jestApi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const snap = await getPackageSlaSnapshot({ query });
    expect(snap).toMatchObject({
      awaiting_pickup_total: 0,
      awaiting_pickup_over_7d: 0,
      awaiting_pickup_over_14d: 0,
      awaiting_pickup_over_30d: 0,
      reminders_sent_24h: 0,
      followups_sent_24h: 0,
      admin_alerts_sent_24h: 0,
      received_24h: 0,
    });
  });

  test('honors custom thresholds and legacy returnDays alias', async () => {
    const query = jestApi.fn()
      .mockResolvedValueOnce({ rows: [{}] })
      .mockResolvedValueOnce({ rows: [{}] });

    const snap = await getPackageSlaSnapshot(
      { query },
      { remindDays: 3, returnDays: 10, adminAlertDays: 20 },
    );
    expect(snap.thresholds).toEqual({
      remind_days: 3,
      followup_days: 10,
      admin_alert_days: 20,
    });
    expect(query.mock.calls[0][1]).toEqual(['3', '10', '20']);
  });
});

describe('renderSlaAsPrometheus', () => {
  const snap = {
    awaiting_pickup_total: 10,
    awaiting_pickup_over_7d: 3,
    awaiting_pickup_over_14d: 2,
    awaiting_pickup_over_30d: 1,
    reminders_sent_24h: 4,
    followups_sent_24h: 5,
    admin_alerts_sent_24h: 6,
    received_24h: 7,
    thresholds: { remind_days: 7, followup_days: 14, admin_alert_days: 30 },
    generated_at: '2026-04-24T00:00:00.000Z',
  };

  test('renders 8 gauges with HELP + TYPE', () => {
    const out = renderSlaAsPrometheus(snap, { propertySlug: 'zamosk' });

    expect(out).toMatch(/# HELP package_sla_awaiting_pickup /);
    expect(out).toMatch(/# TYPE package_sla_awaiting_pickup gauge/);
    expect(out).toMatch(/package_sla_awaiting_pickup\{property="zamosk"\} 10/);
    expect(out).toMatch(/package_sla_awaiting_pickup_over_7d\{property="zamosk"\} 3/);
    expect(out).toMatch(/package_sla_awaiting_pickup_over_14d\{property="zamosk"\} 2/);
    expect(out).toMatch(/package_sla_awaiting_pickup_over_30d\{property="zamosk"\} 1/);
    expect(out).toMatch(/package_sla_reminders_sent_24h\{property="zamosk"\} 4/);
    expect(out).toMatch(/package_sla_followups_sent_24h\{property="zamosk"\} 5/);
    expect(out).toMatch(/package_sla_admin_alerts_sent_24h\{property="zamosk"\} 6/);
    expect(out).toMatch(/package_sla_received_24h\{property="zamosk"\} 7/);
    expect(out).not.toMatch(/auto_return/);
    expect(out.endsWith('\n')).toBe(true);
  });

  test('omits property label when slug is empty/missing', () => {
    const out = renderSlaAsPrometheus(snap);
    expect(out).toMatch(/package_sla_awaiting_pickup 10/);
    expect(out).not.toMatch(/property=/);
  });

  test('escapes label values containing quotes/backslashes', () => {
    const out = renderSlaAsPrometheus(snap, { propertySlug: 'bad"slug\\here' });
    expect(out).toMatch(/property="bad\\"slug\\\\here"/);
  });

  test('coerces NaN/null values to 0', () => {
    const broken = {
      awaiting_pickup_total: null,
      awaiting_pickup_over_7d: undefined,
      awaiting_pickup_over_14d: NaN,
      awaiting_pickup_over_30d: 'not-a-number',
      reminders_sent_24h: 0,
      followups_sent_24h: null,
      admin_alerts_sent_24h: undefined,
      received_24h: 0,
    };
    const out = renderSlaAsPrometheus(broken, { propertySlug: 'x' });
    expect(out).not.toMatch(/NaN/);
    expect(out).toMatch(/package_sla_awaiting_pickup\{property="x"\} 0/);
    expect(out).toMatch(/package_sla_awaiting_pickup_over_30d\{property="x"\} 0/);
    expect(out).toMatch(/package_sla_admin_alerts_sent_24h\{property="x"\} 0/);
  });
});
