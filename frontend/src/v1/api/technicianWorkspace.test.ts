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

import { technicianWorkspaceApi } from './technicianWorkspace';

describe('technicianWorkspaceApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('routes technician queue and lifecycle actions through canonical endpoints', async () => {
    getMock.mockResolvedValue({});
    postMock.mockResolvedValue({});

    await technicianWorkspaceApi.listQueue({ queue: 'mine', assignee_uid: 'tech-1', limit: 10 });
    await technicianWorkspaceApi.getRequestDetail('request/1');
    await technicianWorkspaceApi.claimRequest('request/1');
    await technicianWorkspaceApi.startRequest('request/1');
    await technicianWorkspaceApi.resumeRequest('request/1');
    await technicianWorkspaceApi.setWaiting('request/1', { reason: 'resident', note: 'No access' });
    await technicianWorkspaceApi.resolveRequest('request/1', { resolutionNote: 'Done' });

    expect(getMock).toHaveBeenNthCalledWith(
      1,
      '/technician-workspace/queue?queue=mine&assignee_uid=tech-1&limit=10',
      undefined,
    );
    expect(getMock).toHaveBeenNthCalledWith(
      2,
      '/technician-workspace/requests/request%2F1',
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      1,
      '/technician-workspace/requests/request%2F1/claim',
      undefined,
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      2,
      '/technician-workspace/requests/request%2F1/start',
      undefined,
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      3,
      '/technician-workspace/requests/request%2F1/resume',
      undefined,
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      4,
      '/technician-workspace/requests/request%2F1/waiting',
      { reason: 'resident', note: 'No access' },
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      5,
      '/technician-workspace/requests/request%2F1/resolve',
      { resolutionNote: 'Done' },
      undefined,
    );
  });
});
