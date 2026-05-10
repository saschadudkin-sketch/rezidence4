'use strict';

const {
  createSkudAdapter,
  getRegisteredSkudProviders,
  registerSkudAdapter,
} = require('../services/skud');
const { SkudAdapter } = require('../services/skud/SkudAdapter');

describe('SKUD adapter registry', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
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

    expect(adapter.normalizeInboundEvent({ id: 'external-1', event_type: 'entry_allowed' })).toEqual({
      provider: 'generic',
      eventType: 'entry_allowed',
      externalEventId: 'external-1',
      payload: { id: 'external-1', event_type: 'entry_allowed' },
    });
  });
});
