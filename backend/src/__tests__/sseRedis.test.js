'use strict';

const mockPublish = jest.fn().mockResolvedValue(1);
const mockSubscriber = {
  on: jest.fn(),
  subscribe: jest.fn((_channel, cb) => cb(null)),
  unsubscribe: jest.fn(),
  disconnect: jest.fn(),
};

jest.mock('../lib/redisClient', () => ({
  getRedis: () => ({ publish: mockPublish }),
}));

jest.mock('ioredis', () => jest.fn(() => mockSubscriber));
jest.mock('../logger', () => ({
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
}));

describe('sse redis adapter tenant envelope', () => {
  const originalRedisUrl = process.env.REDIS_URL;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.REDIS_URL = 'redis://localhost:6379';
  });

  afterAll(() => {
    if (originalRedisUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = originalRedisUrl;
  });

  test('publishes propertySlug and subscriber passes it to local broadcast', async () => {
    const sse = require('../sse');
    const localBroadcastToAll = jest.spyOn(sse, 'localBroadcastToAll').mockImplementation(() => {});
    const { init, shutdown } = require('../sse-redis');

    init();
    sse.broadcastChatMessage({ id: 'm1' }, { propertySlug: 'alpha' });
    await Promise.resolve();

    expect(JSON.parse(mockPublish.mock.calls[0][1])).toEqual({
      event: 'message',
      data: { id: 'm1', property_slug: 'alpha' },
      propertySlug: 'alpha',
    });

    const messageHandler = mockSubscriber.on.mock.calls.find(([event]) => event === 'message')[1];
    messageHandler('rz:sse_events', JSON.stringify({
      event: 'message',
      data: { id: 'm1', property_slug: 'alpha' },
      propertySlug: 'alpha',
    }));

    expect(localBroadcastToAll).toHaveBeenCalledWith(
      'message',
      { id: 'm1', property_slug: 'alpha' },
      { propertySlug: 'alpha' },
    );
    shutdown();
  });

  test('falls back to local scoped broadcast when Redis publish fails', async () => {
    mockPublish.mockRejectedValueOnce(new Error('redis down'));
    const sse = require('../sse');
    const localBroadcastToAll = jest.spyOn(sse, 'localBroadcastToAll').mockImplementation(() => {});
    const { init, shutdown } = require('../sse-redis');

    init();
    sse.broadcastChatMessage({ id: 'm1' }, { propertySlug: 'alpha' });
    await Promise.resolve();

    expect(localBroadcastToAll).toHaveBeenCalledWith(
      'message',
      { id: 'm1', property_slug: 'alpha' },
      { propertySlug: 'alpha' },
    );
    shutdown();
  });
});
