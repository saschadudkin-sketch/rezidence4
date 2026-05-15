'use strict';

jest.mock('../logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  fatal: jest.fn(),
}));

jest.mock('../sse', () => ({
  broadcastRequestUpdate: jest.fn(),
}));

jest.mock('../services/notificationService', () => ({
  dispatch: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/webhookService', () => ({
  processPendingDeliveries: jest.fn().mockResolvedValue(undefined),
}));

const {
  startRuntimeJobs,
  startRuntimeJobsRunner,
  runForActiveProperties,
} = require('../server/runtimeJobs');

/**
 * Build a db.query mock that routes by SQL fragment, so noisy background jobs
 * (otp cleanup, billing overdue, meter reminders, webhook delivery, etc.)
 * return innocuous empty results and only the expiration/activation interval
 * produces the rows we care about for the assertion.
 */
function makeDbMock({ activatedRows = [], expiredRows = [] } = {}) {
  return {
    query: jest.fn(async (sql) => {
      if (typeof sql !== 'string') return { rows: [], rowCount: 0 };
      // Scheduled activation — the case under test
      if (sql.includes("THEN 'approved'")) return { rows: activatedRows, rowCount: activatedRows.length };
      // Expiration
      if (sql.includes("'expired'")) return { rows: expiredRows, rowCount: expiredRows.length };
      // Everything else: empty result
      return { rows: [], rowCount: 0 };
    }),
  };
}

describe('runtimeJobs scheduled activation', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  test('resident scheduled once pass activates as approved', async () => {
    const activatedRow = {
      id: 'r1',
      type: 'pass',
      category: 'guest',
      status: 'approved',
      created_by_uid: 'u1',
      created_by_name: 'Owner',
      created_by_role: 'owner',
      created_by_apt: '12',
      visitor_name: 'Guest',
      visitor_phone: null,
      car_plate: null,
      comment: '',
      pass_duration: 'once',
      valid_until: null,
      scheduled_for: null,
      arrived_at: null,
      photos: [],
      created_at: new Date(),
      updated_at: new Date(),
    };

    const db = makeDbMock({ activatedRows: [activatedRow] });
    const jobs = startRuntimeJobs({ db });

    // expirationJob runs every 5 min — advance just past the first tick
    await jest.advanceTimersByTimeAsync(5 * 60 * 1000);

    // The activation UPDATE was issued with the FOR UPDATE SKIP LOCKED lock
    // and the CASE expression that approves passes.
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('FOR UPDATE SKIP LOCKED'));
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("THEN 'approved'"));

    // And the resulting row was broadcast via SSE
    const { broadcastRequestUpdate } = require('../sse');
    expect(broadcastRequestUpdate).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1', status: 'approved' }));

    jobs.stop();
  });
});

describe('runtimeJobs multi-tenant runner', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  test('runForActiveProperties executes a job per active property pool', async () => {
    const platformDb = {
      query: jest.fn().mockResolvedValue({
        rows: [
          { id: 'p-a', slug: 'alpha', db_connection_url: 'pg://alpha' },
          { id: 'p-b', slug: 'beta', db_connection_url: 'pg://beta' },
        ],
      }),
    };
    const poolA = makeDbMock();
    const poolB = makeDbMock();
    const getPool = jest.fn((property) => (property.slug === 'alpha' ? poolA : poolB));
    const jobFn = jest.fn().mockResolvedValue(undefined);

    const results = await runForActiveProperties({
      platformDb,
      getPool,
      jobName: 'unit_test_job',
      jobFn,
    });

    expect(platformDb.query).toHaveBeenCalledWith(expect.stringContaining('WHERE is_active = true'));
    expect(getPool).toHaveBeenCalledTimes(2);
    expect(jobFn).toHaveBeenNthCalledWith(1, poolA, expect.objectContaining({ slug: 'alpha' }));
    expect(jobFn).toHaveBeenNthCalledWith(2, poolB, expect.objectContaining({ slug: 'beta' }));
    expect(results).toEqual([
      { slug: 'alpha', ok: true },
      { slug: 'beta', ok: true },
    ]);
  });

  test('startRuntimeJobsRunner uses multi-tenant mode when platform DB is available', () => {
    const platformDb = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const getPool = jest.fn();
    const jobs = startRuntimeJobsRunner({ platformDb, getPool, fallbackDb: makeDbMock() });

    try {
      expect(jobs.started).toBe(true);
      expect(jobs.mode).toBe('multi-tenant');
    } finally {
      jobs.stop();
    }
  });
});
