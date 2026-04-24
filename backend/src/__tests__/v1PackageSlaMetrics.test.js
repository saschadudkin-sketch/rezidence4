'use strict';

// Phase 5 — packageSla observability service tests.
// Spec: packages-v2-spec.md §5 (SLA reminders + auto-return).
//
// Scope:
//   • getPackageSlaSnapshot — guard'ы, SQL shape, int coercion
//   • renderSlaAsPrometheus — 6 gauge'ей, HELP/TYPE, property label

const {
  describe, test, expect, jest: jestApi,
} = require('@jest/globals');

const {
  getPackageSlaSnapshot,
  renderSlaAsPrometheus,
  AUTO_RETURN_REASON_PATTERN,
} = require('../v1/services/packageSla');

// ══════════════════════════════════════════════════════════════════════════════
// getPackageSlaSnapshot
// ══════════════════════════════════════════════════════════════════════════════

describe('getPackageSlaSnapshot', () => {
  test('throws when db missing .query', async () => {
    await expect(getPackageSlaSnapshot(null)).rejects.toThrow(/db with \.query/);
    await expect(getPackageSlaSnapshot({})).rejects.toThrow(/db with \.query/);
  });

  test('throws when returnDays <= remindDays', async () => {
    const db = { query: jestApi.fn() };
    await expect(
      getPackageSlaSnapshot(db, { remindDays: 7, returnDays: 7 }),
    ).rejects.toThrow(/returnDays > remindDays/);
    await expect(
      getPackageSlaSnapshot(db, { remindDays: 0, returnDays: 14 }),
    ).rejects.toThrow(/remindDays > 0/);
  });

  test('fires 2 queries with expected shape and coerces BIGINT strings', async () => {
    const query = jestApi.fn()
      // packages_v2 aggregate — pg BIGINT comes back as string; make sure we coerce.
      .mockResolvedValueOnce({
        rows: [{
          awaiting_pickup_total: '42',
          awaiting_pickup_over_remind: '3',
          awaiting_pickup_over_return: '0',
          auto_returned_24h: '5',
          received_24h: '17',
        }],
      })
      // outbox aggregate.
      .mockResolvedValueOnce({
        rows: [{ reminders_sent_24h: '8' }],
      });

    const snap = await getPackageSlaSnapshot({ query });

    expect(snap).toMatchObject({
      awaiting_pickup_total: 42,
      awaiting_pickup_over_7d: 3,
      awaiting_pickup_over_14d: 0,
      auto_returned_24h: 5,
      reminders_sent_24h: 8,
      received_24h: 17,
      thresholds: { remind_days: 7, return_days: 14 },
    });
    expect(snap.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Первый запрос — FROM packages_v2 + FILTER для каждого gauge.
    const [sql1, args1] = query.mock.calls[0];
    expect(sql1).toMatch(/FROM packages_v2/);
    expect(sql1).toMatch(/status = 'awaiting_pickup'/);
    expect(sql1).toMatch(/returned_reason ILIKE/);
    expect(sql1).toMatch(/INTERVAL '24 hours'/);
    // args = [remindDays, returnDays, auto-return-reason-pattern]
    expect(args1).toEqual(['7', '14', AUTO_RETURN_REASON_PATTERN]);

    // Второй запрос — outbox reminder count.
    const [sql2] = query.mock.calls[1];
    expect(sql2).toMatch(/FROM notifications_outbox/);
    expect(sql2).toMatch(/event_type = 'package\.pickup_reminder'/);
    expect(sql2).toMatch(/INTERVAL '24 hours'/);
  });

  test('handles empty rows (fresh tenant) without crash', async () => {
    const query = jestApi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const snap = await getPackageSlaSnapshot({ query });
    expect(snap).toMatchObject({
      awaiting_pickup_total: 0,
      awaiting_pickup_over_7d: 0,
      awaiting_pickup_over_14d: 0,
      auto_returned_24h: 0,
      reminders_sent_24h: 0,
      received_24h: 0,
    });
  });

  test('honors custom thresholds', async () => {
    const query = jestApi.fn()
      .mockResolvedValueOnce({ rows: [{}] })
      .mockResolvedValueOnce({ rows: [{}] });

    const snap = await getPackageSlaSnapshot(
      { query },
      { remindDays: 3, returnDays: 10 },
    );
    expect(snap.thresholds).toEqual({ remind_days: 3, return_days: 10 });
    expect(query.mock.calls[0][1]).toEqual([
      '3', '10', AUTO_RETURN_REASON_PATTERN,
    ]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// renderSlaAsPrometheus
// ══════════════════════════════════════════════════════════════════════════════

describe('renderSlaAsPrometheus', () => {
  const snap = {
    awaiting_pickup_total:    10,
    awaiting_pickup_over_7d:  3,
    awaiting_pickup_over_14d: 1,
    auto_returned_24h:        2,
    reminders_sent_24h:       4,
    received_24h:             5,
    thresholds: { remind_days: 7, return_days: 14 },
    generated_at: '2026-04-24T00:00:00.000Z',
  };

  test('renders 6 gauges with HELP + TYPE', () => {
    const out = renderSlaAsPrometheus(snap, { propertySlug: 'zamosk' });

    expect(out).toMatch(/# HELP package_sla_awaiting_pickup /);
    expect(out).toMatch(/# TYPE package_sla_awaiting_pickup gauge/);
    expect(out).toMatch(/package_sla_awaiting_pickup\{property="zamosk"\} 10/);
    expect(out).toMatch(/package_sla_awaiting_pickup_over_7d\{property="zamosk"\} 3/);
    expect(out).toMatch(/package_sla_awaiting_pickup_over_14d\{property="zamosk"\} 1/);
    expect(out).toMatch(/package_sla_auto_returned_24h\{property="zamosk"\} 2/);
    expect(out).toMatch(/package_sla_reminders_sent_24h\{property="zamosk"\} 4/);
    expect(out).toMatch(/package_sla_received_24h\{property="zamosk"\} 5/);
    // Trailing newline — Prometheus требует.
    expect(out.endsWith('\n')).toBe(true);
  });

  test('omits property label when slug is empty/missing', () => {
    const out = renderSlaAsPrometheus(snap);
    // Без labels на всех 6 строках.
    expect(out).toMatch(/package_sla_awaiting_pickup 10/);
    expect(out).not.toMatch(/property=/);
  });

  test('escapes label values containing quotes/backslashes', () => {
    const out = renderSlaAsPrometheus(snap, { propertySlug: 'bad"slug\\here' });
    // Двойные кавычки и backslash должны быть escaped.
    expect(out).toMatch(/property="bad\\"slug\\\\here"/);
  });

  test('coerces NaN/null values to 0', () => {
    const broken = {
      awaiting_pickup_total:    null,
      awaiting_pickup_over_7d:  undefined,
      awaiting_pickup_over_14d: NaN,
      auto_returned_24h:        'not-a-number',
      reminders_sent_24h:       0,
      received_24h:             0,
    };
    const out = renderSlaAsPrometheus(broken, { propertySlug: 'x' });
    // Все 6 gauge'ей должны быть 0, без NaN в output'е.
    expect(out).not.toMatch(/NaN/);
    expect(out).toMatch(/package_sla_awaiting_pickup\{property="x"\} 0/);
  });
});
