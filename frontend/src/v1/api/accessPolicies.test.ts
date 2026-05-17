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

import { accessPoliciesApi } from './accessPolicies';

describe('accessPoliciesApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('routes access policy reads through canonical v1 endpoints', async () => {
    getMock.mockResolvedValue({});

    await accessPoliciesApi.templates({ property_id: 'property-1' });
    await accessPoliciesApi.list({
      property_id: 'property-1',
      is_active: true,
      subject_type: 'vehicle',
      access_method: 'plate',
      effect: 'allow',
      limit: 20,
    });
    await accessPoliciesApi.getById('policy/1');

    expect(getMock).toHaveBeenNthCalledWith(
      1,
      '/access-policy-templates?property_id=property-1',
      undefined,
    );
    expect(getMock).toHaveBeenNthCalledWith(
      2,
      '/access-policies?property_id=property-1&is_active=true&subject_type=vehicle&access_method=plate&effect=allow&limit=20',
      undefined,
    );
    expect(getMock).toHaveBeenNthCalledWith(
      3,
      '/access-policies/policy%2F1',
      undefined,
    );
  });

  test('routes access policy mutations and evaluation through canonical v1 endpoints', async () => {
    postMock.mockResolvedValue({});
    patchMock.mockResolvedValue({});

    await accessPoliciesApi.create({
      property_id: 'property-1',
      name: 'Resident plates',
      subject_type: 'vehicle',
      access_method: 'plate',
      approval_mode: 'auto',
      effect: 'allow',
      priority: 20,
    });
    await accessPoliciesApi.update('policy/1', {
      name: 'Resident plates updated',
      priority: 10,
      is_recurring: true,
    });
    await accessPoliciesApi.evaluate({
      property_id: 'property-1',
      subject_type: 'vehicle',
      access_method: 'plate',
      point_id: 'point-1',
    });
    await accessPoliciesApi.deactivate('policy/1');

    expect(postMock).toHaveBeenNthCalledWith(
      1,
      '/access-policies',
      {
        property_id: 'property-1',
        name: 'Resident plates',
        subject_type: 'vehicle',
        access_method: 'plate',
        approval_mode: 'auto',
        effect: 'allow',
        priority: 20,
      },
      undefined,
    );
    expect(patchMock).toHaveBeenCalledWith(
      '/access-policies/policy%2F1',
      {
        name: 'Resident plates updated',
        priority: 10,
        is_recurring: true,
      },
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      2,
      '/access-policies/evaluate',
      {
        property_id: 'property-1',
        subject_type: 'vehicle',
        access_method: 'plate',
        point_id: 'point-1',
      },
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      3,
      '/access-policies/policy%2F1/deactivate',
      undefined,
      undefined,
    );
  });
});
