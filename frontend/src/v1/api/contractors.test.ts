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
import { contractorsApi } from './contractors';

describe('contractorsApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('routes contractor reads through canonical v1 endpoints', async () => {
    getMock.mockResolvedValue({});

    await contractorsApi.listCompanies({ status: 'active', q: 'clean', limit: 20 });
    await contractorsApi.getCompanyById('company/1');
    await contractorsApi.listUsers({
      contractor_company_id: 'company-1',
      is_active: true,
      offset: 10,
    });

    expect(getMock).toHaveBeenNthCalledWith(
      1,
      '/contractor-companies?status=active&q=clean&limit=20',
      undefined,
    );
    expect(getMock).toHaveBeenNthCalledWith(
      2,
      '/contractor-companies/company%2F1',
      undefined,
    );
    expect(getMock).toHaveBeenNthCalledWith(
      3,
      '/contractor-users?contractor_company_id=company-1&is_active=true&offset=10',
      undefined,
    );
  });

  test('routes contractor company and user mutations through canonical v1 endpoints', async () => {
    postMock.mockResolvedValue({});
    patchMock.mockResolvedValue({});

    await contractorsApi.createCompany({
      property_id: 'property-1',
      name: 'Clean Co',
      contact_email: 'ops@example.ru',
    });
    await contractorsApi.updateCompany('company/1', {
      status: 'suspended',
      contact_phone: '+79990000000',
    });
    await contractorsApi.createUser({
      property_id: 'property-1',
      contractor_company_id: 'company-1',
      full_name: 'Worker One',
      email: 'worker@example.ru',
    });
    await contractorsApi.updateUser('user/1', {
      specialization: 'cleaning',
      access_expires_at: '2026-05-17T12:00:00.000Z',
    });
    await contractorsApi.deactivateUser('user/1');

    expect(postMock).toHaveBeenNthCalledWith(
      1,
      '/contractor-companies',
      {
        property_id: 'property-1',
        name: 'Clean Co',
        contact_email: 'ops@example.ru',
      },
      undefined,
    );
    expect(patchMock).toHaveBeenNthCalledWith(
      1,
      '/contractor-companies/company%2F1',
      {
        status: 'suspended',
        contact_phone: '+79990000000',
      },
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      2,
      '/contractor-users',
      {
        property_id: 'property-1',
        contractor_company_id: 'company-1',
        full_name: 'Worker One',
        email: 'worker@example.ru',
      },
      undefined,
    );
    expect(patchMock).toHaveBeenNthCalledWith(
      2,
      '/contractor-users/user%2F1',
      {
        specialization: 'cleaning',
        access_expires_at: '2026-05-17T12:00:00.000Z',
      },
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      3,
      '/contractor-users/user%2F1/deactivate',
      undefined,
      undefined,
    );
  });

  test('routes contractor import coverage through canonical v1 endpoints', async () => {
    postMock.mockResolvedValue({});

    const body = {
      property_id: 'property-1',
      rows: [{
        company_name: 'Clean Co',
        user_full_name: 'Worker One',
        user_email: 'worker@example.ru',
      }],
    };

    await contractorsApi.previewImport(body);
    await contractorsApi.applyImport(body);

    expect(contractorsApi.importTemplateUrl()).toBe(
      `${API_BASE_URL}/api/v1/contractors/import/template`,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      1,
      '/contractors/import/preview',
      body,
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      2,
      '/contractors/import/apply',
      body,
      undefined,
    );
  });
});
