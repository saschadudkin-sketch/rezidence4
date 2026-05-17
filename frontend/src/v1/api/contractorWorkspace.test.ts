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

import { contractorWorkspaceApi } from './contractorWorkspace';

describe('contractorWorkspaceApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('routes contractor queue and lifecycle actions through canonical endpoints', async () => {
    getMock.mockResolvedValue({});
    postMock.mockResolvedValue({});

    await contractorWorkspaceApi.listQueue({ contractorUserId: 'contractor-1', limit: 10 });
    await contractorWorkspaceApi.getRequestDetail('request/1');
    await contractorWorkspaceApi.assignRequest('request/1', { contractorUserId: 'contractor-1' });
    await contractorWorkspaceApi.startRequest('request/1');
    await contractorWorkspaceApi.resumeRequest('request/1');
    await contractorWorkspaceApi.setWaiting('request/1', { reason: 'parts', note: 'Need part' });
    await contractorWorkspaceApi.resolveRequest('request/1', { resolutionNote: 'Done' });

    expect(getMock).toHaveBeenNthCalledWith(
      1,
      '/contractor-workspace/queue?contractorUserId=contractor-1&limit=10',
      undefined,
    );
    expect(getMock).toHaveBeenNthCalledWith(
      2,
      '/contractor-workspace/requests/request%2F1',
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      1,
      '/contractor-workspace/requests/request%2F1/assign',
      { contractorUserId: 'contractor-1' },
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      2,
      '/contractor-workspace/requests/request%2F1/start',
      undefined,
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      3,
      '/contractor-workspace/requests/request%2F1/resume',
      undefined,
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      4,
      '/contractor-workspace/requests/request%2F1/waiting',
      { reason: 'parts', note: 'Need part' },
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      5,
      '/contractor-workspace/requests/request%2F1/resolve',
      { resolutionNote: 'Done' },
      undefined,
    );
  });
});
