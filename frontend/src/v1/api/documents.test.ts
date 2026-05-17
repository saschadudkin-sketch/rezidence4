import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  deleteMock,
  getMock,
  patchMock,
  postMock,
} = vi.hoisted(() => ({
  deleteMock: vi.fn(),
  getMock: vi.fn(),
  patchMock: vi.fn(),
  postMock: vi.fn(),
}));

vi.mock('./client', () => ({
  v1Client: {
    delete: deleteMock,
    get: getMock,
    patch: patchMock,
    post: postMock,
  },
}));

import { documentsApi } from './documents';

describe('documentsApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('routes document list, detail, version and public reads through canonical v1 endpoints', async () => {
    getMock.mockResolvedValue({});

    await documentsApi.list({
      property_id: 'property-1',
      category: 'rules',
      include_draft: true,
      include_deleted: false,
      limit: 25,
    });
    await documentsApi.getById('document/1');
    await documentsApi.listVersions('document/1');
    await documentsApi.getVersion('document/1', 2);
    await documentsApi.listPublic('demo/property', { limit: 5 });

    expect(getMock).toHaveBeenNthCalledWith(
      1,
      '/documents?property_id=property-1&category=rules&include_draft=1&include_deleted=0&limit=25',
      undefined,
    );
    expect(getMock).toHaveBeenNthCalledWith(2, '/documents/document%2F1', undefined);
    expect(getMock).toHaveBeenNthCalledWith(
      3,
      '/admin/documents/document%2F1/versions',
      undefined,
    );
    expect(getMock).toHaveBeenNthCalledWith(
      4,
      '/admin/documents/document%2F1/versions/2',
      undefined,
    );
    expect(getMock).toHaveBeenNthCalledWith(
      5,
      '/public/demo%2Fproperty/documents?limit=5',
      undefined,
    );
  });

  test('routes document mutations with encoded ids', async () => {
    deleteMock.mockResolvedValue({});
    patchMock.mockResolvedValue({});
    postMock.mockResolvedValue({});

    await documentsApi.create({
      property_id: 'property-1',
      title: 'Rules',
      category: 'rules',
      body_md: 'Body',
    });
    await documentsApi.update('document/1', { reason: 'fix typo', title: 'Rules v2' });
    await documentsApi.publish('document/1');
    await documentsApi.unpublish('document/1');
    await documentsApi.remove('document/1');

    expect(postMock).toHaveBeenNthCalledWith(
      1,
      '/documents',
      {
        property_id: 'property-1',
        title: 'Rules',
        category: 'rules',
        body_md: 'Body',
      },
      undefined,
    );
    expect(patchMock).toHaveBeenCalledWith(
      '/documents/document%2F1',
      { reason: 'fix typo', title: 'Rules v2' },
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      2,
      '/documents/document%2F1/publish',
      undefined,
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      3,
      '/documents/document%2F1/unpublish',
      undefined,
      undefined,
    );
    expect(deleteMock).toHaveBeenCalledWith('/documents/document%2F1', undefined);
  });
});
