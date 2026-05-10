'use strict';

const {
  createProviderConfig,
  listHardwareDevices,
  listProviderConfigs,
  markIntegrationEventStatus,
  recordIntegrationEvent,
  registerHardwareDevice,
  updateProviderHealth,
} = require('../v1/services/skudIntegrationService');

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111';
const PROVIDER_ID = '22222222-2222-4222-8222-222222222222';
const POINT_ID = '33333333-3333-4333-8333-333333333333';
const DEVICE_ID = '44444444-4444-4444-8444-444444444444';
const EVENT_ID = '55555555-5555-4555-8555-555555555555';

function makeQueryable(handler) {
  return { query: jest.fn(handler) };
}

describe('SkudIntegrationService', () => {
  test('creates provider config with sanitized provider, sync mode and capabilities', async () => {
    const row = { id: PROVIDER_ID, property_id: PROPERTY_ID, provider: 'hikvision' };
    const queryable = makeQueryable(() => Promise.resolve({ rows: [row] }));

    await expect(createProviderConfig(queryable, {
      propertyId: PROPERTY_ID,
      provider: 'HIKVISION',
      displayName: ' КПП Hikvision ',
      syncMode: 'Hybrid',
      config: { pollingSeconds: 30 },
      capabilities: ['inbound_events'],
    })).resolves.toBe(row);

    const [sql, params] = queryable.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO skud_provider_configs');
    expect(params[1]).toBe('hikvision');
    expect(params[2]).toBe('КПП Hikvision');
    expect(params[4]).toBe('hybrid');
    expect(params[7]).toBe(JSON.stringify({ pollingSeconds: 30 }));
    expect(params[8]).toBe(JSON.stringify(['inbound_events']));
  });

  test('rejects unsupported provider names before writing', async () => {
    const queryable = makeQueryable(() => Promise.resolve({ rows: [] }));

    await expect(createProviderConfig(queryable, {
      propertyId: PROPERTY_ID,
      provider: 'unknown',
      displayName: 'Unknown',
    })).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('provider must be one of'),
    });
    expect(queryable.query).not.toHaveBeenCalled();
  });

  test('registers hardware device only after provider and access point are scoped to property', async () => {
    const providerRow = { id: PROVIDER_ID, property_id: PROPERTY_ID, status: 'active' };
    const pointRow = { id: POINT_ID, point_type: 'barrier' };
    const deviceRow = { id: DEVICE_ID, source_of_truth: 'domhub', fallback_rule: 'manual_guard' };
    const queryable = makeQueryable((sql) => {
      if (sql.includes('FROM skud_provider_configs')) return Promise.resolve({ rows: [providerRow] });
      if (sql.includes('FROM access_points')) return Promise.resolve({ rows: [pointRow] });
      if (sql.includes('INSERT INTO skud_hardware_devices')) return Promise.resolve({ rows: [deviceRow] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    await expect(registerHardwareDevice(queryable, {
      propertyId: PROPERTY_ID,
      providerConfigId: PROVIDER_ID,
      accessPointId: POINT_ID,
      deviceClass: 'barrier',
      name: 'Barrier lane 1',
      externalDeviceId: 'barrier-1',
      sourceOfTruth: 'domhub',
      fallbackRule: 'manual_guard',
      direction: 'entry',
    })).resolves.toBe(deviceRow);

    expect(queryable.query.mock.calls[0][0]).toContain('FROM skud_provider_configs');
    expect(queryable.query.mock.calls[1][0]).toContain('FROM access_points');
    expect(queryable.query.mock.calls[2][0]).toContain('INSERT INTO skud_hardware_devices');
  });

  test('blocks hardware registration against disabled provider config', async () => {
    const queryable = makeQueryable(() => Promise.resolve({
      rows: [{ id: PROVIDER_ID, property_id: PROPERTY_ID, status: 'disabled' }],
    }));

    await expect(registerHardwareDevice(queryable, {
      propertyId: PROPERTY_ID,
      providerConfigId: PROVIDER_ID,
      deviceClass: 'reader',
      name: 'Reader',
      externalDeviceId: 'reader-1',
      sourceOfTruth: 'provider',
      fallbackRule: 'provider_readonly',
    })).rejects.toMatchObject({
      status: 409,
      message: 'SKUD provider config is not active',
    });
  });

  test('records idempotent integration event with external event conflict target', async () => {
    const eventRow = { id: EVENT_ID, external_event_id: 'evt-1', attempts: 0 };
    const queryable = makeQueryable((sql) => {
      if (sql.includes('FROM skud_provider_configs')) {
        return Promise.resolve({ rows: [{ id: PROVIDER_ID, property_id: PROPERTY_ID, status: 'active' }] });
      }
      if (sql.includes('INSERT INTO skud_integration_events')) return Promise.resolve({ rows: [eventRow] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    await expect(recordIntegrationEvent(queryable, {
      propertyId: PROPERTY_ID,
      providerConfigId: PROVIDER_ID,
      hardwareDeviceId: DEVICE_ID,
      accessPointId: POINT_ID,
      direction: 'inbound',
      eventType: 'entry_allowed',
      externalEventId: 'evt-1',
      status: 'pending',
      payload: { raw: true },
      normalizedPayload: { event_type: 'entry_allowed' },
    })).resolves.toBe(eventRow);

    const [sql, params] = queryable.query.mock.calls[1];
    expect(sql).toContain('ON CONFLICT (property_id, provider_config_id, external_event_id)');
    expect(sql).toContain('attempts = skud_integration_events.attempts + 1');
    expect(params[4]).toBe('inbound');
    expect(params[10]).toBe(JSON.stringify({ raw: true }));
  });

  test('updates provider health and event terminal status', async () => {
    const queryable = makeQueryable((sql) => {
      if (sql.includes('FROM skud_provider_configs')) {
        return Promise.resolve({ rows: [{ id: PROVIDER_ID, property_id: PROPERTY_ID }] });
      }
      if (sql.includes('UPDATE skud_provider_configs')) {
        return Promise.resolve({ rows: [{ id: PROVIDER_ID, health_status: 'down' }] });
      }
      if (sql.includes('UPDATE skud_integration_events')) {
        return Promise.resolve({ rows: [{ id: EVENT_ID, status: 'dead_lettered' }] });
      }
      throw new Error(`unexpected SQL: ${sql}`);
    });

    await expect(updateProviderHealth(queryable, {
      propertyId: PROPERTY_ID,
      providerConfigId: PROVIDER_ID,
      healthStatus: 'down',
      lastError: 'timeout',
    })).resolves.toMatchObject({ health_status: 'down' });

    await expect(markIntegrationEventStatus(queryable, {
      propertyId: PROPERTY_ID,
      eventId: EVENT_ID,
      status: 'dead_lettered',
      errorMessage: 'timeout',
    })).resolves.toMatchObject({ status: 'dead_lettered' });
  });

  test('list helpers keep tenant boundary in SQL params', async () => {
    const queryable = makeQueryable(() => Promise.resolve({ rows: [] }));

    await listProviderConfigs(queryable, { propertyId: PROPERTY_ID, status: 'active' });
    await listHardwareDevices(queryable, { propertyId: PROPERTY_ID, providerConfigId: PROVIDER_ID });

    expect(queryable.query.mock.calls[0][0]).toContain('FROM skud_provider_configs');
    expect(queryable.query.mock.calls[0][1]).toEqual([PROPERTY_ID, 'active']);
    expect(queryable.query.mock.calls[1][0]).toContain('FROM skud_hardware_devices');
    expect(queryable.query.mock.calls[1][1]).toEqual([PROPERTY_ID, PROVIDER_ID]);
  });
});
