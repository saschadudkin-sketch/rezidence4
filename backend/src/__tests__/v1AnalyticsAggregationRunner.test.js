'use strict';

const {
  describe, test, expect, beforeEach, afterEach, jest: jestApi,
} = require('@jest/globals');

const runner = require('../v1/workers/analyticsAggregationRunner');

function makeDb(rows = []) {
  return {
    query: jestApi.fn().mockResolvedValue({ rows, rowCount: rows.length }),
  };
}

function makeLogger() {
  return {
    info: jestApi.fn(),
    warn: jestApi.fn(),
    error: jestApi.fn(),
    debug: jestApi.fn(),
  };
}

const ORIGINAL_ENV = process.env.ANALYTICS_AGGREGATION_ENABLED;

beforeEach(() => {
  jestApi.clearAllMocks();
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.ANALYTICS_AGGREGATION_ENABLED;
  } else {
    process.env.ANALYTICS_AGGREGATION_ENABLED = ORIGINAL_ENV;
  }
  jestApi.useRealTimers();
});

describe('analytics aggregation runner', () => {
  test('listAnalyticsProperties filters by analytics flag and package plan', async () => {
    const platformDb = makeDb([
      {
        id: 'p-ops',
        slug: 'ops',
        db_connection_url: 'postgres://ops',
        feature_flags: { analytics: true },
        plan: 'operations',
      },
      {
        id: 'p-core',
        slug: 'core',
        db_connection_url: 'postgres://core',
        feature_flags: { analytics: true },
        plan: 'core_access',
      },
      {
        id: 'p-enterprise-off',
        slug: 'enterprise-off',
        db_connection_url: 'postgres://off',
        feature_flags: {},
        plan: 'enterprise',
      },
      {
        id: 'p-enterprise-on',
        slug: 'enterprise-on',
        db_connection_url: 'postgres://on',
        feature_flags: '{"analytics":true}',
        plan: 'enterprise',
      },
    ]);

    const properties = await runner.listAnalyticsProperties(platformDb);

    expect(properties.map((p) => p.slug)).toEqual(['ops', 'enterprise-on']);
    const [[sql]] = platformDb.query.mock.calls;
    expect(sql).toMatch(/FROM\s+properties/i);
    expect(sql).toMatch(/is_active\s*=\s*true/i);
    expect(sql).toMatch(/ORDER\s+BY\s+slug/i);
  });

  test('tickAllProperties isolates tenant failures', async () => {
    const platformDb = makeDb([
      { id: 'p-a', slug: 'a', feature_flags: { analytics: true }, plan: 'operations' },
      { id: 'p-b', slug: 'b', feature_flags: { analytics: true }, plan: 'operations' },
    ]);
    const goodPool = makeDb();
    const badPool = makeDb();
    const getPool = jestApi.fn((property) => {
      if (property.slug === 'b') throw new Error('pool unavailable');
      return goodPool;
    });
    const materializeFn = jestApi.fn().mockResolvedValue({
      snapshot: { id: 'snap-a', period: '7d', row_count: 2 },
      metrics: [{}, {}],
    });
    const logger = makeLogger();

    const results = await runner.tickAllProperties({
      platformDb,
      getPool,
      periods: ['7d'],
      logger,
      materializeFn,
    });

    expect(results).toEqual([
      { slug: 'a', snapshots: [{ id: 'snap-a', period: '7d', row_count: 2 }] },
      { slug: 'b', error: 'pool unavailable' },
    ]);
    expect(materializeFn).toHaveBeenCalledWith(goodPool, {
      propertyId: 'p-a',
      period: '7d',
      generatedBy: 'job',
    });
    expect(logger.error).toHaveBeenCalled();
    expect(badPool.query).not.toHaveBeenCalled();
  });

  test('startAnalyticsAggregationRunner respects env gate and starts single-tenant mode', () => {
    jestApi.useFakeTimers();
    process.env.ANALYTICS_AGGREGATION_ENABLED = 'false';
    const logger = makeLogger();

    const disabled = runner.startAnalyticsAggregationRunner({ logger });
    expect(disabled).toMatchObject({ started: false, mode: 'disabled', reason: 'flag_disabled' });

    process.env.ANALYTICS_AGGREGATION_ENABLED = 'true';
    const materializeFn = jestApi.fn().mockResolvedValue({
      snapshot: { id: 'snap-1', period: '24h', row_count: 1 },
      metrics: [{}],
    });
    const fallbackDb = makeDb();
    const started = runner.startAnalyticsAggregationRunner({
      fallbackDb,
      intervalMs: 1000,
      periods: ['24h'],
      logger,
      materializeFn,
    });

    expect(started).toMatchObject({ started: true, mode: 'single-tenant' });
    expect(jestApi.getTimerCount()).toBe(1);
    started.stop();
    expect(jestApi.getTimerCount()).toBe(0);
  });
});
