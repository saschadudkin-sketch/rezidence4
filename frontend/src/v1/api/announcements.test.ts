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

import { announcementsApi } from './announcements';

describe('announcementsApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('routes feed, admin list, detail and metrics through canonical v1 endpoints', async () => {
    getMock.mockResolvedValue({});

    await announcementsApi.list({ category: 'maintenance', only_active: false, limit: 20 });
    await announcementsApi.listAdmin({ property_id: 'property-1', status: 'draft', limit: 10 });
    await announcementsApi.getById('announcement/1');
    await announcementsApi.getMetrics('announcement/1');

    expect(getMock).toHaveBeenNthCalledWith(
      1,
      '/announcements?category=maintenance&only_active=false&limit=20',
      undefined,
    );
    expect(getMock).toHaveBeenNthCalledWith(
      2,
      '/admin/announcements?property_id=property-1&status=draft&limit=10',
      undefined,
    );
    expect(getMock).toHaveBeenNthCalledWith(3, '/announcements/announcement%2F1', undefined);
    expect(getMock).toHaveBeenNthCalledWith(
      4,
      '/admin/announcements/announcement%2F1/metrics',
      undefined,
    );
  });

  test('routes announcement mutations with encoded ids', async () => {
    deleteMock.mockResolvedValue({});
    patchMock.mockResolvedValue({});
    postMock.mockResolvedValue({});

    await announcementsApi.create({
      property_id: 'property-1',
      title: 'Maintenance',
      body_md: 'Works',
      notify_channels: ['web_push'],
    });
    await announcementsApi.update('announcement/1', { title: 'Updated' });
    await announcementsApi.publish('announcement/1');
    await announcementsApi.unpublish('announcement/1');
    await announcementsApi.remove('announcement/1');

    expect(postMock).toHaveBeenNthCalledWith(
      1,
      '/announcements',
      {
        property_id: 'property-1',
        title: 'Maintenance',
        body_md: 'Works',
        notify_channels: ['web_push'],
      },
      undefined,
    );
    expect(patchMock).toHaveBeenCalledWith(
      '/announcements/announcement%2F1',
      { title: 'Updated' },
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      2,
      '/announcements/announcement%2F1/publish',
      undefined,
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      3,
      '/announcements/announcement%2F1/unpublish',
      undefined,
      undefined,
    );
    expect(deleteMock).toHaveBeenCalledWith('/announcements/announcement%2F1', undefined);
  });
});
