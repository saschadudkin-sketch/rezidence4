import { beforeEach, describe, expect, test, vi } from 'vitest';

const { getMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
}));

vi.mock('./client', () => ({
  v1Client: {
    get: getMock,
  },
}));

import { managementCompanyPortfolioApi } from './managementCompanyPortfolio';

describe('managementCompanyPortfolioApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('routes portfolio query params through canonical v1 endpoint', async () => {
    getMock.mockResolvedValue({});

    await managementCompanyPortfolioApi.get({
      period: '30d',
      propertySlugs: ['alpha-house', '', 'beta-house'],
      includeInactive: true,
    });
    await managementCompanyPortfolioApi.get({ period: '7d' });

    expect(getMock).toHaveBeenNthCalledWith(
      1,
      '/management-company/portfolio?period=30d&property_slug=alpha-house%2Cbeta-house&include_inactive=true',
      undefined,
    );
    expect(getMock).toHaveBeenNthCalledWith(
      2,
      '/management-company/portfolio?period=7d',
      undefined,
    );
  });
});
