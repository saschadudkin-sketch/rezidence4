import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  getMock,
  patchMock,
  postMock,
} = vi.hoisted(() => ({
  getMock: vi.fn(),
  patchMock: vi.fn(),
  postMock: vi.fn(),
}));

vi.mock('./client', () => ({
  v1Client: {
    get: getMock,
    patch: patchMock,
    post: postMock,
  },
}));

import { staffWorkspaceApi } from './staffWorkspace';

describe('staffWorkspaceApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('routes staff workspace reads and comments through canonical endpoints', async () => {
    getMock.mockResolvedValue({});
    postMock.mockResolvedValue({});

    await staffWorkspaceApi.listInbox({ queue: 'overdue', category: 'plumber', limit: 10 });
    await staffWorkspaceApi.listOverdue({ status: 'new', limit: 5 });
    await staffWorkspaceApi.getRequestDetail('request/1');
    await staffWorkspaceApi.createInternalComment('request/1', { body: 'Internal note' });
    await staffWorkspaceApi.getResidentQuickView('resident/1');

    expect(getMock).toHaveBeenNthCalledWith(
      1,
      '/staff-workspace/inbox?queue=overdue&category=plumber&limit=10',
      undefined,
    );
    expect(getMock).toHaveBeenNthCalledWith(
      2,
      '/staff-workspace/overdue?status=new&limit=5',
      undefined,
    );
    expect(getMock).toHaveBeenNthCalledWith(
      3,
      '/staff-workspace/requests/request%2F1',
      undefined,
    );
    expect(postMock).toHaveBeenCalledWith(
      '/staff-workspace/requests/request%2F1/internal-comments',
      { body: 'Internal note' },
      undefined,
    );
    expect(getMock).toHaveBeenNthCalledWith(
      4,
      '/staff-workspace/residents/resident%2F1/quick-view',
      undefined,
    );
  });

  test('routes service request shims with encoded ids', async () => {
    patchMock.mockResolvedValue({});
    postMock.mockResolvedValue({});

    await staffWorkspaceApi.assignRequest('request/1', {
      assigneeUid: 'staff-1',
      assigneeName: 'Staff',
      assigneeRole: 'technician',
    });
    await staffWorkspaceApi.markFirstResponse('request/1');
    await staffWorkspaceApi.updateStatus('request/1', { status: 'in_progress' });

    expect(postMock).toHaveBeenNthCalledWith(
      1,
      '/requests/request%2F1/assign',
      { assigneeUid: 'staff-1', assigneeName: 'Staff', assigneeRole: 'technician' },
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      2,
      '/requests/request%2F1/first-response',
      undefined,
      undefined,
    );
    expect(patchMock).toHaveBeenCalledWith(
      '/requests/request%2F1',
      { status: 'in_progress' },
      undefined,
    );
  });
});
