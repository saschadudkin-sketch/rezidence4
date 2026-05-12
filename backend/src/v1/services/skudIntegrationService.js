'use strict';

const crypto = require('crypto');
const { createSkudAdapter, getRegisteredSkudProviders } = require('../../services/skud');

const PROVIDERS = Object.freeze(getRegisteredSkudProviders());
const PROVIDER_ALIASES = Object.freeze({
  bolid_orion: 'bolid',
  orion: 'bolid',
  orion_pro: 'bolid',
  parsecnet: 'parsec',
  parsecnet3: 'parsec',
  perco_web: 'perco',
  perco_web2: 'perco',
  'perco-web': 'perco',
  'perco-web2': 'perco',
  trassir: 'trassir_access',
  trassir_access_control: 'trassir_access',
  'trassir-access': 'trassir_access',
  iron_logic: 'ironlogic',
  'iron-logic': 'ironlogic',
  rus_guard: 'rusguard',
  rus_guard_soft: 'rusguard',
});
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
const MANUAL_CONTROL_POLICIES = Object.freeze([
  'guard_allowed',
  'admin_only',
  'provider_only',
  'prohibited',
]);
const FAIL_SAFE_MODES = Object.freeze([
  'fail_closed',
  'fail_open_guarded',
  'provider_default',
  'manual_guard',
]);
const MAINTENANCE_STATUSES = Object.freeze(['normal', 'maintenance', 'out_of_service']);
const MANUAL_CONTROL_ACTIONS = Object.freeze([
  'manual_open',
  'manual_close',
  'manual_block',
  'manual_unblock',
  'manual_reset',
  'mark_degraded',
  'mark_restored',
]);
const MANUAL_CONTROL_DECISION_SOURCES = Object.freeze([
  'guard',
  'admin',
  'incident',
  'provider_fallback',
]);
const FIELD_ROLLOUT_STAGES = Object.freeze(['lab', 'staging', 'pilot', 'production']);
const FIELD_ROLLOUT_EVIDENCE_TYPES = Object.freeze([
  'provider_delivery',
  'field_drill',
  'rollout_report',
  'vendor_health_probe',
]);
const FIELD_ROLLOUT_STATUSES = Object.freeze(['planned', 'running', 'passed', 'failed', 'blocked']);
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

const PROVIDER_DASHBOARD_COLS = `
  id, property_id, provider, display_name, status, sync_mode, capabilities,
  health_status, last_success_at, last_failure_at, last_error, created_by,
  created_at, updated_at
`;

const DEVICE_COLS = `
  id, property_id, provider_config_id, access_point_id, device_class, name,
  external_device_id, source_of_truth, fallback_rule, direction, status,
  metadata, last_seen_at, manual_control_policy,
  manual_action_requires_reason, manual_action_requires_approval, fail_safe_mode,
  maintenance_status, last_manual_action_at, last_manual_action_by_uid,
  created_at, updated_at
`;

const MANUAL_CONTROL_EVENT_COLS = `
  id, property_id, hardware_device_id, action, actor_uid, actor_role, reason,
  decision_source, metadata, created_at
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

function normalizeProvider(value) {
  const raw = normalizeEnum(value, PROVIDERS.concat(Object.keys(PROVIDER_ALIASES)), 'provider');
  const canonical = PROVIDER_ALIASES[raw] || raw;
  if (!PROVIDERS.includes(canonical)) {
    throw serviceError(400, `provider must be one of: ${PROVIDERS.join(', ')}`);
  }
  return canonical;
}

function normalizeJsonObject(value, field) {
  if (value === undefined || value === null) return {};
  if (!isPlainObject(value)) throw serviceError(400, `${field} must be an object`);
  return value;
}

function formatFieldRolloutEvidenceRow(row) {
  return {
    id: row.id,
    property_id: row.property_id,
    provider_config_id: row.provider_config_id || null,
    hardware_device_id: row.hardware_device_id || null,
    provider: row.provider || null,
    provider_display_name: row.provider_display_name || null,
    hardware_device_name: row.hardware_device_name || null,
    rollout_stage: row.rollout_stage,
    evidence_type: row.evidence_type,
    status: row.status,
    summary: row.summary || null,
    metrics: normalizeJsonObject(row.metrics || {}, 'metrics'),
    observed_at: row.observed_at || null,
    recorded_by_uid: row.recorded_by_uid || null,
    created_at: row.created_at || null,
  };
}

function normalizeBoolean(value, field, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  throw serviceError(400, `${field} must be boolean`);
}

function toInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeBoundedInt(value, fallback, { min = 1, max = 100 } = {}) {
  const parsed = Number.parseInt(value, 10);
  const safe = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(max, Math.max(min, safe));
}

function userIsPropertyAdmin(user) {
  return ['admin', 'property_admin', 'management_company_admin', 'platform_admin']
    .includes(String(user?.role || '').trim());
}

function userIsGuard(user) {
  return ['security', 'admin', 'property_admin', 'management_company_admin', 'platform_admin']
    .includes(String(user?.role || '').trim());
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

async function ensureHardwareDevice(queryable, { propertyId, hardwareDeviceId }) {
  const { rows } = await queryable.query(
    `SELECT ${DEVICE_COLS}
       FROM skud_hardware_devices
      WHERE id = $1 AND property_id = $2
      LIMIT 1`,
    [hardwareDeviceId, propertyId],
  );
  const row = rows[0] || null;
  if (!row) throw serviceError(404, 'Hardware device not found');
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
  const provider = normalizeProvider(input.provider);
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

async function updateHardwareManualBoundary(queryable, input) {
  const propertyId = normalizeText(input.propertyId || input.property_id, 'property_id', 80);
  const hardwareDeviceId = normalizeText(input.hardwareDeviceId || input.hardware_device_id, 'hardware_device_id', 80);
  const existing = await ensureHardwareDevice(queryable, { propertyId, hardwareDeviceId });

  const changes = {};
  if (input.manualControlPolicy !== undefined || input.manual_control_policy !== undefined) {
    changes.manual_control_policy = normalizeEnum(
      input.manualControlPolicy || input.manual_control_policy,
      MANUAL_CONTROL_POLICIES,
      'manual_control_policy',
    );
  }
  if (input.failSafeMode !== undefined || input.fail_safe_mode !== undefined) {
    changes.fail_safe_mode = normalizeEnum(
      input.failSafeMode || input.fail_safe_mode,
      FAIL_SAFE_MODES,
      'fail_safe_mode',
    );
  }
  if (input.maintenanceStatus !== undefined || input.maintenance_status !== undefined) {
    changes.maintenance_status = normalizeEnum(
      input.maintenanceStatus || input.maintenance_status,
      MAINTENANCE_STATUSES,
      'maintenance_status',
    );
  }
  if (input.manualActionRequiresReason !== undefined || input.manual_action_requires_reason !== undefined) {
    changes.manual_action_requires_reason = normalizeBoolean(
      input.manualActionRequiresReason ?? input.manual_action_requires_reason,
      'manual_action_requires_reason',
      existing.manual_action_requires_reason !== false,
    );
  }
  if (input.manualActionRequiresApproval !== undefined || input.manual_action_requires_approval !== undefined) {
    changes.manual_action_requires_approval = normalizeBoolean(
      input.manualActionRequiresApproval ?? input.manual_action_requires_approval,
      'manual_action_requires_approval',
      existing.manual_action_requires_approval === true,
    );
  }
  if (!Object.keys(changes).length) throw serviceError(400, 'No boundary fields provided');

  const sets = [];
  const params = [];
  for (const [key, value] of Object.entries(changes)) {
    params.push(value);
    sets.push(`${key} = $${params.length}`);
  }
  sets.push('updated_at = NOW()');
  params.push(hardwareDeviceId, propertyId);

  const { rows } = await queryable.query(
    `UPDATE skud_hardware_devices
        SET ${sets.join(', ')}
      WHERE id = $${params.length - 1} AND property_id = $${params.length}
      RETURNING ${DEVICE_COLS}`,
    params,
  );
  if (!rows[0]) throw serviceError(404, 'Hardware device not found');

  await queryable.query(
    `INSERT INTO property_audit_log
       (property_id, actor_uid, actor_role, actor_type, entity_type, entity_id,
        action, resource_type, resource_id, changes, ip_address)
     VALUES ($1,$2,$3,'staff','skud_hardware_device',$4,
             'hardware.device.updated','skud_hardware_device',$4,$5,$6)`,
    [
      propertyId,
      input.actorUid || input.actor_uid || null,
      input.actorRole || input.actor_role || null,
      hardwareDeviceId,
      JSON.stringify({
        before: {
          manual_control_policy: existing.manual_control_policy,
          manual_action_requires_reason: existing.manual_action_requires_reason,
          manual_action_requires_approval: existing.manual_action_requires_approval,
          fail_safe_mode: existing.fail_safe_mode,
          maintenance_status: existing.maintenance_status,
        },
        after: changes,
      }),
      input.ipAddress || input.ip_address || null,
    ],
  );

  return { hardware_device: rows[0] };
}

function assertManualControlAllowed(device, { user, action, reason, metadata }) {
  if (device.status === 'disabled') {
    throw serviceError(409, 'Hardware device is disabled');
  }
  if (device.manual_control_policy === 'prohibited') {
    throw serviceError(409, 'Manual control is prohibited for this hardware device');
  }
  if (device.manual_control_policy === 'provider_only') {
    throw serviceError(409, 'Manual control is delegated to provider only');
  }
  if (device.manual_control_policy === 'admin_only' && !userIsPropertyAdmin(user)) {
    throw serviceError(403, 'Manual control requires property admin');
  }
  if (!userIsGuard(user)) {
    throw serviceError(403, 'Manual control requires security or admin role');
  }
  if (device.manual_action_requires_reason !== false && (!reason || !String(reason).trim())) {
    throw serviceError(422, 'reason is required');
  }
  if (device.manual_action_requires_approval === true) {
    const approvalId = metadata?.approval_id || metadata?.approvalId || null;
    if (!approvalId && !userIsPropertyAdmin(user)) {
      throw serviceError(409, 'Manual control requires approval evidence');
    }
  }
  if (action === 'manual_open' && device.fail_safe_mode === 'fail_closed' && device.maintenance_status === 'out_of_service') {
    throw serviceError(409, 'Device is out of service and fail-safe is closed');
  }
}

async function recordHardwareManualControl(queryable, input) {
  const propertyId = normalizeText(input.propertyId || input.property_id, 'property_id', 80);
  const hardwareDeviceId = normalizeText(input.hardwareDeviceId || input.hardware_device_id, 'hardware_device_id', 80);
  const action = normalizeEnum(input.action, MANUAL_CONTROL_ACTIONS, 'action');
  const decisionSource = normalizeEnum(
    input.decisionSource || input.decision_source,
    MANUAL_CONTROL_DECISION_SOURCES,
    'decision_source',
    userIsPropertyAdmin(input.user) ? 'admin' : 'guard',
  );
  const metadata = normalizeJsonObject(input.metadata, 'metadata');
  const reason = normalizeText(input.reason, 'reason', 500);
  const actorUid = normalizeText(input.actorUid || input.actor_uid || input.user?.uid, 'actor_uid', 120);
  const actorRole = normalizeNullableText(input.actorRole || input.actor_role || input.user?.role, 'actor_role');
  const device = await ensureHardwareDevice(queryable, { propertyId, hardwareDeviceId });
  assertManualControlAllowed(device, {
    user: input.user || { role: actorRole },
    action,
    reason,
    metadata,
  });

  const { rows: eventRows } = await queryable.query(
    `INSERT INTO hardware_manual_control_events
       (property_id, hardware_device_id, action, actor_uid, actor_role,
        reason, decision_source, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
     RETURNING ${MANUAL_CONTROL_EVENT_COLS}`,
    [
      propertyId,
      hardwareDeviceId,
      action,
      actorUid,
      actorRole,
      reason,
      decisionSource,
      JSON.stringify(metadata),
    ],
  );
  const event = eventRows[0];

  const nextMaintenanceStatus = action === 'mark_degraded'
    ? 'maintenance'
    : (action === 'mark_restored' ? 'normal' : device.maintenance_status);
  const { rows: deviceRows } = await queryable.query(
    `UPDATE skud_hardware_devices
        SET last_manual_action_at = NOW(),
            last_manual_action_by_uid = $3,
            maintenance_status = $4,
            updated_at = NOW()
      WHERE id = $1 AND property_id = $2
      RETURNING ${DEVICE_COLS}`,
    [hardwareDeviceId, propertyId, actorUid, nextMaintenanceStatus],
  );

  await queryable.query(
    `INSERT INTO property_audit_log
       (property_id, actor_uid, actor_role, actor_type, entity_type, entity_id,
        action, resource_type, resource_id, changes, ip_address)
     VALUES ($1,$2,$3,'staff','skud_hardware_device',$4,
             'hardware.manual_control.executed','skud_hardware_device',$4,$5,$6)`,
    [
      propertyId,
      actorUid,
      actorRole,
      hardwareDeviceId,
      JSON.stringify({
        action,
        decision_source: decisionSource,
        reason,
        event_id: event.id,
        manual_control_policy: device.manual_control_policy,
        fail_safe_mode: device.fail_safe_mode,
        maintenance_status_before: device.maintenance_status,
        maintenance_status_after: nextMaintenanceStatus,
        metadata,
      }),
      input.ipAddress || input.ip_address || null,
    ],
  );

  return {
    hardware_device: deviceRows[0] || device,
    manual_control_event: event,
  };
}

async function listHardwareManualControlEvents(queryable, {
  propertyId,
  hardwareDeviceId,
  limit = 50,
} = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
  await ensureHardwareDevice(queryable, { propertyId, hardwareDeviceId });
  const { rows } = await queryable.query(
    `SELECT ${MANUAL_CONTROL_EVENT_COLS}
       FROM hardware_manual_control_events
      WHERE property_id = $1 AND hardware_device_id = $2
      ORDER BY created_at DESC
      LIMIT $3`,
    [propertyId, hardwareDeviceId, safeLimit],
  );
  return rows;
}

function indexRowsByProvider(rows, mapper) {
  const map = new Map();
  for (const row of rows || []) {
    map.set(row.provider_config_id, mapper(row));
  }
  return map;
}

function groupTopErrors(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const providerId = row.provider_config_id;
    if (!map.has(providerId)) map.set(providerId, []);
    map.get(providerId).push({
      error_code: row.error_code || 'unknown',
      error_message: row.sample_error_message || null,
      total: toInt(row.total),
      last_seen_at: row.last_seen_at || null,
    });
  }
  return map;
}

function emptyProviderEventSummary() {
  return {
    total_events: 0,
    succeeded_events: 0,
    failed_events: 0,
    retrying_events: 0,
    dead_lettered_events: 0,
    pending_events: 0,
    ignored_events: 0,
    last_event_at: null,
    last_failure_event_at: null,
  };
}

function emptyDeviceSummary() {
  return {
    total_devices: 0,
    degraded_devices: 0,
    out_of_service_devices: 0,
    manual_guard_devices: 0,
    fail_closed_devices: 0,
  };
}

function emptyManualSummary() {
  return {
    manual_control_events: 0,
    last_manual_action_at: null,
  };
}

function providerAttentionReasons(provider, eventSummary, deviceSummary, manualSummary) {
  const reasons = [];
  if (provider.health_status === 'down') reasons.push('provider_down');
  if (provider.health_status === 'degraded' || provider.status === 'degraded') {
    reasons.push('provider_degraded');
  }
  if (eventSummary.failed_events > 0) reasons.push('failed_events');
  if (eventSummary.retrying_events > 0) reasons.push('retrying_events');
  if (eventSummary.dead_lettered_events > 0) reasons.push('dead_lettered_events');
  if (deviceSummary.out_of_service_devices > 0) reasons.push('out_of_service_devices');
  if (manualSummary.manual_control_events > 0) reasons.push('manual_control_events');
  return reasons;
}

async function getProviderFailureDashboard(queryable, {
  propertyId,
  windowHours = 24,
  limit = 20,
} = {}) {
  const normalizedPropertyId = normalizeText(propertyId, 'property_id', 80);
  const safeWindowHours = normalizeBoundedInt(windowHours, 24, { min: 1, max: 720 });
  const safeLimit = normalizeBoundedInt(limit, 20, { min: 1, max: 100 });
  const generatedAt = new Date().toISOString();

  const providersResult = await queryable.query(
    `SELECT ${PROVIDER_DASHBOARD_COLS}
       FROM skud_provider_configs p
      WHERE p.property_id = $1
      ORDER BY
        CASE p.health_status WHEN 'down' THEN 0 WHEN 'degraded' THEN 1 ELSE 2 END,
        p.provider ASC,
        p.display_name ASC
      LIMIT $2`,
    [normalizedPropertyId, safeLimit],
  );

  const eventResult = await queryable.query(
    `SELECT e.provider_config_id,
            COUNT(*)::int AS total_events,
            COUNT(*) FILTER (WHERE e.status = 'succeeded')::int AS succeeded_events,
            COUNT(*) FILTER (WHERE e.status = 'failed')::int AS failed_events,
            COUNT(*) FILTER (WHERE e.status = 'retrying')::int AS retrying_events,
            COUNT(*) FILTER (WHERE e.status = 'dead_lettered')::int AS dead_lettered_events,
            COUNT(*) FILTER (WHERE e.status IN ('pending','processing'))::int AS pending_events,
            COUNT(*) FILTER (WHERE e.status = 'ignored')::int AS ignored_events,
            MAX(e.created_at) AS last_event_at,
            MAX(e.created_at) FILTER (WHERE e.status IN ('failed','retrying','dead_lettered')) AS last_failure_event_at
       FROM skud_integration_events e
      WHERE e.property_id = $1
        AND e.created_at >= NOW() - ($2::int * INTERVAL '1 hour')
      GROUP BY e.provider_config_id`,
    [normalizedPropertyId, safeWindowHours],
  );

  const errorResult = await queryable.query(
    `WITH ranked_errors AS (
       SELECT e.provider_config_id,
              COALESCE(NULLIF(e.error_code, ''), 'unknown') AS error_code,
              MAX(NULLIF(e.error_message, '')) AS sample_error_message,
              COUNT(*)::int AS total,
              MAX(e.created_at) AS last_seen_at,
              ROW_NUMBER() OVER (
                PARTITION BY e.provider_config_id
                ORDER BY COUNT(*) DESC, MAX(e.created_at) DESC
              ) AS rn
         FROM skud_integration_events e
        WHERE e.property_id = $1
          AND e.status IN ('failed','retrying','dead_lettered')
          AND e.created_at >= NOW() - ($2::int * INTERVAL '1 hour')
        GROUP BY e.provider_config_id, COALESCE(NULLIF(e.error_code, ''), 'unknown')
     )
     SELECT provider_config_id, error_code, sample_error_message, total, last_seen_at
       FROM ranked_errors
      WHERE rn <= 5
      ORDER BY total DESC, last_seen_at DESC`,
    [normalizedPropertyId, safeWindowHours],
  );

  const deviceResult = await queryable.query(
    `SELECT d.provider_config_id,
            COUNT(*)::int AS total_devices,
            COUNT(*) FILTER (
              WHERE d.status = 'degraded'
                 OR d.maintenance_status IN ('maintenance','out_of_service')
            )::int AS degraded_devices,
            COUNT(*) FILTER (WHERE d.maintenance_status = 'out_of_service')::int AS out_of_service_devices,
            COUNT(*) FILTER (
              WHERE d.fallback_rule = 'manual_guard'
                 OR d.fail_safe_mode = 'manual_guard'
            )::int AS manual_guard_devices,
            COUNT(*) FILTER (WHERE d.fail_safe_mode = 'fail_closed')::int AS fail_closed_devices
       FROM skud_hardware_devices d
      WHERE d.property_id = $1
      GROUP BY d.provider_config_id`,
    [normalizedPropertyId],
  );

  const manualResult = await queryable.query(
    `SELECT d.provider_config_id,
            COUNT(*)::int AS manual_control_events,
            MAX(e.created_at) AS last_manual_action_at
       FROM hardware_manual_control_events e
       JOIN skud_hardware_devices d
         ON d.id = e.hardware_device_id
        AND d.property_id = e.property_id
      WHERE e.property_id = $1
        AND e.created_at >= NOW() - ($2::int * INTERVAL '1 hour')
      GROUP BY d.provider_config_id`,
    [normalizedPropertyId, safeWindowHours],
  );

  const rolloutResult = await queryable.query(
    `SELECT e.id,
            e.property_id,
            e.provider_config_id,
            e.hardware_device_id,
            p.provider,
            p.display_name AS provider_display_name,
            d.name AS hardware_device_name,
            e.rollout_stage,
            e.evidence_type,
            e.status,
            e.summary,
            e.metrics,
            e.observed_at,
            e.recorded_by_uid,
            e.created_at
       FROM skud_field_rollout_evidence e
       LEFT JOIN skud_provider_configs p ON p.id = e.provider_config_id
       LEFT JOIN skud_hardware_devices d ON d.id = e.hardware_device_id
      WHERE e.property_id = $1
        AND e.observed_at >= NOW() - ($2::int * INTERVAL '1 hour')
      ORDER BY e.observed_at DESC, e.created_at DESC
      LIMIT $3`,
    [normalizedPropertyId, safeWindowHours, safeLimit],
  );

  const eventsByProvider = indexRowsByProvider(eventResult.rows, (row) => ({
    total_events: toInt(row.total_events),
    succeeded_events: toInt(row.succeeded_events),
    failed_events: toInt(row.failed_events),
    retrying_events: toInt(row.retrying_events),
    dead_lettered_events: toInt(row.dead_lettered_events),
    pending_events: toInt(row.pending_events),
    ignored_events: toInt(row.ignored_events),
    last_event_at: row.last_event_at || null,
    last_failure_event_at: row.last_failure_event_at || null,
  }));
  const devicesByProvider = indexRowsByProvider(deviceResult.rows, (row) => ({
    total_devices: toInt(row.total_devices),
    degraded_devices: toInt(row.degraded_devices),
    out_of_service_devices: toInt(row.out_of_service_devices),
    manual_guard_devices: toInt(row.manual_guard_devices),
    fail_closed_devices: toInt(row.fail_closed_devices),
  }));
  const manualByProvider = indexRowsByProvider(manualResult.rows, (row) => ({
    manual_control_events: toInt(row.manual_control_events),
    last_manual_action_at: row.last_manual_action_at || null,
  }));
  const errorsByProvider = groupTopErrors(errorResult.rows);
  const fieldRolloutRecords = rolloutResult.rows.map(formatFieldRolloutEvidenceRow);

  const providers = providersResult.rows.map((provider) => {
    const eventSummary = eventsByProvider.get(provider.id) || emptyProviderEventSummary();
    const deviceSummary = devicesByProvider.get(provider.id) || emptyDeviceSummary();
    const manualSummary = manualByProvider.get(provider.id) || emptyManualSummary();
    const attentionReasons = providerAttentionReasons(provider, eventSummary, deviceSummary, manualSummary);
    return {
      provider_config: provider,
      event_summary: eventSummary,
      device_summary: deviceSummary,
      manual_control_summary: manualSummary,
      top_errors: errorsByProvider.get(provider.id) || [],
      needs_attention: attentionReasons.length > 0,
      attention_reasons: attentionReasons,
    };
  });

  const summary = providers.reduce((acc, item) => {
    const provider = item.provider_config;
    const events = item.event_summary;
    const devices = item.device_summary;
    const manual = item.manual_control_summary;
    acc.providers_total += 1;
    if (provider.health_status === 'down') acc.providers_down += 1;
    if (provider.health_status === 'degraded' || provider.status === 'degraded') acc.providers_degraded += 1;
    if (item.needs_attention) acc.providers_needing_attention += 1;
    acc.failed_events += events.failed_events;
    acc.retrying_events += events.retrying_events;
    acc.dead_lettered_events += events.dead_lettered_events;
    acc.manual_control_events += manual.manual_control_events;
    acc.out_of_service_devices += devices.out_of_service_devices;
    return acc;
  }, {
    providers_total: 0,
    providers_down: 0,
    providers_degraded: 0,
    providers_needing_attention: 0,
    failed_events: 0,
    retrying_events: 0,
    dead_lettered_events: 0,
    manual_control_events: 0,
    out_of_service_devices: 0,
    field_rollout_records: 0,
  });
  summary.field_rollout_records = fieldRolloutRecords.length;

  return {
    property_id: normalizedPropertyId,
    generated_at: generatedAt,
    window_hours: safeWindowHours,
    summary,
    providers,
    field_rollout_records: fieldRolloutRecords,
    field_rollout_evidence: {
      source_tables: [
        'skud_provider_configs',
        'skud_integration_events',
        'skud_hardware_devices',
        'hardware_manual_control_events',
        'skud_field_rollout_evidence',
      ],
      evidence_window_hours: safeWindowHours,
      returned_provider_configs: providers.length,
      active_provider_configs: providers.filter((item) => item.provider_config.status === 'active').length,
      real_failure_rows: summary.failed_events + summary.retrying_events + summary.dead_lettered_events,
      manual_control_event_rows: summary.manual_control_events,
      rollout_evidence_rows: fieldRolloutRecords.length,
      generated_at: generatedAt,
    },
  };
}

async function recordFieldRolloutEvidence(queryable, input = {}) {
  const propertyId = normalizeText(input.propertyId || input.property_id, 'property_id', 80);
  const providerConfigId = input.providerConfigId || input.provider_config_id || null;
  const hardwareDeviceId = input.hardwareDeviceId || input.hardware_device_id || null;
  const rolloutStage = normalizeEnum(
    input.rolloutStage || input.rollout_stage,
    FIELD_ROLLOUT_STAGES,
    'rollout_stage',
    'pilot',
  );
  const evidenceType = normalizeEnum(
    input.evidenceType || input.evidence_type,
    FIELD_ROLLOUT_EVIDENCE_TYPES,
    'evidence_type',
  );
  const status = normalizeEnum(input.status, FIELD_ROLLOUT_STATUSES, 'status', 'passed');
  const metrics = normalizeJsonObject(input.metrics || {}, 'metrics');
  const summary = normalizeNullableText(input.summary, 'summary');

  if (providerConfigId) {
    await ensureProviderConfig(queryable, { propertyId, providerConfigId });
  }
  if (hardwareDeviceId) {
    await ensureHardwareDevice(queryable, { propertyId, hardwareDeviceId });
  }

  const { rows } = await queryable.query(
    `INSERT INTO skud_field_rollout_evidence
       (property_id, provider_config_id, hardware_device_id, rollout_stage,
        evidence_type, status, summary, metrics, observed_at, recorded_by_uid)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,COALESCE($9::timestamptz, NOW()),$10)
     RETURNING id, property_id, provider_config_id, hardware_device_id,
               rollout_stage, evidence_type, status, summary, metrics,
               observed_at, recorded_by_uid, created_at`,
    [
      propertyId,
      providerConfigId,
      hardwareDeviceId,
      rolloutStage,
      evidenceType,
      status,
      summary,
      JSON.stringify(metrics),
      input.observedAt || input.observed_at || null,
      input.actorUid || input.actor_uid || null,
    ],
  );

  return formatFieldRolloutEvidenceRow(rows[0]);
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
  FIELD_ROLLOUT_EVIDENCE_TYPES,
  FIELD_ROLLOUT_STAGES,
  FIELD_ROLLOUT_STATUSES,
  FAIL_SAFE_MODES,
  FALLBACK_RULES,
  HEALTH_STATUSES,
  MAINTENANCE_STATUSES,
  MANUAL_CONTROL_ACTIONS,
  MANUAL_CONTROL_DECISION_SOURCES,
  MANUAL_CONTROL_POLICIES,
  PROVIDERS,
  PROVIDER_STATUSES,
  SOURCE_OF_TRUTH_VALUES,
  SYNC_MODES,
  SkudIntegrationServiceError,
  createProviderConfig,
  getProviderFailureDashboard,
  ingestProviderAccessEvent,
  listHardwareManualControlEvents,
  loadPassForSync,
  isSkudIntegrationServiceError,
  listHardwareDevices,
  listProviderConfigs,
  markIntegrationEventStatus,
  recordIntegrationEvent,
  recordFieldRolloutEvidence,
  recordHardwareManualControl,
  registerHardwareDevice,
  syncPassAccess,
  updateHardwareManualBoundary,
  updateProviderHealth,
};
