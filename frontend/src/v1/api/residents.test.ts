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

import { residentsApi } from './residents';

describe('residentsApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('routes resident reads through canonical v1 endpoints', async () => {
    getMock.mockResolvedValue({});

    await residentsApi.list({
      unit_id: 'unit-1',
      q: 'ivan',
      is_active: true,
      limit: 25,
      offset: 50,
    });
    await residentsApi.getById('resident/1');
    await residentsApi.offboardingReport({ property_id: 'property-1', limit: 10 });

    expect(getMock).toHaveBeenNthCalledWith(
      1,
      '/residents?unit_id=unit-1&q=ivan&is_active=true&limit=25&offset=50',
      undefined,
    );
    expect(getMock).toHaveBeenNthCalledWith(
      2,
      '/residents/resident%2F1',
      undefined,
    );
    expect(getMock).toHaveBeenNthCalledWith(
      3,
      '/residents/offboarding-report?property_id=property-1&limit=10',
      undefined,
    );
  });

  test('routes resident mutations through canonical v1 endpoints', async () => {
    postMock.mockResolvedValue({});
    patchMock.mockResolvedValue({});

    await residentsApi.create({
      property_id: 'property-1',
      unit_id: 'unit-1',
      full_name: 'Ivan Petrov',
      phone: '+79990000000',
      email: 'ivan@example.ru',
      resident_type: 'owner',
      external_uid: 'erp-1',
    });
    await residentsApi.update('resident/1', {
      full_name: 'Ivan Sidorov',
      resident_type: 'tenant',
      unit_id: 'unit-2',
    });
    await residentsApi.deactivate('resident/1', { reason: 'moved out' });
    await residentsApi.transferOwnership('resident/1', {
      to_resident_id: 'resident-2',
      reason: 'sale',
      effective_at: '2026-05-17T12:00:00.000Z',
      cascade_notification_preferences: true,
    });
    await residentsApi.consent('resident/1', { consent_version: 'v2' });

    expect(postMock).toHaveBeenNthCalledWith(
      1,
      '/residents',
      {
        property_id: 'property-1',
        unit_id: 'unit-1',
        full_name: 'Ivan Petrov',
        phone: '+79990000000',
        email: 'ivan@example.ru',
        resident_type: 'owner',
        external_uid: 'erp-1',
      },
      undefined,
    );
    expect(patchMock).toHaveBeenCalledWith(
      '/residents/resident%2F1',
      {
        full_name: 'Ivan Sidorov',
        resident_type: 'tenant',
        unit_id: 'unit-2',
      },
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      2,
      '/residents/resident%2F1/deactivate',
      { reason: 'moved out' },
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      3,
      '/residents/resident%2F1/transfer-ownership',
      {
        to_resident_id: 'resident-2',
        reason: 'sale',
        effective_at: '2026-05-17T12:00:00.000Z',
        cascade_notification_preferences: true,
      },
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      4,
      '/residents/resident%2F1/consent',
      { consent_version: 'v2' },
      undefined,
    );
  });
});
