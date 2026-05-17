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

import { API_BASE_URL } from '../../config/apiBaseUrl';
import { staffApi } from './staff';

describe('staffApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('routes staff mutations through canonical v1 endpoints', async () => {
    postMock.mockResolvedValue({});
    patchMock.mockResolvedValue({});

    await staffApi.create({
      property_id: 'property-1',
      full_name: 'Guard One',
      email: 'guard@example.ru',
      role: 'security',
    });
    await staffApi.update('staff/1', {
      role: 'concierge',
      can_assign_requests: true,
    });
    await staffApi.deactivate('staff/1');

    expect(postMock).toHaveBeenNthCalledWith(
      1,
      '/staff',
      {
        property_id: 'property-1',
        full_name: 'Guard One',
        email: 'guard@example.ru',
        role: 'security',
      },
      undefined,
    );
    expect(patchMock).toHaveBeenCalledWith(
      '/staff/staff%2F1',
      {
        role: 'concierge',
        can_assign_requests: true,
      },
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      2,
      '/staff/staff%2F1/deactivate',
      undefined,
      undefined,
    );
  });

  test('routes staff import coverage through canonical v1 endpoints', async () => {
    postMock.mockResolvedValue({});

    const body = {
      property_id: 'property-1',
      rows: [{ full_name: 'One', email: 'one@example.ru', role: 'concierge' }],
    };

    await staffApi.previewImport(body);
    await staffApi.applyImport(body);

    expect(staffApi.importTemplateUrl()).toBe(`${API_BASE_URL}/api/v1/staff/import/template`);
    expect(postMock).toHaveBeenNthCalledWith(
      1,
      '/staff/import/preview',
      body,
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      2,
      '/staff/import/apply',
      body,
      undefined,
    );
  });
});
