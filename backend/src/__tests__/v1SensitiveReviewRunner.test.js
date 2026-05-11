'use strict';

const {
  describe, test, expect, beforeEach, afterEach, jest: jestApi,
} = require('@jest/globals');

const runner = require('../v1/workers/sensitiveReviewRunner');

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

const ORIGINAL_ENV = process.env.SENSITIVE_REVIEW_RUNNER_ENABLED;

beforeEach(() => {
  jestApi.clearAllMocks();
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.SENSITIVE_REVIEW_RUNNER_ENABLED;
  } else {
    process.env.SENSITIVE_REVIEW_RUNNER_ENABLED = ORIGINAL_ENV;
  }
  jestApi.useRealTimers();
});

describe('sensitive review runner', () => {
  test('tickSingleTenant samples and escalates in one maintenance pass', async () => {
    const db = makeDb();
    const materializeFn = jestApi.fn().mockResolvedValue([{ id: 'sampled-1' }]);
    const escalateFn = jestApi.fn().mockResolvedValue([
      { id: 'review-1', escalation_status: 'overdue' },
      { id: 'review-2', escalation_status: 'escalated' },
    ]);

    const stats = await runner.tickSingleTenant(db, {
      propertyId: 'property-1',
      batchSize: 5,
      windowHours: 24,
      samplePercent: 20,
      dueHours: 48,
      escalateAfterHours: 12,
      materializeFn,
      escalateFn,
    });

    expect(stats).toEqual({ sampled: 1, overdue: 1, escalated: 1 });
    expect(materializeFn).toHaveBeenCalledWith({
      queryable: db,
      filters: { property_id: 'property-1' },
      options: { limit: 5, windowHours: 24, samplePercent: 20, dueHours: 48 },
    });
    expect(escalateFn).toHaveBeenCalledWith({
      queryable: db,
      filters: { property_id: 'property-1' },
      options: { limit: 5, escalateAfterHours: 12 },
    });
  });

  test('tickAllProperties isolates tenant failures', async () => {
    const platformDb = makeDb([
      { id: 'p-a', slug: 'a' },
      { id: 'p-b', slug: 'b' },
    ]);
    const goodPool = makeDb();
    const getPool = jestApi.fn((property) => {
      if (property.slug === 'b') throw new Error('pool unavailable');
      return goodPool;
    });
    const logger = makeLogger();
    const materializeFn = jestApi.fn().mockResolvedValue([]);
    const escalateFn = jestApi.fn().mockResolvedValue([{ id: 'r1', escalation_status: 'overdue' }]);

    const results = await runner.tickAllProperties({
      platformDb,
      getPool,
      logger,
      materializeFn,
      escalateFn,
    });

    expect(results).toEqual([
      { slug: 'a', sampled: 0, overdue: 1, escalated: 0 },
      { slug: 'b', error: 'pool unavailable' },
    ]);
    expect(logger.error).toHaveBeenCalled();
  });

  test('startSensitiveReviewRunner respects env gate and starts single-tenant mode', () => {
    jestApi.useFakeTimers();
    const logger = makeLogger();

    process.env.SENSITIVE_REVIEW_RUNNER_ENABLED = 'false';
    const disabled = runner.startSensitiveReviewRunner({ logger });
    expect(disabled).toMatchObject({ started: false, mode: 'disabled', reason: 'flag_disabled' });

    process.env.SENSITIVE_REVIEW_RUNNER_ENABLED = 'true';
    const started = runner.startSensitiveReviewRunner({
      fallbackDb: makeDb(),
      intervalMs: 1000,
      logger,
      materializeFn: jestApi.fn().mockResolvedValue([]),
      escalateFn: jestApi.fn().mockResolvedValue([]),
    });

    expect(started).toMatchObject({ started: true, mode: 'single-tenant' });
    expect(jestApi.getTimerCount()).toBe(1);
    started.stop();
    expect(jestApi.getTimerCount()).toBe(0);
  });
});
