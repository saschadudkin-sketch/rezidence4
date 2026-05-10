'use strict';

const {
  createProviderConfig,
  ingestProviderAccessEvent,
  listHardwareDevices,
  listProviderConfigs,
  markIntegrationEventStatus,
  recordIntegrationEvent,
  registerHardwareDevice,
  syncPassAccess,
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

  test('ingests Hikvision-style inbound event into integration log and visit log', async () => {
    const providerRow = {
      id: PROVIDER_ID,
      property_id: PROPERTY_ID,
      provider: 'hikvision',
      status: 'active',
      config_json: { inbound_secret: 'secret-1' },
    };
    const deviceRow = { id: DEVICE_ID, access_point_id: POINT_ID };
    const integrationEvent = { id: EVENT_ID, status: 'processing' };
    const updatedEvent = { id: EVENT_ID, status: 'succeeded' };
    const visitLog = { id: 'visit-1', event_type: 'entry_allowed' };
    const queryable = makeQueryable((sql) => {
      if (sql.includes('FROM skud_provider_configs')) return Promise.resolve({ rows: [providerRow] });
      if (sql.includes('FROM skud_hardware_devices')) return Promise.resolve({ rows: [deviceRow] });
      if (sql.includes('INSERT INTO skud_integration_events')) return Promise.resolve({ rows: [integrationEvent] });
      if (sql.includes('FROM visit_logs_v2')) return Promise.resolve({ rows: [] });
      if (sql.includes('INSERT INTO visit_logs_v2')) return Promise.resolve({ rows: [visitLog] });
      if (sql.includes('UPDATE skud_integration_events')) return Promise.resolve({ rows: [updatedEvent] });
      if (sql.includes('UPDATE skud_provider_configs')) return Promise.resolve({ rows: [{ id: PROVIDER_ID, health_status: 'healthy' }] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const result = await ingestProviderAccessEvent(queryable, {
      propertyId: PROPERTY_ID,
      providerConfigId: PROVIDER_ID,
      providedSecret: 'secret-1',
      requireSecret: true,
      rawEvent: {
        AccessControllerEvent: {
          serialNo: 'hik-evt-1',
          deviceID: 'door-1',
          subEventType: 'accessGranted',
          direction: 'in',
          name: 'Guest One',
          dateTime: '2026-05-10T10:00:00.000Z',
        },
      },
    });

    expect(result.integration_event).toBe(updatedEvent);
    expect(result.visit_log).toBe(visitLog);
    expect(result.normalized_event).toMatchObject({
      eventType: 'entry_allowed',
      externalEventId: 'hik-evt-1',
      externalDeviceId: 'door-1',
      personLabel: 'Guest One',
    });
    const visitInsert = queryable.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO visit_logs_v2'));
    expect(visitInsert[1][1]).toBe(POINT_ID);
    expect(visitInsert[1][2]).toBe('entry_allowed');
    expect(visitInsert[1][5]).toBe('hik-evt-1');
  });

  test('ingests Bolid Orion-style inbound event into integration log and visit log', async () => {
    const providerRow = {
      id: PROVIDER_ID,
      property_id: PROPERTY_ID,
      provider: 'bolid',
      status: 'active',
      config_json: { inbound_secret: 'secret-2' },
    };
    const deviceRow = { id: DEVICE_ID, access_point_id: POINT_ID };
    const integrationEvent = { id: EVENT_ID, status: 'processing' };
    const updatedEvent = { id: EVENT_ID, status: 'succeeded' };
    const visitLog = { id: 'visit-2', event_type: 'exit_denied' };
    const queryable = makeQueryable((sql) => {
      if (sql.includes('FROM skud_provider_configs')) return Promise.resolve({ rows: [providerRow] });
      if (sql.includes('FROM skud_hardware_devices')) return Promise.resolve({ rows: [deviceRow] });
      if (sql.includes('INSERT INTO skud_integration_events')) return Promise.resolve({ rows: [integrationEvent] });
      if (sql.includes('FROM visit_logs_v2')) return Promise.resolve({ rows: [] });
      if (sql.includes('INSERT INTO visit_logs_v2')) return Promise.resolve({ rows: [visitLog] });
      if (sql.includes('UPDATE skud_integration_events')) return Promise.resolve({ rows: [updatedEvent] });
      if (sql.includes('UPDATE skud_provider_configs')) return Promise.resolve({ rows: [{ id: PROVIDER_ID, health_status: 'healthy' }] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const result = await ingestProviderAccessEvent(queryable, {
      propertyId: PROPERTY_ID,
      providerConfigId: PROVIDER_ID,
      providedSecret: 'secret-2',
      requireSecret: true,
      rawEvent: {
        event: {
          id: 'bolid-evt-1',
          device_id: 'orion-reader-1',
          event_type: 'ACCESS_DENIED',
          direction: 'exit',
          person_name: 'Guest Two',
          timestamp: '2026-05-10T11:00:00.000Z',
        },
      },
    });

    expect(result.integration_event).toBe(updatedEvent);
    expect(result.visit_log).toBe(visitLog);
    expect(result.normalized_event).toMatchObject({
      eventType: 'exit_denied',
      externalEventId: 'bolid-evt-1',
      externalDeviceId: 'orion-reader-1',
      personLabel: 'Guest Two',
    });
    const visitInsert = queryable.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO visit_logs_v2'));
    expect(visitInsert[1][1]).toBe(POINT_ID);
    expect(visitInsert[1][2]).toBe('exit_denied');
    expect(visitInsert[1][5]).toBe('bolid-evt-1');
  });

  test('rejects inbound event with invalid provider secret', async () => {
    const queryable = makeQueryable((sql) => {
      if (sql.includes('FROM skud_provider_configs')) {
        return Promise.resolve({
          rows: [{
            id: PROVIDER_ID,
            property_id: PROPERTY_ID,
            provider: 'hikvision',
            status: 'active',
            config_json: { inbound_secret: 'expected' },
          }],
        });
      }
      throw new Error(`unexpected SQL: ${sql}`);
    });

    await expect(ingestProviderAccessEvent(queryable, {
      propertyId: PROPERTY_ID,
      providerConfigId: PROVIDER_ID,
      providedSecret: 'wrong',
      requireSecret: true,
      rawEvent: {},
    })).rejects.toMatchObject({
      status: 401,
      message: 'Invalid SKUD inbound secret',
    });
  });

  test('syncs active pass through adapter and marks outbound event succeeded', async () => {
    const providerRow = { id: PROVIDER_ID, property_id: PROPERTY_ID, provider: 'hikvision', status: 'active' };
    const passRow = {
      id: 'pass-1',
      property_id: PROPERTY_ID,
      pass_type: 'guest',
      subject_type: 'guest',
      status: 'active',
      valid_from: '2026-05-10T09:00:00.000Z',
      valid_until: '2026-05-10T18:00:00.000Z',
      visitor_name: 'Guest One',
      point_id: POINT_ID,
    };
    const eventRow = { id: EVENT_ID, status: 'processing' };
    const doneRow = { id: EVENT_ID, status: 'succeeded' };
    const adapter = { provisionAccess: jest.fn().mockResolvedValue({ ok: true }) };
    const queryable = makeQueryable((sql) => {
      if (sql.includes('FROM skud_provider_configs')) return Promise.resolve({ rows: [providerRow] });
      if (sql.includes('FROM passes p')) return Promise.resolve({ rows: [passRow] });
      if (sql.includes('INSERT INTO skud_integration_events')) return Promise.resolve({ rows: [eventRow] });
      if (sql.includes('UPDATE skud_integration_events')) return Promise.resolve({ rows: [doneRow] });
      if (sql.includes('UPDATE skud_provider_configs')) return Promise.resolve({ rows: [{ id: PROVIDER_ID, health_status: 'healthy' }] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const result = await syncPassAccess(queryable, {
      propertyId: PROPERTY_ID,
      providerConfigId: PROVIDER_ID,
      passId: 'pass-1',
      action: 'provision',
      adapter,
    });

    expect(adapter.provisionAccess).toHaveBeenCalledWith(expect.objectContaining({
      passId: 'pass-1',
      name: 'Guest One',
      pointId: POINT_ID,
    }));
    expect(result.integration_event).toBe(doneRow);
    const eventInsert = queryable.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO skud_integration_events'));
    expect(eventInsert[1][4]).toBe('outbound');
    expect(eventInsert[1][5]).toBe('pass.provision');
  });
});
