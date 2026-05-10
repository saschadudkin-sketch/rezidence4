'use strict';

const crypto = require('crypto');
const { SkudAdapter } = require('../../services/skud/SkudAdapter');
const { createSkudAdapter } = require('../../services/skud');

const PROVIDERS = Object.freeze(['hikvision', 'bolid', 'sigur', 'parsec', 'generic']);
const SYNC_MODES = Object.freeze(['push', 'pull', 'hybrid', 'manual']);
const PROVIDER_STATUSES = Object.freeze(['active', 'disabled', 'degraded']);
const HEALTH_STATUSES = Object.freeze(['unknown', 'healthy', 'degraded', 'down']);
const DEVICE_CLASSES = Object.freeze([
  'controller',
  'reader',
  'barrier',
  'gate',
  'door',
  'turnstile',
  'wicket',
  'intercom',
  'lpr',
  'camera',
]);
const SOURCE_OF_TRUTH_VALUES = Object.freeze(['domhub', 'provider', 'manual']);
const FALLBACK_RULES = Object.freeze([
  'manual_guard',
  'manual_open',
  'provider_readonly',
  'offline_queue',
  'deny_until_restored',
]);
const DEVICE_DIRECTIONS = Object.freeze(['entry', 'exit', 'bidirectional']);
const EVENT_DIRECTIONS = Object.freeze(['inbound', 'outbound']);
const EVENT_STATUSES = Object.freeze([
  'pending',
  'processing',
  'succeeded',
  'failed',
  'retrying',
  'dead_lettered',
  'ignored',
]);
const VISIT_EVENT_TYPES = Object.freeze([
  'entry_allowed',
  'entry_denied',
  'exit_allowed',
  'exit_denied',
]);

const PROVIDER_COLS = `
  id, property_id, provider, display_name, status, sync_mode, base_url,
  auth_ref, config_json, capabilities, health_status, last_success_at,
  last_failure_at, last_error, created_by, created_at, updated_at
`;

const DEVICE_COLS = `
  id, property_id, provider_config_id, access_point_id, device_class, name,
  external_device_id, source_of_truth, fallback_rule, direction, status,
  metadata, last_seen_at, created_at, updated_at
`;

const EVENT_COLS = `
  id, property_id, provider_config_id, hardware_device_id, access_point_id,
  direction, event_type, external_event_id, status, domhub_entity_type,
  domhub_entity_id, payload, normalized_payload, error_code, error_message,
  attempts, occurred_at, processed_at, next_retry_at, created_at
`;

class SkudIntegrationServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'SkudIntegrationServiceError';
    this.status = status;
  }
}

function serviceError(status, message) {
  return new SkudIntegrationServiceError(status, message);
}

function isSkudIntegrationServiceError(err) {
  return err instanceof SkudIntegrationServiceError;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeText(value, field, maxLength = 120) {
  if (typeof value !== 'string' || !value.trim()) {
    throw serviceError(400, `${field} is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) throw serviceError(400, `${field} is too long`);
  return trimmed;
}

function normalizeNullableText(value, field) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw serviceError(400, `${field} must be string or null`);
  return value.trim() || null;
}

function normalizeEnum(value, allowed, field, fallback = null) {
  const raw = value === undefined || value === null || value === ''
    ? fallback
    : String(value).trim().toLowerCase();
  if (!raw || !allowed.includes(raw)) {
    throw serviceError(400, `${field} must be one of: ${allowed.join(', ')}`);
  }
  return raw;
}

function normalizeJsonObject(value, field) {
  if (value === undefined || value === null) return {};
  if (!isPlainObject(value)) throw serviceError(400, `${field} must be an object`);
  return value;
}

function normalizeJsonArray(value, field) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw serviceError(400, `${field} must be an array`);
  return value;
}

function parseJsonObject(value) {
  if (!value) return {};
  if (isPlainObject(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return isPlainObject(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function getInboundSecret(providerConfig) {
  const config = parseJsonObject(providerConfig?.config_json);
  return config.inbound_secret
    || config.inboundSecret
    || process.env.SKUD_INBOUND_SECRET
    || null;
}

function assertInboundSecret(providerConfig, providedSecret, { requireSecret = false } = {}) {
  const expected = getInboundSecret(providerConfig);
  if (!expected && !requireSecret) return;
  if (!expected) throw serviceError(500, 'SKUD inbound secret is not configured');
  if (!constantTimeEqual(String(providedSecret || ''), String(expected))) {
    throw serviceError(401, 'Invalid SKUD inbound secret');
  }
}

function createAdapterForProvider(providerConfig, adapter = null) {
  if (adapter) return adapter;
  const registered = createSkudAdapter(providerConfig);
  if (registered) return registered;
  if (providerConfig?.provider === 'generic') {
    return new SkudAdapter({ provider: 'generic', capabilities: ['inbound_events'] });
  }
  throw serviceError(422, `No SKUD adapter registered for provider '${providerConfig?.provider || 'unknown'}'`);
}

function normalizeVisitEventType(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!VISIT_EVENT_TYPES.includes(raw)) {
    throw serviceError(400, `event_type must be one of: ${VISIT_EVENT_TYPES.join(', ')}`);
  }
  return raw;
}

function resolvePassLabel(pass) {
  if (!pass) return null;
  return pass.visitor_name
    || pass.vehicle_plate
    || pass.subject_label
    || `${pass.subject_type}:${pass.id}`;
}

async function ensureProviderConfig(queryable, { propertyId, providerConfigId, requireActive = false }) {
  const { rows } = await queryable.query(
    `SELECT id, property_id, provider, status, sync_mode, base_url, auth_ref,
            config_json, capabilities, health_status
       FROM skud_provider_configs
      WHERE id = $1 AND property_id = $2
      LIMIT 1`,
    [providerConfigId, propertyId],
  );
  const row = rows[0] || null;
  if (!row) throw serviceError(404, 'SKUD provider config not found');
  if (requireActive && row.status !== 'active') {
    throw serviceError(409, 'SKUD provider config is not active');
  }
  return row;
}

async function findHardwareDeviceByExternalId(queryable, { propertyId, providerConfigId, externalDeviceId }) {
  if (!externalDeviceId) return null;
  const { rows } = await queryable.query(
    `SELECT ${DEVICE_COLS}
       FROM skud_hardware_devices
      WHERE property_id = $1
        AND provider_config_id = $2
        AND external_device_id = $3
      LIMIT 1`,
    [propertyId, providerConfigId, externalDeviceId],
  );
  return rows[0] || null;
}

async function ensureAccessPoint(queryable, { propertyId, accessPointId }) {
  if (!accessPointId) return null;
  const { rows } = await queryable.query(
    `SELECT id, point_type
       FROM access_points
      WHERE id = $1 AND property_id = $2 AND is_active = true
      LIMIT 1`,
    [accessPointId, propertyId],
  );
  if (!rows[0]) throw serviceError(400, 'access_point_id does not exist for this property');
  return rows[0];
}

async function createProviderConfig(queryable, input) {
  const propertyId = normalizeText(input.propertyId || input.property_id, 'property_id', 80);
  const provider = normalizeEnum(input.provider, PROVIDERS, 'provider');
  const displayName = normalizeText(input.displayName || input.display_name, 'display_name', 120);
  const status = normalizeEnum(input.status, PROVIDER_STATUSES, 'status', 'active');
  const syncMode = normalizeEnum(input.syncMode || input.sync_mode, SYNC_MODES, 'sync_mode', 'hybrid');
  const baseUrl = normalizeNullableText(input.baseUrl || input.base_url, 'base_url');
  const authRef = normalizeNullableText(input.authRef || input.auth_ref, 'auth_ref');
  const config = normalizeJsonObject(input.configJson || input.config_json || input.config, 'config_json');
  const capabilities = normalizeJsonArray(input.capabilities, 'capabilities');
  const createdBy = input.createdBy || input.created_by || null;

  const { rows } = await queryable.query(
    `INSERT INTO skud_provider_configs
       (property_id, provider, display_name, status, sync_mode, base_url,
        auth_ref, config_json, capabilities, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10)
     RETURNING ${PROVIDER_COLS}`,
    [
      propertyId,
      provider,
      displayName,
      status,
      syncMode,
      baseUrl,
      authRef,
      JSON.stringify(config),
      JSON.stringify(capabilities),
      createdBy,
    ],
  );
  return rows[0];
}

async function listProviderConfigs(queryable, { propertyId, status = null } = {}) {
  const filters = ['property_id = $1'];
  const params = [propertyId];
  if (status) {
    filters.push(`status = $${params.length + 1}`);
    params.push(normalizeEnum(status, PROVIDER_STATUSES, 'status'));
  }

  const { rows } = await queryable.query(
    `SELECT ${PROVIDER_COLS}
       FROM skud_provider_configs
      WHERE ${filters.join(' AND ')}
      ORDER BY provider ASC, display_name ASC`,
    params,
  );
  return rows;
}

async function updateProviderHealth(queryable, {
  propertyId,
  providerConfigId,
  healthStatus,
  lastError = null,
}) {
  const normalized = normalizeEnum(healthStatus, HEALTH_STATUSES, 'health_status');
  await ensureProviderConfig(queryable, { propertyId, providerConfigId });

  const { rows } = await queryable.query(
    `UPDATE skud_provider_configs
        SET health_status = $3,
            last_success_at = CASE WHEN $3 = 'healthy' THEN NOW() ELSE last_success_at END,
            last_failure_at = CASE WHEN $3 IN ('degraded','down') THEN NOW() ELSE last_failure_at END,
            last_error = $4,
            updated_at = NOW()
      WHERE id = $1 AND property_id = $2
      RETURNING ${PROVIDER_COLS}`,
    [providerConfigId, propertyId, normalized, lastError],
  );
  return rows[0];
}

async function registerHardwareDevice(queryable, input) {
  const propertyId = normalizeText(input.propertyId || input.property_id, 'property_id', 80);
  const providerConfigId = normalizeText(input.providerConfigId || input.provider_config_id, 'provider_config_id', 80);
  const accessPointId = input.accessPointId || input.access_point_id || null;
  const deviceClass = normalizeEnum(input.deviceClass || input.device_class, DEVICE_CLASSES, 'device_class');
  const name = normalizeText(input.name, 'name', 120);
  const externalDeviceId = normalizeText(input.externalDeviceId || input.external_device_id, 'external_device_id', 200);
  const sourceOfTruth = normalizeEnum(input.sourceOfTruth || input.source_of_truth, SOURCE_OF_TRUTH_VALUES, 'source_of_truth');
  const fallbackRule = normalizeEnum(input.fallbackRule || input.fallback_rule, FALLBACK_RULES, 'fallback_rule');
  const direction = normalizeEnum(input.direction, DEVICE_DIRECTIONS, 'direction', 'bidirectional');
  const status = normalizeEnum(input.status, PROVIDER_STATUSES, 'status', 'active');
  const metadata = normalizeJsonObject(input.metadata, 'metadata');

  await ensureProviderConfig(queryable, { propertyId, providerConfigId, requireActive: true });
  await ensureAccessPoint(queryable, { propertyId, accessPointId });

  const { rows } = await queryable.query(
    `INSERT INTO skud_hardware_devices
       (property_id, provider_config_id, access_point_id, device_class, name,
        external_device_id, source_of_truth, fallback_rule, direction, status, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
     RETURNING ${DEVICE_COLS}`,
    [
      propertyId,
      providerConfigId,
      accessPointId || null,
      deviceClass,
      name,
      externalDeviceId,
      sourceOfTruth,
      fallbackRule,
      direction,
      status,
      JSON.stringify(metadata),
    ],
  );
  return rows[0];
}

async function listHardwareDevices(queryable, { propertyId, providerConfigId = null, accessPointId = null } = {}) {
  const filters = ['property_id = $1'];
  const params = [propertyId];
  if (providerConfigId) {
    params.push(providerConfigId);
    filters.push(`provider_config_id = $${params.length}`);
  }
  if (accessPointId) {
    params.push(accessPointId);
    filters.push(`access_point_id = $${params.length}`);
  }

  const { rows } = await queryable.query(
    `SELECT ${DEVICE_COLS}
       FROM skud_hardware_devices
      WHERE ${filters.join(' AND ')}
      ORDER BY device_class ASC, name ASC`,
    params,
  );
  return rows;
}

async function recordIntegrationEvent(queryable, input) {
  const propertyId = normalizeText(input.propertyId || input.property_id, 'property_id', 80);
  const providerConfigId = normalizeText(input.providerConfigId || input.provider_config_id, 'provider_config_id', 80);
  const hardwareDeviceId = input.hardwareDeviceId || input.hardware_device_id || null;
  const accessPointId = input.accessPointId || input.access_point_id || null;
  const direction = normalizeEnum(input.direction, EVENT_DIRECTIONS, 'direction');
  const eventType = normalizeText(input.eventType || input.event_type, 'event_type', 60);
  const externalEventId = normalizeNullableText(input.externalEventId || input.external_event_id, 'external_event_id');
  const status = normalizeEnum(input.status, EVENT_STATUSES, 'status', 'pending');
  const payload = normalizeJsonObject(input.payload, 'payload');
  const normalizedPayload = input.normalizedPayload || input.normalized_payload || null;
  if (normalizedPayload !== null && !isPlainObject(normalizedPayload)) {
    throw serviceError(400, 'normalized_payload must be an object or null');
  }

  await ensureProviderConfig(queryable, { propertyId, providerConfigId });

  const { rows } = await queryable.query(
    `INSERT INTO skud_integration_events
       (property_id, provider_config_id, hardware_device_id, access_point_id,
        direction, event_type, external_event_id, status, domhub_entity_type,
        domhub_entity_id, payload, normalized_payload, error_code, error_message,
        attempts, occurred_at, next_retry_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14,$15,$16,$17)
     ON CONFLICT (property_id, provider_config_id, external_event_id)
       WHERE external_event_id IS NOT NULL
     DO UPDATE SET
       attempts = skud_integration_events.attempts + 1,
       payload = EXCLUDED.payload,
       normalized_payload = COALESCE(EXCLUDED.normalized_payload, skud_integration_events.normalized_payload),
       error_code = EXCLUDED.error_code,
       error_message = EXCLUDED.error_message,
       next_retry_at = EXCLUDED.next_retry_at
     RETURNING ${EVENT_COLS}`,
    [
      propertyId,
      providerConfigId,
      hardwareDeviceId,
      accessPointId,
      direction,
      eventType,
      externalEventId,
      status,
      input.domhubEntityType || input.domhub_entity_type || null,
      input.domhubEntityId || input.domhub_entity_id || null,
      JSON.stringify(payload),
      normalizedPayload ? JSON.stringify(normalizedPayload) : null,
      input.errorCode || input.error_code || null,
      input.errorMessage || input.error_message || null,
      Number.isInteger(input.attempts) ? input.attempts : 0,
      input.occurredAt || input.occurred_at || new Date().toISOString(),
      input.nextRetryAt || input.next_retry_at || null,
    ],
  );
  return rows[0];
}

async function markIntegrationEventStatus(queryable, {
  propertyId,
  eventId,
  status,
  errorCode = null,
  errorMessage = null,
  nextRetryAt = null,
}) {
  const normalized = normalizeEnum(status, EVENT_STATUSES, 'status');
  const { rows } = await queryable.query(
    `UPDATE skud_integration_events
        SET status = $3,
            error_code = $4,
            error_message = $5,
            next_retry_at = $6,
            processed_at = CASE WHEN $3 IN ('succeeded','failed','dead_lettered','ignored') THEN NOW() ELSE processed_at END
      WHERE id = $1 AND property_id = $2
      RETURNING ${EVENT_COLS}`,
    [eventId, propertyId, normalized, errorCode, errorMessage, nextRetryAt],
  );
  if (!rows[0]) throw serviceError(404, 'SKUD integration event not found');
  return rows[0];
}

async function recordProviderVisitLog(queryable, {
  propertyId,
  accessPointId = null,
  eventType,
  externalEventId = null,
  personLabel = null,
  vehiclePlate = null,
  providerPayload = {},
  occurredAt = null,
}) {
  if (externalEventId) {
    const { rows } = await queryable.query(
      `SELECT id, property_id, pass_id, access_point_id, event_type, event_source,
              person_label, vehicle_plate, performed_by_staff_id,
              provider_event_id, provider_payload, occurred_at, created_at
         FROM visit_logs_v2
        WHERE event_source = 'skud' AND provider_event_id = $1
        LIMIT 1`,
      [externalEventId],
    );
    if (rows[0]) return { visitLog: rows[0], idempotent: true };
  }

  const { rows } = await queryable.query(
    `INSERT INTO visit_logs_v2
       (property_id, pass_id, access_point_id, event_type, event_source,
        person_label, vehicle_plate, performed_by_staff_id,
        provider_event_id, provider_payload, occurred_at)
     VALUES ($1,NULL,$2,$3,'skud',$4,$5,NULL,$6,$7::jsonb,$8)
     RETURNING id, property_id, pass_id, access_point_id, event_type, event_source,
               person_label, vehicle_plate, performed_by_staff_id,
               provider_event_id, provider_payload, occurred_at, created_at`,
    [
      propertyId,
      accessPointId || null,
      eventType,
      personLabel || null,
      vehiclePlate || null,
      externalEventId || null,
      JSON.stringify(providerPayload || {}),
      occurredAt || new Date().toISOString(),
    ],
  );
  return { visitLog: rows[0], idempotent: false };
}

async function ingestProviderAccessEvent(queryable, {
  propertyId,
  providerConfigId,
  rawEvent,
  providedSecret = null,
  requireSecret = false,
  adapter = null,
}) {
  const providerConfig = await ensureProviderConfig(queryable, {
    propertyId,
    providerConfigId,
    requireActive: true,
  });
  assertInboundSecret(providerConfig, providedSecret, { requireSecret });

  const selectedAdapter = createAdapterForProvider(providerConfig, adapter);
  const normalized = selectedAdapter.normalizeInboundEvent(rawEvent || {});
  const eventType = normalizeVisitEventType(normalized.eventType);
  const device = await findHardwareDeviceByExternalId(queryable, {
    propertyId,
    providerConfigId,
    externalDeviceId: normalized.externalDeviceId,
  });
  const accessPointId = normalized.accessPointId || device?.access_point_id || null;
  const externalEventId = normalized.externalEventId || null;

  const integrationEvent = await recordIntegrationEvent(queryable, {
    propertyId,
    providerConfigId,
    hardwareDeviceId: device?.id || null,
    accessPointId,
    direction: 'inbound',
    eventType,
    externalEventId,
    status: 'processing',
    payload: rawEvent || {},
    normalizedPayload: {
      event_type: eventType,
      access_point_id: accessPointId,
      external_device_id: normalized.externalDeviceId || null,
      vehicle_plate: normalized.vehiclePlate || null,
      person_label: normalized.personLabel || null,
    },
    occurredAt: normalized.occurredAt || null,
  });

  const { visitLog, idempotent } = await recordProviderVisitLog(queryable, {
    propertyId,
    accessPointId,
    eventType,
    externalEventId,
    personLabel: normalized.personLabel || null,
    vehiclePlate: normalized.vehiclePlate || null,
    providerPayload: rawEvent || {},
    occurredAt: normalized.occurredAt || null,
  });

  const terminalStatus = idempotent ? 'ignored' : 'succeeded';
  const updatedEvent = await markIntegrationEventStatus(queryable, {
    propertyId,
    eventId: integrationEvent.id,
    status: terminalStatus,
  });
  await updateProviderHealth(queryable, {
    propertyId,
    providerConfigId,
    healthStatus: 'healthy',
    lastError: null,
  });

  return {
    provider_config: providerConfig,
    hardware_device: device,
    normalized_event: normalized,
    integration_event: updatedEvent,
    visit_log: visitLog,
    idempotent,
  };
}

async function loadPassForSync(queryable, { propertyId, passId }) {
  const { rows } = await queryable.query(
    `SELECT p.id, p.property_id, p.pass_type, p.subject_type, p.status,
            p.valid_from, p.valid_until, p.zone_id, p.point_id,
            ar.visitor_name, v.plate_number AS vehicle_plate
       FROM passes p
       LEFT JOIN access_requests ar ON ar.id = p.access_request_id
       LEFT JOIN vehicles v ON v.id = p.subject_vehicle_id
      WHERE p.id = $1 AND p.property_id = $2
      LIMIT 1`,
    [passId, propertyId],
  );
  if (!rows[0]) throw serviceError(404, 'Pass not found');
  return rows[0];
}

async function syncPassAccess(queryable, {
  propertyId,
  providerConfigId,
  passId,
  action = 'provision',
  adapter = null,
}) {
  const normalizedAction = normalizeEnum(action, ['provision', 'revoke'], 'action');
  const providerConfig = await ensureProviderConfig(queryable, {
    propertyId,
    providerConfigId,
    requireActive: true,
  });
  const pass = await loadPassForSync(queryable, { propertyId, passId });
  if (normalizedAction === 'provision' && pass.status !== 'active') {
    throw serviceError(409, 'Only active passes can be provisioned to SKUD');
  }

  const selectedAdapter = createAdapterForProvider(providerConfig, adapter);
  const integrationEvent = await recordIntegrationEvent(queryable, {
    propertyId,
    providerConfigId,
    hardwareDeviceId: null,
    accessPointId: pass.point_id || null,
    direction: 'outbound',
    eventType: `pass.${normalizedAction}`,
    externalEventId: `pass:${normalizedAction}:${pass.id}`,
    status: 'processing',
    domhubEntityType: 'pass',
    domhubEntityId: pass.id,
    payload: {
      pass_id: pass.id,
      pass_type: pass.pass_type,
      subject_type: pass.subject_type,
      valid_from: pass.valid_from,
      valid_until: pass.valid_until,
      action: normalizedAction,
    },
  });

  try {
    const command = {
      passId: pass.id,
      pass_id: pass.id,
      name: resolvePassLabel(pass),
      personName: resolvePassLabel(pass),
      validFrom: pass.valid_from,
      validUntil: pass.valid_until,
      zoneId: pass.zone_id,
      pointId: pass.point_id,
      vehiclePlate: pass.vehicle_plate,
    };
    const adapterResult = normalizedAction === 'provision'
      ? await selectedAdapter.provisionAccess(command)
      : await selectedAdapter.revokeAccess(command);
    const updatedEvent = await markIntegrationEventStatus(queryable, {
      propertyId,
      eventId: integrationEvent.id,
      status: 'succeeded',
    });
    await updateProviderHealth(queryable, {
      propertyId,
      providerConfigId,
      healthStatus: 'healthy',
      lastError: null,
    });
    return {
      provider_config: providerConfig,
      pass,
      integration_event: updatedEvent,
      adapter_result: adapterResult || null,
    };
  } catch (err) {
    await markIntegrationEventStatus(queryable, {
      propertyId,
      eventId: integrationEvent.id,
      status: 'failed',
      errorMessage: err.message,
    });
    await updateProviderHealth(queryable, {
      propertyId,
      providerConfigId,
      healthStatus: 'down',
      lastError: err.message,
    });
    throw serviceError(502, `SKUD ${normalizedAction} failed: ${err.message}`);
  }
}

module.exports = {
  DEVICE_CLASSES,
  DEVICE_DIRECTIONS,
  EVENT_DIRECTIONS,
  EVENT_STATUSES,
  FALLBACK_RULES,
  HEALTH_STATUSES,
  PROVIDERS,
  PROVIDER_STATUSES,
  SOURCE_OF_TRUTH_VALUES,
  SYNC_MODES,
  SkudIntegrationServiceError,
  createProviderConfig,
  ingestProviderAccessEvent,
  loadPassForSync,
  isSkudIntegrationServiceError,
  listHardwareDevices,
  listProviderConfigs,
  markIntegrationEventStatus,
  recordIntegrationEvent,
  registerHardwareDevice,
  syncPassAccess,
  updateProviderHealth,
};
