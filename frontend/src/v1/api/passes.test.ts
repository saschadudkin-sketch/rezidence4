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

import { passesApi } from './passes';

describe('passesApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('routes pass reads through canonical v1 endpoints', async () => {
    getMock.mockResolvedValue({});

    await passesApi.list({ property_id: 'property-1', status: 'active', limit: 20 });
    await passesApi.getById('pass/1');
    await passesApi.getQr('pass/1');
    await passesApi.getPin('pass/1');

    expect(getMock).toHaveBeenNthCalledWith(
      1,
      '/passes?property_id=property-1&status=active&limit=20',
      undefined,
    );
    expect(getMock).toHaveBeenNthCalledWith(2, '/passes/pass%2F1', undefined);
    expect(getMock).toHaveBeenNthCalledWith(3, '/passes/pass%2F1/qr', undefined);
    expect(getMock).toHaveBeenNthCalledWith(4, '/passes/pass%2F1/pin', undefined);
  });

  test('routes pass mutations through canonical v1 endpoints', async () => {
    postMock.mockResolvedValue({});

    await passesApi.create({
      property_id: 'property-1',
      pass_type: 'resident',
      subject_type: 'resident',
      subject_resident_id: 'resident-1',
      valid_from: '2026-05-17T12:00:00.000Z',
      valid_until: '2026-05-18T12:00:00.000Z',
    });
    await passesApi.regenerateQr('pass/1');
    await passesApi.regeneratePin('pass/1');
    await passesApi.revoke('pass/1', 'expired access');
    await passesApi.block('pass/1', 'security review');
    await passesApi.unblock('pass/1');

    expect(postMock).toHaveBeenNthCalledWith(
      1,
      '/passes',
      {
        property_id: 'property-1',
        pass_type: 'resident',
        subject_type: 'resident',
        subject_resident_id: 'resident-1',
        valid_from: '2026-05-17T12:00:00.000Z',
        valid_until: '2026-05-18T12:00:00.000Z',
      },
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      2,
      '/passes/pass%2F1/regenerate-qr',
      undefined,
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      3,
      '/passes/pass%2F1/regenerate-pin',
      undefined,
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      4,
      '/passes/pass%2F1/revoke',
      { reason: 'expired access' },
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      5,
      '/passes/pass%2F1/block',
      { reason: 'security review' },
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      6,
      '/passes/pass%2F1/unblock',
      undefined,
      undefined,
    );
  });
});
