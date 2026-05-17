import { beforeEach, describe, expect, test, vi } from 'vitest';

const { getMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
}));

vi.mock('./client', () => ({
  v1Client: {
    get: getMock,
  },
}));

import { notificationLogApi } from './notificationLog';

describe('notificationLogApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('routes list, metrics, meta, by id and mine through v1 notification log endpoints', async () => {
    getMock.mockResolvedValue({});

    await notificationLogApi.list({
      recipient_id: 'resident-1',
      channel: 'email',
      status: 'failed',
      since: '2026-05-01T00:00:00.000Z',
      limit: 25,
    });
    await notificationLogApi.metrics('7d');
    await notificationLogApi.meta();
    await notificationLogApi.getById('log/1');
    await notificationLogApi.mine(10);

    expect(getMock).toHaveBeenNthCalledWith(
      1,
      '/admin/notification-log?recipient_id=resident-1&channel=email&status=failed&since=2026-05-01T00%3A00%3A00.000Z&limit=25',
      undefined,
    );
    expect(getMock).toHaveBeenNthCalledWith(
      2,
      '/admin/notification-log/metrics?period=7d',
      undefined,
    );
    expect(getMock).toHaveBeenNthCalledWith(3, '/notification-log/_meta', undefined);
    expect(getMock).toHaveBeenNthCalledWith(
      4,
      '/admin/notification-log/log%2F1',
      undefined,
    );
    expect(getMock).toHaveBeenNthCalledWith(5, '/notification-log/mine?limit=10', undefined);
  });
});
