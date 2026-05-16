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

import { accessIncidentsApi } from './accessIncidents';

describe('accessIncidentsApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('routes incident management calls through canonical v1 endpoints', async () => {
    postMock.mockResolvedValue({ incident: { id: 'incident-1' } });
    patchMock.mockResolvedValue({ incident: { id: 'incident-1' } });

    await accessIncidentsApi.assign('incident/1', { assigned_to_staff_id: 'staff-1' });
    await accessIncidentsApi.resolve('incident/1', { reason: 'handled' });
    await accessIncidentsApi.dismiss('incident/1', { reason: 'duplicate' });
    await accessIncidentsApi.reopen('incident/1', { reason: 'new evidence' });
    await accessIncidentsApi.updateStatus('incident/1', { status: 'investigating', reason: 'review' });
    await accessIncidentsApi.patch('incident/1', { severity: 'high' });

    expect(postMock).toHaveBeenNthCalledWith(
      1,
      '/access-incidents/incident%2F1/assign',
      { assigned_to_staff_id: 'staff-1' },
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      2,
      '/access-incidents/incident%2F1/resolve',
      { reason: 'handled' },
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      3,
      '/access-incidents/incident%2F1/dismiss',
      { reason: 'duplicate' },
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      4,
      '/access-incidents/incident%2F1/reopen',
      { reason: 'new evidence' },
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      5,
      '/access-incidents/incident%2F1/status',
      { status: 'investigating', reason: 'review' },
      undefined,
    );
    expect(patchMock).toHaveBeenCalledWith(
      '/access-incidents/incident%2F1',
      { severity: 'high' },
      undefined,
    );
  });

  test('routes incident video evidence calls through canonical v1 endpoints', async () => {
    getMock.mockResolvedValue({ evidence: [] });
    postMock.mockResolvedValue({ evidence: { id: 'evidence-1' } });

    await accessIncidentsApi.listVideoEvidence('incident/1');
    await accessIncidentsApi.createVideoEvidence('incident/1', { evidence_url: 'https://example.test/clip.mp4' });
    await accessIncidentsApi.fetchVideoEvidence('incident/1', { camera_device_id: 'camera-1' });

    expect(getMock).toHaveBeenCalledWith(
      '/access-incidents/incident%2F1/video-evidence',
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      1,
      '/access-incidents/incident%2F1/video-evidence',
      { evidence_url: 'https://example.test/clip.mp4' },
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      2,
      '/access-incidents/incident%2F1/video-evidence/fetch',
      { camera_device_id: 'camera-1' },
      undefined,
    );
  });
});
