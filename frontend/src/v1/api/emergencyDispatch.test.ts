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

import { emergencyDispatchApi } from './emergencyDispatch';

describe('emergencyDispatchApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('routes readiness and drill evidence through canonical v1 request emergency endpoints', async () => {
    getMock.mockResolvedValue({});
    postMock.mockResolvedValue({});

    await emergencyDispatchApi.readiness({ propertyId: 'property-1', windowHours: 72, limit: 20 });
    await emergencyDispatchApi.createDrill({
      propertyId: 'property-1',
      scenarioType: 'fire_smoke',
      severity: 'P0',
      escalationTarget: 'security',
      requestId: 'request-1',
      notificationEvidence: { channel: 'sms' },
    });

    expect(getMock).toHaveBeenCalledWith(
      '/requests/emergency/readiness?propertyId=property-1&windowHours=72&limit=20',
      undefined,
    );
    expect(postMock).toHaveBeenCalledWith(
      '/requests/emergency/drills',
      {
        propertyId: 'property-1',
        scenarioType: 'fire_smoke',
        severity: 'P0',
        escalationTarget: 'security',
        requestId: 'request-1',
        notificationEvidence: { channel: 'sms' },
      },
      undefined,
    );
  });
});
