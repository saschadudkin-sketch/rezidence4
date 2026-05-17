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

import { webhooksApi } from './webhooks';

describe('webhooksApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('routes webhook CRUD through canonical v1 endpoints', async () => {
    deleteMock.mockResolvedValue({});
    getMock.mockResolvedValue({});
    patchMock.mockResolvedValue({});
    postMock.mockResolvedValue({});

    await webhooksApi.list();
    await webhooksApi.create({
      name: 'ERP bridge',
      url: 'https://erp.example/webhooks/domhub',
      secret: 'secret-ref',
      events: ['request.created'],
    });
    await webhooksApi.update('webhook/1', { is_active: false });
    await webhooksApi.deactivate('webhook/1');

    expect(getMock).toHaveBeenCalledWith('/webhooks', undefined);
    expect(postMock).toHaveBeenCalledWith(
      '/webhooks',
      {
        name: 'ERP bridge',
        url: 'https://erp.example/webhooks/domhub',
        secret: 'secret-ref',
        events: ['request.created'],
      },
      undefined,
    );
    expect(patchMock).toHaveBeenCalledWith(
      '/webhooks/webhook%2F1',
      { is_active: false },
      undefined,
    );
    expect(deleteMock).toHaveBeenCalledWith('/webhooks/webhook%2F1', undefined);
  });

  test('routes test delivery and delivery history through encoded webhook ids', async () => {
    getMock.mockResolvedValue({});
    postMock.mockResolvedValue({});

    await webhooksApi.testDelivery('webhook/1');
    await webhooksApi.listDeliveries('webhook/1');

    expect(postMock).toHaveBeenCalledWith(
      '/webhooks/webhook%2F1/test',
      undefined,
      undefined,
    );
    expect(getMock).toHaveBeenCalledWith(
      '/webhooks/webhook%2F1/deliveries',
      undefined,
    );
  });
});
