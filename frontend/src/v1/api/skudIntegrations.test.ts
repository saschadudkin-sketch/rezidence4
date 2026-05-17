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

import { skudIntegrationsApi } from './skudIntegrations';

describe('skudIntegrationsApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('routes hardware device reads and writes through canonical v1 endpoints', async () => {
    getMock.mockResolvedValue({});
    patchMock.mockResolvedValue({});
    postMock.mockResolvedValue({});

    await skudIntegrationsApi.listHardwareDevices({ provider_config_id: 'provider-1' });
    await skudIntegrationsApi.updateHardwareBoundary('device/1', {
      fail_safe_mode: 'manual_guard',
      manual_control_policy: 'guard_allowed',
    });
    await skudIntegrationsApi.manualControl('device/1', { action: 'manual_open', reason: 'test' });
    await skudIntegrationsApi.listManualControlEvents('device/1', { limit: 10 });

    expect(getMock).toHaveBeenNthCalledWith(
      1,
      '/skud/hardware-devices?provider_config_id=provider-1',
      undefined,
    );
    expect(patchMock).toHaveBeenCalledWith(
      '/skud/hardware-devices/device%2F1/boundary',
      { fail_safe_mode: 'manual_guard', manual_control_policy: 'guard_allowed' },
      undefined,
    );
    expect(postMock).toHaveBeenCalledWith(
      '/skud/hardware-devices/device%2F1/manual-control',
      { action: 'manual_open', reason: 'test' },
      undefined,
    );
    expect(getMock).toHaveBeenNthCalledWith(
      2,
      '/skud/hardware-devices/device%2F1/manual-control-events?limit=10',
      undefined,
    );
  });

  test('routes provider rollout and sync calls through canonical v1 endpoints', async () => {
    postMock.mockResolvedValue({});

    await skudIntegrationsApi.recordFieldRolloutEvidence({
      rollout_stage: 'pilot',
      evidence_type: 'field_drill',
    });
    await skudIntegrationsApi.syncPass('provider/1', { pass_id: 'pass-1', action: 'provision' });

    expect(postMock).toHaveBeenNthCalledWith(
      1,
      '/skud/field-rollout-evidence',
      { rollout_stage: 'pilot', evidence_type: 'field_drill' },
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      2,
      '/skud/providers/provider%2F1/sync-pass',
      { pass_id: 'pass-1', action: 'provision' },
      undefined,
    );
  });
});
