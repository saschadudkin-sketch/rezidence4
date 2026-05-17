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

import { gisOssReadinessApi } from './gisOssReadiness';

describe('gisOssReadinessApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('routes boundary and export package reads through canonical v1 endpoints', async () => {
    getMock.mockResolvedValue({});

    await gisOssReadinessApi.getBoundary();
    await gisOssReadinessApi.listExportPackages({
      propertyId: 'property-1',
      package_type: 'oss_readiness',
      limit: 10,
    });
    await gisOssReadinessApi.getExportPackage('property-1', 'package-1');

    expect(getMock).toHaveBeenNthCalledWith(1, '/gis-oss/boundary', undefined);
    expect(getMock).toHaveBeenNthCalledWith(
      2,
      '/gis-oss/export-packages?propertyId=property-1&package_type=oss_readiness&limit=10',
      undefined,
    );
    expect(getMock).toHaveBeenNthCalledWith(
      3,
      '/gis-oss/export-packages/package-1?property_id=property-1',
      undefined,
    );
  });

  test('routes export package creation with backend-supported camelCase aliases', async () => {
    postMock.mockResolvedValue({});

    await gisOssReadinessApi.createExportPackage({
      propertyId: 'property-1',
      packageType: 'protocol_archive',
      title: 'OSS package',
      periodStart: '2026-05-01',
      periodEnd: '2026-05-31',
      documentIds: ['document-1'],
      announcementIds: ['announcement-1'],
      protocolFiles: [{ label: 'Protocol', file_url: '/uploads/protocol.pdf' }],
      operationalRecordRefs: [{ type: 'meeting', id: 'meeting-1' }],
    });

    expect(postMock).toHaveBeenCalledWith(
      '/gis-oss/export-packages',
      {
        propertyId: 'property-1',
        packageType: 'protocol_archive',
        title: 'OSS package',
        periodStart: '2026-05-01',
        periodEnd: '2026-05-31',
        documentIds: ['document-1'],
        announcementIds: ['announcement-1'],
        protocolFiles: [{ label: 'Protocol', file_url: '/uploads/protocol.pdf' }],
        operationalRecordRefs: [{ type: 'meeting', id: 'meeting-1' }],
      },
      undefined,
    );
  });
});
