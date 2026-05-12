'use strict';

const {
  createProviderConfig,
  getProviderFailureDashboard,
  ingestProviderAccessEvent,
  listHardwareManualControlEvents,
  listHardwareDevices,
  listProviderConfigs,
  markIntegrationEventStatus,
  recordFieldRolloutEvidence,
  recordHardwareManualControl,
  recordIntegrationEvent,
  registerHardwareDevice,
  syncPassAccess,
  updateHardwareManualBoundary,
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

  test('normalizes common Russia SKUD provider aliases on config creation', async () => {
    const queryable = makeQueryable((sql, params) => Promise.resolve({
      rows: [{ id: PROVIDER_ID, property_id: PROPERTY_ID, provider: params[1] }],
    }));

    await expect(createProviderConfig(queryable, {
      propertyId: PROPERTY_ID,
      provider: 'PERCo-Web',
      displayName: 'PERCo КПП',
    })).resolves.toMatchObject({ provider: 'perco' });
    await expect(createProviderConfig(queryable, {
      propertyId: PROPERTY_ID,
      provider: 'ParsecNET3',
      displayName: 'Parsec КПП',
    })).resolves.toMatchObject({ provider: 'parsec' });
    await expect(createProviderConfig(queryable, {
      propertyId: PROPERTY_ID,
      provider: 'Orion',
      displayName: 'Орион КПП',
    })).resolves.toMatchObject({ provider: 'bolid' });

    expect(queryable.query.mock.calls.map(([, params]) => params[1])).toEqual(['perco', 'parsec', 'bolid']);
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

  test('builds provider failure dashboard from provider, event, device and manual evidence', async () => {
    const provider = {
      id: PROVIDER_ID,
      property_id: PROPERTY_ID,
      provider: 'hikvision',
      display_name: 'Main gate Hikvision',
      status: 'active',
      sync_mode: 'hybrid',
      health_status: 'down',
      last_success_at: '2026-05-10T08:00:00.000Z',
      last_failure_at: '2026-05-11T08:30:00.000Z',
      last_error: 'timeout',
    };
    const queryable = makeQueryable((sql) => {
      if (sql.includes('FROM skud_provider_configs p')) {
        return Promise.resolve({ rows: [provider] });
      }
      if (sql.includes('WITH ranked_errors')) {
        return Promise.resolve({
          rows: [{
            provider_config_id: PROVIDER_ID,
            error_code: 'provider_timeout',
            sample_error_message: 'Controller did not respond',
            total: '2',
            last_seen_at: '2026-05-11T08:45:00.000Z',
          }],
        });
      }
      if (sql.includes('FROM skud_integration_events e')) {
        return Promise.resolve({
          rows: [{
            provider_config_id: PROVIDER_ID,
            total_events: '6',
            succeeded_events: '2',
            failed_events: '2',
            retrying_events: '1',
            dead_lettered_events: '1',
            pending_events: '0',
            ignored_events: '0',
            last_event_at: '2026-05-11T08:45:00.000Z',
            last_failure_event_at: '2026-05-11T08:45:00.000Z',
          }],
        });
      }
      if (sql.includes('FROM skud_hardware_devices d')) {
        return Promise.resolve({
          rows: [{
            provider_config_id: PROVIDER_ID,
            total_devices: '3',
            degraded_devices: '2',
            out_of_service_devices: '1',
            manual_guard_devices: '1',
            fail_closed_devices: '2',
          }],
        });
      }
      if (sql.includes('FROM hardware_manual_control_events e')) {
        return Promise.resolve({
          rows: [{
            provider_config_id: PROVIDER_ID,
            manual_control_events: '4',
            last_manual_action_at: '2026-05-11T08:50:00.000Z',
          }],
        });
      }
      if (sql.includes('FROM skud_field_rollout_evidence e')) {
        return Promise.resolve({
          rows: [{
            id: 'rollout-1',
            property_id: PROPERTY_ID,
            provider_config_id: PROVIDER_ID,
            hardware_device_id: DEVICE_ID,
            provider: 'hikvision',
            provider_display_name: 'Main gate Hikvision',
            hardware_device_name: 'Main gate controller',
            rollout_stage: 'pilot',
            evidence_type: 'field_drill',
            status: 'passed',
            summary: 'Guard field drill passed',
            metrics: { attempts: 3, failures: 0 },
            observed_at: '2026-05-11T08:55:00.000Z',
            recorded_by_uid: 'admin-1',
          }],
        });
      }
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const dashboard = await getProviderFailureDashboard(queryable, {
      propertyId: PROPERTY_ID,
      windowHours: 24,
      limit: 10,
    });

    expect(dashboard).toMatchObject({
      property_id: PROPERTY_ID,
      window_hours: 24,
      summary: {
        providers_total: 1,
        providers_down: 1,
        providers_needing_attention: 1,
        failed_events: 2,
        retrying_events: 1,
        dead_lettered_events: 1,
        manual_control_events: 4,
        out_of_service_devices: 1,
        field_rollout_records: 1,
      },
      field_rollout_evidence: {
        source_tables: [
          'skud_provider_configs',
          'skud_integration_events',
          'skud_hardware_devices',
          'hardware_manual_control_events',
          'skud_field_rollout_evidence',
        ],
        real_failure_rows: 4,
        manual_control_event_rows: 4,
        rollout_evidence_rows: 1,
      },
    });
    expect(dashboard.field_rollout_records[0]).toMatchObject({
      evidence_type: 'field_drill',
      status: 'passed',
    });
    expect(dashboard.providers[0]).toMatchObject({
      provider_config: { id: PROVIDER_ID, health_status: 'down' },
      event_summary: { total_events: 6, failed_events: 2 },
      device_summary: { total_devices: 3, out_of_service_devices: 1 },
      manual_control_summary: { manual_control_events: 4 },
      top_errors: [{ error_code: 'provider_timeout', total: 2 }],
      needs_attention: true,
      attention_reasons: expect.arrayContaining([
        'provider_down',
        'failed_events',
        'retrying_events',
        'dead_lettered_events',
        'out_of_service_devices',
        'manual_control_events',
      ]),
    });
    expect(queryable.query.mock.calls[0][1]).toEqual([PROPERTY_ID, 10]);
    expect(queryable.query.mock.calls[0][0]).not.toContain('config_json');
    expect(queryable.query.mock.calls[0][0]).not.toContain('auth_ref');
    expect(queryable.query.mock.calls[1][1]).toEqual([PROPERTY_ID, 24]);
  });

  test('records SKUD field rollout evidence after provider and device scope checks', async () => {
    const queryable = makeQueryable((sql) => {
      if (sql.includes('FROM skud_provider_configs')) return Promise.resolve({ rows: [{ id: PROVIDER_ID }] });
      if (sql.includes('FROM skud_hardware_devices')) return Promise.resolve({ rows: [{ id: DEVICE_ID }] });
      if (sql.includes('INSERT INTO skud_field_rollout_evidence')) {
        return Promise.resolve({
          rows: [{
            id: 'rollout-1',
            property_id: PROPERTY_ID,
            provider_config_id: PROVIDER_ID,
            hardware_device_id: DEVICE_ID,
            rollout_stage: 'pilot',
            evidence_type: 'vendor_health_probe',
            status: 'passed',
            summary: 'Vendor probe passed',
            metrics: { latency_ms: 120 },
            recorded_by_uid: 'admin-1',
          }],
        });
      }
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const evidence = await recordFieldRolloutEvidence(queryable, {
      propertyId: PROPERTY_ID,
      providerConfigId: PROVIDER_ID,
      hardwareDeviceId: DEVICE_ID,
      evidenceType: 'vendor_health_probe',
      status: 'passed',
      summary: 'Vendor probe passed',
      metrics: { latency_ms: 120 },
      actorUid: 'admin-1',
    });

    expect(evidence).toMatchObject({
      evidence_type: 'vendor_health_probe',
      status: 'passed',
      metrics: { latency_ms: 120 },
    });
    expect(queryable.query.mock.calls[2][0]).toMatch(/INSERT INTO skud_field_rollout_evidence/);
  });

  test('updates hardware manual boundary and writes audit snapshot', async () => {
    const existing = {
      id: DEVICE_ID,
      property_id: PROPERTY_ID,
      manual_control_policy: 'guard_allowed',
      manual_action_requires_reason: true,
      manual_action_requires_approval: false,
      fail_safe_mode: 'fail_closed',
      maintenance_status: 'normal',
    };
    const updated = { ...existing, manual_control_policy: 'admin_only', fail_safe_mode: 'manual_guard' };
    const queryable = makeQueryable((sql) => {
      if (sql.includes('SELECT') && sql.includes('FROM skud_hardware_devices')) return Promise.resolve({ rows: [existing] });
      if (sql.includes('UPDATE skud_hardware_devices')) return Promise.resolve({ rows: [updated] });
      if (sql.includes('INSERT INTO property_audit_log')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    await expect(updateHardwareManualBoundary(queryable, {
      propertyId: PROPERTY_ID,
      hardwareDeviceId: DEVICE_ID,
      manual_control_policy: 'admin_only',
      fail_safe_mode: 'manual_guard',
      actorUid: 'admin-1',
      actorRole: 'admin',
    })).resolves.toMatchObject({ hardware_device: updated });

    const update = queryable.query.mock.calls.find(([sql]) => sql.includes('UPDATE skud_hardware_devices'));
    expect(update[0]).toContain('manual_control_policy = $1');
    expect(update[0]).toContain('fail_safe_mode = $2');
    const audit = queryable.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO property_audit_log'));
    expect(audit[1][4]).toContain('"manual_control_policy":"guard_allowed"');
  });

  test('records allowed guard manual control event and updates device last action', async () => {
    const device = {
      id: DEVICE_ID,
      property_id: PROPERTY_ID,
      status: 'active',
      manual_control_policy: 'guard_allowed',
      manual_action_requires_reason: true,
      manual_action_requires_approval: false,
      fail_safe_mode: 'manual_guard',
      maintenance_status: 'normal',
    };
    const eventRow = { id: EVENT_ID, action: 'manual_open' };
    const updated = { ...device, last_manual_action_by_uid: 'guard-1' };
    const queryable = makeQueryable((sql) => {
      if (sql.includes('SELECT') && sql.includes('FROM skud_hardware_devices')) return Promise.resolve({ rows: [device] });
      if (sql.includes('INSERT INTO hardware_manual_control_events')) return Promise.resolve({ rows: [eventRow] });
      if (sql.includes('UPDATE skud_hardware_devices')) return Promise.resolve({ rows: [updated] });
      if (sql.includes('INSERT INTO property_audit_log')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    await expect(recordHardwareManualControl(queryable, {
      propertyId: PROPERTY_ID,
      hardwareDeviceId: DEVICE_ID,
      action: 'manual_open',
      reason: 'Provider is degraded, guard verified resident manually',
      user: { uid: 'guard-1', role: 'security' },
    })).resolves.toMatchObject({
      hardware_device: updated,
      manual_control_event: eventRow,
    });

    const insert = queryable.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO hardware_manual_control_events'));
    expect(insert[1][2]).toBe('manual_open');
    expect(insert[1][3]).toBe('guard-1');
    expect(insert[1][6]).toBe('guard');
    const audit = queryable.query.mock.calls.find(([sql]) => sql.includes('hardware.manual_control.executed'));
    expect(audit[1][4]).toContain('"action":"manual_open"');
  });

  test('blocks guard manual control when device policy is admin_only', async () => {
    const queryable = makeQueryable((sql) => {
      if (sql.includes('FROM skud_hardware_devices')) {
        return Promise.resolve({
          rows: [{
            id: DEVICE_ID,
            property_id: PROPERTY_ID,
            status: 'active',
            manual_control_policy: 'admin_only',
            manual_action_requires_reason: true,
            manual_action_requires_approval: false,
            fail_safe_mode: 'fail_closed',
            maintenance_status: 'normal',
          }],
        });
      }
      throw new Error(`unexpected SQL: ${sql}`);
    });

    await expect(recordHardwareManualControl(queryable, {
      propertyId: PROPERTY_ID,
      hardwareDeviceId: DEVICE_ID,
      action: 'manual_open',
      reason: 'Need admin',
      user: { uid: 'guard-1', role: 'security' },
    })).rejects.toMatchObject({
      status: 403,
      message: 'Manual control requires property admin',
    });
  });

  test('lists manual control events after confirming hardware device scope', async () => {
    const queryable = makeQueryable((sql) => {
      if (sql.includes('FROM skud_hardware_devices')) return Promise.resolve({ rows: [{ id: DEVICE_ID }] });
      if (sql.includes('FROM hardware_manual_control_events')) return Promise.resolve({ rows: [{ id: EVENT_ID }] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    await expect(listHardwareManualControlEvents(queryable, {
      propertyId: PROPERTY_ID,
      hardwareDeviceId: DEVICE_ID,
      limit: 10,
    })).resolves.toEqual([{ id: EVENT_ID }]);
    expect(queryable.query.mock.calls[1][1]).toEqual([PROPERTY_ID, DEVICE_ID, 10]);
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
