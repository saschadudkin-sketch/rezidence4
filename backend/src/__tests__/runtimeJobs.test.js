'use strict';

jest.mock('../logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../sse', () => ({
  broadcastRequestUpdate: jest.fn(),
}));

const { startRuntimeJobs } = require('../server/runtimeJobs');

describe('runtimeJobs scheduled activation', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  test('resident scheduled once pass activates as approved', async () => {
    const db = {
      query: jest.fn()
        .mockResolvedValueOnce({ rowCount: 0 })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{
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
          }],
        })
        .mockResolvedValueOnce({ rowCount: 0 }),
    };

    const jobs = startRuntimeJobs({ db });
    await jest.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("THEN 'approved'"));
    jobs.stop();
  });
});
