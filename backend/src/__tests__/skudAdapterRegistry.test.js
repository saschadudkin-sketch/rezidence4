'use strict';

const {
  createSkudAdapter,
  getRegisteredSkudProviders,
  registerSkudAdapter,
} = require('../services/skud');
const { BolidAdapter } = require('../services/skud/BolidAdapter');
const { SkudAdapter } = require('../services/skud/SkudAdapter');

describe('SKUD adapter registry', () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('lists built-in provider adapters', () => {
    expect(getRegisteredSkudProviders()).toEqual(expect.arrayContaining(['bolid', 'hikvision']));
  });

  test('creates adapter from tenant provider config before env fallback', () => {
    process.env.SKUD_ADAPTER = 'bolid';
    const adapter = createSkudAdapter({
      id: 'cfg-1',
      property_id: 'property-1',
      provider: 'hikvision',
      base_url: 'https://hikvision.example',
      config_json: { username: 'tenant-user', password: 'tenant-pass' },
    });

    expect(adapter.provider).toBe('hikvision');
    expect(adapter.baseUrl).toBe('https://hikvision.example');
    expect(adapter.supports('inbound_events')).toBe(true);
  });

  test('keeps legacy env/property feature flag fallback for old callers', () => {
    delete process.env.SKUD_ADAPTER;
    const adapter = createSkudAdapter({
      feature_flags: { skud_adapter: 'bolid' },
    });

    expect(adapter.provider).toBe('bolid');
    expect(adapter.supports('provision_access')).toBe(true);
  });

  test('allows registering a bounded custom adapter for future providers', () => {
    class SigurAdapter extends SkudAdapter {
      constructor(config) {
        super({ provider: 'sigur', capabilities: ['inbound_events'], config });
      }
    }

    registerSkudAdapter('sigur', SigurAdapter);
    const adapter = createSkudAdapter({ provider: 'sigur', config_json: { endpoint: 'x' } });

    expect(adapter.provider).toBe('sigur');
    expect(adapter.supports('inbound_events')).toBe(true);
    expect(adapter.config.endpoint).toBe('x');
  });

  test('base adapter normalizes inbound events without leaking vendor-specific shape', () => {
    const adapter = new SkudAdapter({ provider: 'generic', capabilities: ['inbound_events'] });

    expect(adapter.normalizeInboundEvent({ id: 'external-1', event_type: 'entry_allowed' })).toMatchObject({
      provider: 'generic',
      eventType: 'entry_allowed',
      externalEventId: 'external-1',
      externalDeviceId: null,
      accessPointId: null,
      vehiclePlate: null,
      personLabel: null,
      payload: { id: 'external-1', event_type: 'entry_allowed' },
    });
  });

  test('Bolid adapter sends Orion Pro JSON-RPC visit provisioning request', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: { success: true, operationResult: { id: 42 } },
      }),
    });
    const adapter = new BolidAdapter({
      apiUrl: 'http://orion.local:8090/jsonrpc/iorionpro',
      username: 'http-user',
      password: 'http-pass',
      authToken: 'token-1',
      requestTimeoutMs: 1000,
    });

    await expect(adapter.addAccess('pass-1', {
      name: 'Guest One',
      validUntil: '2026-05-10T18:00:00.000Z',
      raw: { pointId: 'entry-1', vehiclePlate: 'A001AA' },
    })).resolves.toEqual({ id: 42 });

    const [url, request] = global.fetch.mock.calls[0];
    const body = JSON.parse(request.body);
    expect(url).toBe('http://orion.local:8090/jsonrpc/iorionpro');
    expect(request.headers.Authorization).toBe(`Basic ${Buffer.from('http-user:http-pass').toString('base64')}`);
    expect(body.method).toBe('addVisit');
    expect(body.params.token).toBe('token-1');
    expect(body.params.visit).toMatchObject({
      id: 'pass-1',
      visitorName: 'Guest One',
      visitedRoom: 'entry-1',
      carNumber: 'A001AA',
    });
  });

  test('Bolid adapter normalizes Orion-style access events', () => {
    const adapter = new BolidAdapter({});

    expect(adapter.normalizeInboundEvent({
      event: {
        id: 71,
        device_id: 'reader-7',
        event_type: 'ACCESS_DENIED',
        direction: 'exit',
        person_name: 'Guest One',
        plateNumber: 'A001AA',
        timestamp: '2026-05-10T10:00:00.000Z',
      },
    })).toMatchObject({
      provider: 'bolid',
      eventType: 'exit_denied',
      externalEventId: 71,
      externalDeviceId: 'reader-7',
      vehiclePlate: 'A001AA',
      personLabel: 'Guest One',
      occurredAt: '2026-05-10T10:00:00.000Z',
    });
  });
});
