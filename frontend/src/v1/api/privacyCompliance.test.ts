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

import { privacyComplianceApi } from './privacyCompliance';

describe('privacyComplianceApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('routes consent and data-subject requests through canonical v1 endpoints', async () => {
    getMock.mockResolvedValue({});
    postMock.mockResolvedValue({});

    await privacyComplianceApi.getConsent();
    await privacyComplianceApi.acceptConsent({ version: '2026-04-01' });
    await privacyComplianceApi.getDataSubjectExport({ subject_resident_id: 'resident-1' });
    await privacyComplianceApi.listDataSubjectRequests({ status: 'pending', limit: 20 });
    await privacyComplianceApi.createDataSubjectRequest({ request_type: 'export' });
    await privacyComplianceApi.completeDataSubjectRequest('request/1', { status: 'completed' });

    expect(getMock).toHaveBeenNthCalledWith(1, '/privacy/consent', undefined);
    expect(postMock).toHaveBeenNthCalledWith(
      1,
      '/privacy/consent',
      { version: '2026-04-01' },
      undefined,
    );
    expect(getMock).toHaveBeenNthCalledWith(
      2,
      '/privacy/data-subject-export?subject_resident_id=resident-1',
      undefined,
    );
    expect(getMock).toHaveBeenNthCalledWith(
      3,
      '/privacy/data-subject-requests?status=pending&limit=20',
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      2,
      '/privacy/data-subject-requests',
      { request_type: 'export' },
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      3,
      '/privacy/data-subject-requests/request%2F1/complete',
      { status: 'completed' },
      undefined,
    );
  });

  test('routes compliance evidence, readiness and delete-account calls', async () => {
    getMock.mockResolvedValue({});
    postMock.mockResolvedValue({});

    await privacyComplianceApi.listComplianceEvidence({ control: 'fz-152' });
    await privacyComplianceApi.createComplianceEvidence({ control: 'fz-152', status: 'ready' });
    await privacyComplianceApi.getReadiness({ property_id: 'property-1' });
    await privacyComplianceApi.deleteAccount({ reason: 'resident request' });

    expect(getMock).toHaveBeenNthCalledWith(
      1,
      '/privacy/compliance-evidence?control=fz-152',
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      1,
      '/privacy/compliance-evidence',
      { control: 'fz-152', status: 'ready' },
      undefined,
    );
    expect(getMock).toHaveBeenNthCalledWith(
      2,
      '/privacy/readiness?property_id=property-1',
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      2,
      '/privacy/delete-account',
      { reason: 'resident request' },
      undefined,
    );
  });
});
