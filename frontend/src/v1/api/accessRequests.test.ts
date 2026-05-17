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

import { accessRequestsApi } from './accessRequests';

describe('accessRequestsApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('routes list, detail and create through canonical access request endpoints', async () => {
    getMock.mockResolvedValue({});
    postMock.mockResolvedValue({});

    await accessRequestsApi.list({
      property_id: 'property-1',
      status: 'pending_approval',
      request_type: 'guest_access',
      created_by_contractor_user_id: 'contractor-1',
      limit: 20,
    });
    await accessRequestsApi.getById('request/1');
    await accessRequestsApi.create({
      property_id: 'property-1',
      request_type: 'guest_access',
      request_id: 'external-1',
      starts_at: '2026-05-17T08:00:00.000Z',
      ends_at: '2026-05-17T12:00:00.000Z',
      visitor_name: 'Guest',
    });

    expect(getMock).toHaveBeenNthCalledWith(
      1,
      '/access-requests?property_id=property-1&status=pending_approval&request_type=guest_access&created_by_contractor_user_id=contractor-1&limit=20',
      undefined,
    );
    expect(getMock).toHaveBeenNthCalledWith(2, '/access-requests/request%2F1', undefined);
    expect(postMock).toHaveBeenNthCalledWith(
      1,
      '/access-requests',
      {
        property_id: 'property-1',
        request_type: 'guest_access',
        request_id: 'external-1',
        starts_at: '2026-05-17T08:00:00.000Z',
        ends_at: '2026-05-17T12:00:00.000Z',
        visitor_name: 'Guest',
      },
      undefined,
    );
  });

  test('routes lifecycle actions with encoded ids and expected status payloads', async () => {
    postMock.mockResolvedValue({});

    await accessRequestsApi.submit('request/1');
    await accessRequestsApi.approve('request/1', 'ok', { expectedCurrentStatus: 'pending_approval' });
    await accessRequestsApi.reject('request/1', 'no documents', { expectedCurrentStatus: 'pending_approval' });
    await accessRequestsApi.cancel('request/1', { expectedCurrentStatus: 'new' });
    await accessRequestsApi.escalate('request/1', 'needs admin', { expectedCurrentStatus: 'pending_approval' });

    expect(postMock).toHaveBeenNthCalledWith(
      1,
      '/access-requests/request%2F1/submit',
      undefined,
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      2,
      '/access-requests/request%2F1/approve',
      { comment: 'ok', expectedCurrentStatus: 'pending_approval' },
      {},
    );
    expect(postMock).toHaveBeenNthCalledWith(
      3,
      '/access-requests/request%2F1/reject',
      { reason: 'no documents', expectedCurrentStatus: 'pending_approval' },
      {},
    );
    expect(postMock).toHaveBeenNthCalledWith(
      4,
      '/access-requests/request%2F1/cancel',
      { expectedCurrentStatus: 'new' },
      {},
    );
    expect(postMock).toHaveBeenNthCalledWith(
      5,
      '/access-requests/request%2F1/escalate',
      { comment: 'needs admin', expectedCurrentStatus: 'pending_approval' },
      {},
    );
  });
});
