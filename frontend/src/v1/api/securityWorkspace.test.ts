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

import { securityWorkspaceApi } from './securityWorkspace';

describe('securityWorkspaceApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('routes security workspace reads through canonical v1 endpoints', async () => {
    getMock.mockResolvedValue({});

    await securityWorkspaceApi.bootstrap({
      property_id: 'property-1',
      access_point_id: 'point-1',
      active_passes_limit: 10,
    });
    await securityWorkspaceApi.dashboard({
      property_id: 'property-1',
      access_point_id: 'point-1',
      recent_events_limit: 5,
    });
    await securityWorkspaceApi.search({
      property_id: 'property-1',
      q: 'A123BC77',
      limit: 20,
    });
    await securityWorkspaceApi.recentEvents({
      property_id: 'property-1',
      access_point_id: null,
      offset: 10,
    });

    expect(getMock).toHaveBeenNthCalledWith(
      1,
      '/security-workspace/bootstrap?property_id=property-1&access_point_id=point-1&active_passes_limit=10',
      undefined,
    );
    expect(getMock).toHaveBeenNthCalledWith(
      2,
      '/security-workspace/dashboard?property_id=property-1&access_point_id=point-1&recent_events_limit=5',
      undefined,
    );
    expect(getMock).toHaveBeenNthCalledWith(
      3,
      '/security-workspace/search?property_id=property-1&q=A123BC77&limit=20',
      undefined,
    );
    expect(getMock).toHaveBeenNthCalledWith(
      4,
      '/security-workspace/recent-events?property_id=property-1&offset=10',
      undefined,
    );
  });

  test('routes manual decision aliases and degraded reconciliation through canonical v1 endpoints', async () => {
    postMock.mockResolvedValue({});

    await securityWorkspaceApi.manualDecision({
      property_id: 'property-1',
      access_point_id: 'point-1',
      decision: 'manual_admit',
      reason: 'known resident',
    });
    await securityWorkspaceApi.manualAdmit({
      property_id: 'property-1',
      access_point_id: 'point-1',
      reason: 'known resident',
    });
    await securityWorkspaceApi.manualDeny({
      property_id: 'property-1',
      access_point_id: 'point-1',
      reason: 'blocked vehicle',
      degraded_mode: true,
    });
    await securityWorkspaceApi.reconcileDegradedEvent('visit/1', {
      property_id: 'property-1',
      reconciliation_state: 'matched',
      note: 'synced with provider',
    });

    expect(postMock).toHaveBeenNthCalledWith(
      1,
      '/security-workspace/manual-decision',
      {
        property_id: 'property-1',
        access_point_id: 'point-1',
        decision: 'manual_admit',
        reason: 'known resident',
      },
      { skipRetry: true },
    );
    expect(postMock).toHaveBeenNthCalledWith(
      2,
      '/security-workspace/manual-admit',
      {
        property_id: 'property-1',
        access_point_id: 'point-1',
        reason: 'known resident',
      },
      { skipRetry: true },
    );
    expect(postMock).toHaveBeenNthCalledWith(
      3,
      '/security-workspace/manual-deny',
      {
        property_id: 'property-1',
        access_point_id: 'point-1',
        reason: 'blocked vehicle',
        degraded_mode: true,
      },
      { skipRetry: true },
    );
    expect(postMock).toHaveBeenNthCalledWith(
      4,
      '/security-workspace/degraded-events/visit%2F1/reconcile',
      {
        property_id: 'property-1',
        reconciliation_state: 'matched',
        note: 'synced with provider',
      },
      { skipRetry: true },
    );
  });

  test('encodes guard authorized device ids in mutation routes', async () => {
    postMock.mockResolvedValue({});

    await securityWorkspaceApi.approveAuthorizedDevice('device/1', {
      property_id: 'property-1',
    });
    await securityWorkspaceApi.revokeAuthorizedDevice('device/1', {
      property_id: 'property-1',
      reason: 'lost device',
    });

    expect(postMock).toHaveBeenNthCalledWith(
      1,
      '/security-workspace/authorized-devices/device%2F1/approve',
      { property_id: 'property-1' },
      { skipRetry: true },
    );
    expect(postMock).toHaveBeenNthCalledWith(
      2,
      '/security-workspace/authorized-devices/device%2F1/revoke',
      {
        property_id: 'property-1',
        reason: 'lost device',
      },
      { skipRetry: true },
    );
  });
});
