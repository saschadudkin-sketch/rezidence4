'use strict';

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
  isSkudIntegrationServiceError,
  listHardwareDevices,
  listProviderConfigs,
  markIntegrationEventStatus,
  recordIntegrationEvent,
  registerHardwareDevice,
  updateProviderHealth,
};
