import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  getMock,
  postMock,
} = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
}));

vi.mock('./client', () => ({
  v1Client: {
    get: getMock,
    post: postMock,
  },
}));

import { adminOutboxApi } from './adminOutbox';

describe('adminOutboxApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('routes list and observability snapshots through canonical v1 endpoints', async () => {
    getMock.mockResolvedValue({});

    await adminOutboxApi.list({
      status: 'failed',
      channel: 'email',
      from: '2026-05-01T00:00:00.000Z',
      to: '2026-05-02T00:00:00.000Z',
      q: 'package',
      limit: 25,
      offset: 50,
    });
    await adminOutboxApi.metrics();
    await adminOutboxApi.sla();
    await adminOutboxApi.health();

    expect(getMock).toHaveBeenNthCalledWith(
      1,
      '/admin/outbox?status=failed&channel=email&from=2026-05-01T00%3A00%3A00.000Z&to=2026-05-02T00%3A00%3A00.000Z&q=package&limit=25&offset=50',
      undefined,
    );
    expect(getMock).toHaveBeenNthCalledWith(2, '/admin/outbox/metrics', undefined);
    expect(getMock).toHaveBeenNthCalledWith(3, '/admin/outbox/sla', undefined);
    expect(getMock).toHaveBeenNthCalledWith(4, '/notifications/outbox/health', undefined);
  });

  test('routes retry and per-row actions with encoded ids', async () => {
    getMock.mockResolvedValue({});
    postMock.mockResolvedValue({});

    await adminOutboxApi.retry({ status: 'dead', limit: 10 });
    await adminOutboxApi.getById('outbox/1');
    await adminOutboxApi.requeue('outbox/1');
    await adminOutboxApi.cancel('outbox/1');

    expect(postMock).toHaveBeenNthCalledWith(
      1,
      '/notifications/outbox/retry',
      { status: 'dead', limit: 10 },
      undefined,
    );
    expect(getMock).toHaveBeenCalledWith('/admin/outbox/outbox%2F1', undefined);
    expect(postMock).toHaveBeenNthCalledWith(
      2,
      '/admin/outbox/outbox%2F1/requeue',
      undefined,
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      3,
      '/admin/outbox/outbox%2F1/cancel',
      undefined,
      undefined,
    );
  });
});
