'use strict';

const { resolveStaffIdByUid } = require('./accessActorResolver');

const ERP_PROVIDERS = Object.freeze([
  'one_c',
  'one_c_zhkh',
  'housing_erp',
  'generic_csv',
  'generic_rest',
  'generic_webhook',
]);
const ERP_PROVIDER_ALIASES = Object.freeze({
  '1c': 'one_c',
  '1с': 'one_c',
  '1c_zhkh': 'one_c_zhkh',
  '1c_жкх': 'one_c_zhkh',
  '1с_жкх': 'one_c_zhkh',
  '1c:zhkh': 'one_c_zhkh',
  '1с:жкх': 'one_c_zhkh',
  '1c_uk': 'one_c_zhkh',
  '1с_ук': 'one_c_zhkh',
  csv: 'generic_csv',
  rest: 'generic_rest',
  webhook: 'generic_webhook',
});

const PROVIDER_STATUSES = Object.freeze(['active', 'disabled', 'degraded']);
const HEALTH_STATUSES = Object.freeze(['unknown', 'healthy', 'degraded', 'down']);
const SYNC_MODES = Object.freeze(['import_only', 'export_only', 'hybrid', 'manual']);
const SOURCES = Object.freeze(['csv', 'rest', 'webhook', 'manual']);
const IMPORT_DATASETS = Object.freeze([
  'property_structure',
  'resident_registry',
  'staff_registry',
  'contractor_registry',
  'vehicle_registry',
]);
const EXPORT_DATASETS = Object.freeze([
  'access_events_summary',
  'incident_summary',
  'request_summary',
]);
const EXTERNAL_ENTITY_TYPES = Object.freeze([
  'property',
  'building',
  'entrance',
  'unit',
  'resident',
  'staff_user',
  'contractor_company',
  'contractor_user',
  'vehicle',
  'account',
]);
const RESIDENT_TYPES = Object.freeze(['owner', 'tenant', 'family_member']);

const PROVIDER_CONFIG_COLS = `
  id, property_id, provider, display_name, status, sync_mode, base_url, auth_ref,
  config_json, capabilities, health_status, last_success_at, last_failure_at,
  last_error, created_by, created_at, updated_at
`;

const SYNC_JOB_COLS = `
  id, property_id, provider_config_id, direction, dataset, source, mode, status,
  summary, error_message, created_by, started_at, completed_at, created_at, updated_at
`;

const SYNC_RECORD_COLS = `
  id, property_id, sync_job_id, provider_config_id, row_index,
  external_entity_type, external_id, operation, status, domhub_entity_type,
  domhub_entity_id, validation_errors, payload, normalized_payload, created_at
`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRET_KEY_RE = /(password|secret|token|api[_-]?key|private[_-]?key|client[_-]?secret)/i;

class ErpExchangeServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ErpExchangeServiceError';
    this.status = status;
  }
}

function serviceError(status, message) {
  return new ErpExchangeServiceError(status, message);
}

function isErpExchangeServiceError(err) {
  return err instanceof ErpExchangeServiceError;
}

function isValidUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

function requireUuid(value, field) {
  if (!isValidUuid(value)) throw serviceError(400, `${field} must be UUID`);
  return value;
}

function firstPresent(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function normalizeText(value, field, maxLen = 300, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw serviceError(400, `${field} is required`);
    return null;
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw serviceError(400, `${field} must be string`);
  }
  const trimmed = String(value).trim();
  if (!trimmed) {
    if (required) throw serviceError(400, `${field} is required`);
    return null;
  }
  if (trimmed.length > maxLen) throw serviceError(400, `${field} is too long`);
  return trimmed;
}

function normalizeRequiredText(value, field, maxLen = 300) {
  return normalizeText(value, field, maxLen, { required: true });
}

function normalizeNullableText(value, field, maxLen = 300) {
  return normalizeText(value, field, maxLen, { required: false });
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
  const raw = String(value || '').trim().toLowerCase();
  const provider = ERP_PROVIDER_ALIASES[raw] || raw;
  if (!ERP_PROVIDERS.includes(provider)) {
    throw serviceError(400, `provider must be one of: ${ERP_PROVIDERS.join(', ')}`);
  }
  return provider;
}

function normalizeBaseUrl(value, field = 'base_url') {
  const text = normalizeNullableText(value, field, 2048);
  if (!text) return null;
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('unsupported protocol');
    }
    parsed.username = '';
    parsed.password = '';
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    throw serviceError(400, `${field} must be http(s) URL`);
  }
}

function normalizeJsonObject(value, field) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw serviceError(400, `${field} must be object`);
  }
  return value;
}

function normalizeJsonArray(value, field) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw serviceError(400, `${field} must be array`);
  return value;
}

function assertNoInlineSecrets(value, path = 'config_json') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (SECRET_KEY_RE.test(key) && child !== null && child !== undefined && String(child).trim() !== '') {
      throw serviceError(400, `${childPath} must use auth_ref, not inline secrets`);
    }
    if (child && typeof child === 'object') assertNoInlineSecrets(child, childPath);
  }
}

function normalizeBoolean(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true || value === false) return value;
  const raw = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'да'].includes(raw)) return true;
  if (['false', '0', 'no', 'n', 'нет'].includes(raw)) return false;
  return fallback;
}

function normalizeNullableInteger(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n)) throw serviceError(400, `${field} must be integer`);
  return n;
}

function normalizeTimestampBoundary(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw serviceError(400, `${field} must be an ISO timestamp`);
  return date.toISOString();
}

function normalizeLimit(value) {
  if (value === undefined || value === null || value === '') return 500;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 1000) {
    throw serviceError(400, 'limit must be integer between 1 and 1000');
  }
  return n;
}

function defaultCapabilities(provider) {
  if (provider === 'generic_csv') return ['csv_import', 'json_export'];
  if (provider === 'generic_rest') return ['rest_import', 'rest_export'];
  if (provider === 'generic_webhook') return ['webhook_export', 'webhook_import'];
  return [
    'csv_import',
    'rest_import',
    'json_export',
    'resident_registry_import',
    'request_summary_export',
    'access_event_export',
  ];
}

async function requireStaffId(queryable, user) {
  const staffId = await resolveStaffIdByUid(queryable, user?.uid);
  if (!staffId) throw serviceError(403, 'Staff identity is not mapped to v1');
  return staffId;
}

async function writeAudit(queryable, {
  propertyId,
  user,
  staffId = null,
  action,
  entityType = 'erp_provider_config',
  entityId = null,
  resourceType = entityType,
  resourceId = entityId,
  changes,
  ipAddress = null,
}) {
  await queryable.query(
    `INSERT INTO property_audit_log
       (property_id, actor_uid, actor_role, actor_type, entity_type, entity_id,
        action, resource_type, resource_id, changes, ip_address)
     VALUES ($1,$2,$3,'staff',$4,$5,$6,$7,$8,$9,$10)`,
    [
      propertyId,
      user?.uid || null,
      user?.role || null,
      entityType,
      entityId || staffId,
      action,
      resourceType,
      resourceId,
      changes ? JSON.stringify(changes) : null,
      ipAddress,
    ],
  );
}

async function ensureProviderConfig(queryable, { propertyId, providerConfigId, allowDisabled = true }) {
  requireUuid(propertyId, 'property_id');
  requireUuid(providerConfigId, 'provider_config_id');
  const { rows } = await queryable.query(
    `SELECT ${PROVIDER_CONFIG_COLS}
       FROM erp_provider_configs
      WHERE property_id = $1 AND id = $2
      LIMIT 1`,
    [propertyId, providerConfigId],
  );
  const providerConfig = rows[0];
  if (!providerConfig) throw serviceError(404, 'ERP provider config not found');
  if (!allowDisabled && providerConfig.status === 'disabled') {
    throw serviceError(409, 'ERP provider config is disabled');
  }
  return providerConfig;
}

async function createErpProviderConfig(queryable, {
  propertyId,
  input,
  user,
  ipAddress = null,
}) {
  requireUuid(propertyId, 'property_id');
  const payload = input || {};
  const provider = normalizeProvider(payload.provider);
  const displayName = normalizeRequiredText(payload.display_name || payload.displayName, 'display_name', 120);
  const status = normalizeEnum(payload.status, PROVIDER_STATUSES, 'status', 'active');
  const syncMode = normalizeEnum(payload.sync_mode || payload.syncMode, SYNC_MODES, 'sync_mode', 'import_only');
  const baseUrl = normalizeBaseUrl(payload.base_url || payload.baseUrl, 'base_url');
  const authRef = normalizeNullableText(payload.auth_ref || payload.authRef, 'auth_ref', 300);
  const config = normalizeJsonObject(payload.config_json || payload.configJson || payload.config, 'config_json');
  assertNoInlineSecrets(config);
  const requestedCapabilities = normalizeJsonArray(payload.capabilities, 'capabilities')
    .map((item) => normalizeNullableText(item, 'capability', 80))
    .filter(Boolean);
  const capabilities = requestedCapabilities.length ? requestedCapabilities : defaultCapabilities(provider);
  const healthStatus = normalizeEnum(
    payload.health_status || payload.healthStatus,
    HEALTH_STATUSES,
    'health_status',
    'unknown',
  );
  const staffId = await requireStaffId(queryable, user);

  const { rows } = await queryable.query(
    `INSERT INTO erp_provider_configs
       (property_id, provider, display_name, status, sync_mode, base_url,
        auth_ref, config_json, capabilities, health_status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11)
     RETURNING ${PROVIDER_CONFIG_COLS}`,
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
      healthStatus,
      staffId,
    ],
  );
  const providerConfig = rows[0];
  await writeAudit(queryable, {
    propertyId,
    user,
    staffId,
    action: 'integration.provider.configured',
    entityType: 'erp_provider_config',
    entityId: providerConfig.id,
    resourceType: 'erp_provider_config',
    resourceId: providerConfig.id,
    ipAddress,
    changes: {
      provider,
      display_name: displayName,
      status,
      sync_mode: syncMode,
      auth_ref: Boolean(authRef),
      no_inline_secrets: true,
      no_billing_master: true,
    },
  });
  return providerConfig;
}

async function listErpProviderConfigs(queryable, { propertyId, status = null } = {}) {
  requireUuid(propertyId, 'property_id');
  const params = [propertyId];
  const filters = ['property_id = $1'];
  if (status) {
    params.push(normalizeEnum(status, PROVIDER_STATUSES, 'status'));
    filters.push(`status = $${params.length}`);
  }
  const { rows } = await queryable.query(
    `SELECT ${PROVIDER_CONFIG_COLS}
       FROM erp_provider_configs
      WHERE ${filters.join(' AND ')}
      ORDER BY provider ASC, display_name ASC`,
    params,
  );
  return rows;
}

async function createSyncJob(queryable, {
  propertyId,
  providerConfigId,
  direction,
  dataset,
  source,
  mode,
  staffId,
}) {
  const { rows } = await queryable.query(
    `INSERT INTO erp_sync_jobs
       (property_id, provider_config_id, direction, dataset, source, mode,
        status, created_by, started_at)
     VALUES ($1,$2,$3,$4,$5,$6,'processing',$7,NOW())
     RETURNING ${SYNC_JOB_COLS}`,
    [propertyId, providerConfigId, direction, dataset, source, mode, staffId],
  );
  return rows[0];
}

async function completeSyncJob(queryable, job, { status, summary, errorMessage = null }) {
  const { rows } = await queryable.query(
    `UPDATE erp_sync_jobs
        SET status = $2,
            summary = $3::jsonb,
            error_message = $4,
            completed_at = NOW(),
            updated_at = NOW()
      WHERE id = $1
      RETURNING ${SYNC_JOB_COLS}`,
    [job.id, status, JSON.stringify(summary), errorMessage],
  );
  return rows[0] || {
    ...job,
    status,
    summary,
    error_message: errorMessage,
    completed_at: new Date().toISOString(),
  };
}

async function insertSyncRecord(queryable, {
  propertyId,
  syncJobId,
  providerConfigId,
  rowIndex,
  externalEntityType,
  externalId,
  operation,
  status,
  domhubEntityType = null,
  domhubEntityId = null,
  validationErrors = [],
  payload = {},
  normalizedPayload = {},
}) {
  const { rows } = await queryable.query(
    `INSERT INTO erp_sync_records
       (property_id, sync_job_id, provider_config_id, row_index,
        external_entity_type, external_id, operation, status,
        domhub_entity_type, domhub_entity_id, validation_errors, payload,
        normalized_payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb)
     RETURNING ${SYNC_RECORD_COLS}`,
    [
      propertyId,
      syncJobId,
      providerConfigId,
      rowIndex,
      externalEntityType,
      externalId,
      operation,
      status,
      domhubEntityType,
      domhubEntityId,
      JSON.stringify(validationErrors),
      JSON.stringify(payload),
      JSON.stringify(normalizedPayload),
    ],
  );
  return rows[0] || null;
}

async function findExternalMapping(queryable, {
  propertyId,
  providerConfigId,
  externalEntityType,
  externalId,
}) {
  if (!externalId) return null;
  const { rows } = await queryable.query(
    `SELECT id, property_id, provider_config_id, external_entity_type,
            external_id, domhub_entity_type, domhub_entity_id,
            external_payload, conflict_status, last_seen_at, created_at, updated_at
       FROM erp_external_mappings
      WHERE property_id = $1
        AND provider_config_id = $2
        AND external_entity_type = $3
        AND external_id = $4
      LIMIT 1`,
    [propertyId, providerConfigId, externalEntityType, externalId],
  );
  return rows[0] || null;
}

async function upsertExternalMapping(queryable, {
  propertyId,
  providerConfigId,
  externalEntityType,
  externalId,
  domhubEntityType = null,
  domhubEntityId = null,
  payload = {},
  conflictStatus = 'unmapped',
}) {
  const { rows } = await queryable.query(
    `INSERT INTO erp_external_mappings
       (property_id, provider_config_id, external_entity_type, external_id,
        domhub_entity_type, domhub_entity_id, external_payload,
        conflict_status, last_seen_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,NOW())
     ON CONFLICT (property_id, provider_config_id, external_entity_type, external_id)
     DO UPDATE SET
       domhub_entity_type = COALESCE(EXCLUDED.domhub_entity_type, erp_external_mappings.domhub_entity_type),
       domhub_entity_id = COALESCE(EXCLUDED.domhub_entity_id, erp_external_mappings.domhub_entity_id),
       external_payload = EXCLUDED.external_payload,
       conflict_status = EXCLUDED.conflict_status,
       last_seen_at = NOW(),
       updated_at = NOW()
     RETURNING id, property_id, provider_config_id, external_entity_type,
               external_id, domhub_entity_type, domhub_entity_id,
               external_payload, conflict_status, last_seen_at, created_at, updated_at`,
    [
      propertyId,
      providerConfigId,
      externalEntityType,
      externalId,
      domhubEntityType,
      domhubEntityId,
      JSON.stringify(payload),
      conflictStatus,
    ],
  );
  return rows[0] || null;
}

function normalizePropertyStructureRow(raw) {
  const errors = [];
  const rawEntityType = firstPresent(raw.entity_type, raw.entityType, raw.type);
  let entityType = null;
  try {
    entityType = normalizeEnum(rawEntityType, ['property', 'building', 'entrance', 'unit'], 'entity_type');
  } catch (err) {
    errors.push(err.message);
    entityType = 'unit';
  }
  const externalId = normalizeNullableText(firstPresent(raw.external_id, raw.externalId, raw.id, raw.code), 'external_id', 180);
  if (!externalId) errors.push('external_id is required');
  const unitNumber = normalizeNullableText(firstPresent(raw.unit_number, raw.unitNumber, raw.apartment, raw.number), 'unit_number', 60);
  const name = normalizeNullableText(firstPresent(raw.name, raw.title, raw.display_name, raw.displayName), 'name', 160);
  if (entityType === 'unit' && !unitNumber && !name) errors.push('unit_number or name is required for unit rows');
  if (entityType !== 'unit' && !name) errors.push('name is required');
  return {
    externalEntityType: entityType,
    externalId,
    errors,
    normalizedPayload: {
      entity_type: entityType,
      external_id: externalId,
      name,
      building_external_id: normalizeNullableText(
        firstPresent(raw.building_external_id, raw.buildingExternalId, raw.building_code, raw.buildingCode),
        'building_external_id',
        180,
      ),
      entrance_external_id: normalizeNullableText(
        firstPresent(raw.entrance_external_id, raw.entranceExternalId, raw.entrance_code, raw.entranceCode),
        'entrance_external_id',
        180,
      ),
      unit_number: unitNumber,
      floor: normalizeNullableInteger(raw.floor, 'floor'),
      is_active: normalizeBoolean(firstPresent(raw.is_active, raw.isActive, raw.active), true),
      access_grant_created: false,
    },
  };
}

function normalizeResidentRow(raw) {
  const errors = [];
  const externalId = normalizeNullableText(firstPresent(raw.external_id, raw.externalId, raw.uid, raw.id), 'external_id', 180);
  if (!externalId) errors.push('external_id is required');
  const fullName = normalizeNullableText(firstPresent(raw.full_name, raw.fullName, raw.name, raw.fio), 'full_name', 180);
  if (!fullName) errors.push('full_name is required');
  let residentType = 'tenant';
  try {
    residentType = normalizeEnum(firstPresent(raw.resident_type, raw.residentType), RESIDENT_TYPES, 'resident_type', 'tenant');
  } catch (err) {
    errors.push(err.message);
  }
  return {
    externalEntityType: 'resident',
    externalId,
    errors,
    normalizedPayload: {
      external_id: externalId,
      full_name: fullName,
      resident_type: residentType,
      phone: normalizeNullableText(raw.phone, 'phone', 80),
      email: normalizeNullableText(raw.email, 'email', 180),
      unit_external_id: normalizeNullableText(
        firstPresent(raw.unit_external_id, raw.unitExternalId, raw.apartment_id, raw.apartmentId),
        'unit_external_id',
        180,
      ),
      unit_number: normalizeNullableText(firstPresent(raw.unit_number, raw.unitNumber, raw.apartment), 'unit_number', 60),
      building_external_id: normalizeNullableText(
        firstPresent(raw.building_external_id, raw.buildingExternalId, raw.building_code, raw.buildingCode),
        'building_external_id',
        180,
      ),
      is_active: normalizeBoolean(firstPresent(raw.is_active, raw.isActive, raw.active), true),
      access_grant_created: false,
    },
  };
}

function normalizeStaffRow(raw) {
  const errors = [];
  const externalId = normalizeNullableText(firstPresent(raw.external_id, raw.externalId, raw.uid, raw.id), 'external_id', 180);
  if (!externalId) errors.push('external_id is required');
  const fullName = normalizeNullableText(firstPresent(raw.full_name, raw.fullName, raw.name, raw.fio), 'full_name', 180);
  if (!fullName) errors.push('full_name is required');
  return {
    externalEntityType: 'staff_user',
    externalId,
    errors,
    normalizedPayload: {
      external_id: externalId,
      full_name: fullName,
      role: normalizeNullableText(raw.role, 'role', 60),
      phone: normalizeNullableText(raw.phone, 'phone', 80),
      email: normalizeNullableText(raw.email, 'email', 180),
      is_active: normalizeBoolean(firstPresent(raw.is_active, raw.isActive, raw.active), true),
      access_grant_created: false,
    },
  };
}

function normalizeContractorRow(raw) {
  const errors = [];
  const externalId = normalizeNullableText(firstPresent(raw.external_id, raw.externalId, raw.uid, raw.id), 'external_id', 180);
  if (!externalId) errors.push('external_id is required');
  const rawType = firstPresent(raw.entity_type, raw.entityType, raw.type);
  let externalEntityType = raw.company_name || raw.companyName ? 'contractor_company' : 'contractor_user';
  if (rawType) {
    try {
      externalEntityType = normalizeEnum(rawType, ['contractor_company', 'contractor_user'], 'entity_type');
    } catch (err) {
      errors.push(err.message);
    }
  }
  const displayName = normalizeNullableText(
    firstPresent(raw.company_name, raw.companyName, raw.full_name, raw.fullName, raw.name),
    'name',
    180,
  );
  if (!displayName) errors.push('name is required');
  return {
    externalEntityType,
    externalId,
    errors,
    normalizedPayload: {
      external_id: externalId,
      name: displayName,
      company_external_id: normalizeNullableText(
        firstPresent(raw.company_external_id, raw.companyExternalId),
        'company_external_id',
        180,
      ),
      phone: normalizeNullableText(raw.phone, 'phone', 80),
      email: normalizeNullableText(raw.email, 'email', 180),
      is_active: normalizeBoolean(firstPresent(raw.is_active, raw.isActive, raw.active), true),
      access_grant_created: false,
    },
  };
}

function normalizeVehicleRow(raw) {
  const errors = [];
  const externalId = normalizeNullableText(firstPresent(raw.external_id, raw.externalId, raw.id), 'external_id', 180);
  if (!externalId) errors.push('external_id is required');
  const plate = normalizeNullableText(firstPresent(raw.plate_number, raw.plateNumber, raw.plate), 'plate_number', 30);
  if (!plate) errors.push('plate_number is required');
  return {
    externalEntityType: 'vehicle',
    externalId,
    errors,
    normalizedPayload: {
      external_id: externalId,
      plate_number: plate ? plate.toUpperCase() : null,
      owner_external_id: normalizeNullableText(
        firstPresent(raw.owner_external_id, raw.ownerExternalId, raw.resident_external_id, raw.residentExternalId),
        'owner_external_id',
        180,
      ),
      is_active: normalizeBoolean(firstPresent(raw.is_active, raw.isActive, raw.active), true),
      access_grant_created: false,
    },
  };
}

function normalizeImportRow(dataset, raw) {
  const row = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  if (row !== raw) {
    return {
      externalEntityType: 'account',
      externalId: null,
      errors: ['row must be object'],
      normalizedPayload: { access_grant_created: false },
    };
  }
  if (dataset === 'property_structure') return normalizePropertyStructureRow(row);
  if (dataset === 'resident_registry') return normalizeResidentRow(row);
  if (dataset === 'staff_registry') return normalizeStaffRow(row);
  if (dataset === 'contractor_registry') return normalizeContractorRow(row);
  if (dataset === 'vehicle_registry') return normalizeVehicleRow(row);
  throw serviceError(400, `unsupported import dataset '${dataset}'`);
}

function normalizeImportInput(input) {
  const payload = input || {};
  const dataset = normalizeEnum(payload.dataset, IMPORT_DATASETS, 'dataset');
  const source = normalizeEnum(payload.source, SOURCES, 'source', 'manual');
  const rows = normalizeJsonArray(payload.rows, 'rows');
  if (rows.length < 1) throw serviceError(400, 'rows must contain at least one row');
  if (rows.length > 1000) throw serviceError(400, 'rows cannot exceed 1000');
  return { dataset, source, rows };
}

function buildImportSummary(rows, mode) {
  const summary = {
    total: rows.length,
    valid: 0,
    invalid: 0,
    conflicts: 0,
    creates: 0,
    updates: 0,
    applied: 0,
    skipped: 0,
    mode,
    access_grants_created: 0,
    mapping_only: true,
  };
  for (const row of rows) {
    if (row.status === 'invalid') summary.invalid += 1;
    if (row.status === 'conflict') summary.conflicts += 1;
    if (row.status === 'valid') summary.valid += 1;
    if (row.operation === 'preview_create' || row.operation === 'applied_create') summary.creates += 1;
    if (row.operation === 'preview_update' || row.operation === 'applied_update') summary.updates += 1;
    if (row.status === 'applied') summary.applied += 1;
    if (row.status === 'skipped') summary.skipped += 1;
  }
  return summary;
}

async function analyzeImportRows(queryable, {
  propertyId,
  providerConfigId,
  dataset,
  rows,
  apply,
}) {
  const seen = new Set();
  const analyzed = [];

  for (let i = 0; i < rows.length; i += 1) {
    const payload = rows[i];
    const normalized = normalizeImportRow(dataset, payload);
    const errors = [...normalized.errors];
    const duplicateKey = `${normalized.externalEntityType}:${normalized.externalId || ''}`;
    if (normalized.externalId && seen.has(duplicateKey)) {
      errors.push('duplicate external_id in import payload');
    }
    if (normalized.externalId) seen.add(duplicateKey);

    let existingMapping = null;
    if (!errors.length && normalized.externalId) {
      existingMapping = await findExternalMapping(queryable, {
        propertyId,
        providerConfigId,
        externalEntityType: normalized.externalEntityType,
        externalId: normalized.externalId,
      });
      if (existingMapping?.conflict_status === 'conflict') {
        errors.push('existing external mapping is marked as conflict');
      }
    }

    let status = 'valid';
    let operation = existingMapping ? 'preview_update' : 'preview_create';
    let domhubEntityType = existingMapping?.domhub_entity_type || null;
    let domhubEntityId = existingMapping?.domhub_entity_id || null;

    if (errors.length) {
      status = errors.some((message) => message.includes('duplicate') || message.includes('conflict'))
        ? 'conflict'
        : 'invalid';
      operation = status === 'conflict' ? 'preview_conflict' : 'skipped';
    } else if (apply) {
      const mapping = await upsertExternalMapping(queryable, {
        propertyId,
        providerConfigId,
        externalEntityType: normalized.externalEntityType,
        externalId: normalized.externalId,
        domhubEntityType,
        domhubEntityId,
        payload,
        conflictStatus: domhubEntityId ? 'mapped' : 'unmapped',
      });
      status = 'applied';
      operation = existingMapping ? 'applied_update' : 'applied_create';
      domhubEntityType = mapping?.domhub_entity_type || domhubEntityType;
      domhubEntityId = mapping?.domhub_entity_id || domhubEntityId;
    }

    analyzed.push({
      rowIndex: i,
      externalEntityType: normalized.externalEntityType,
      externalId: normalized.externalId,
      operation,
      status,
      domhubEntityType,
      domhubEntityId,
      validationErrors: errors,
      payload,
      normalizedPayload: {
        ...normalized.normalizedPayload,
        dataset,
        domhub_mutation_applied: false,
        access_grant_created: false,
      },
    });
  }

  return analyzed;
}

async function runErpImport(queryable, {
  propertyId,
  providerConfigId,
  input,
  user,
  ipAddress = null,
  apply = false,
}) {
  requireUuid(propertyId, 'property_id');
  const providerConfig = await ensureProviderConfig(queryable, {
    propertyId,
    providerConfigId,
    allowDisabled: false,
  });
  const { dataset, source, rows } = normalizeImportInput(input);
  const staffId = await requireStaffId(queryable, user);
  const mode = apply ? 'apply' : 'dry_run';
  const job = await createSyncJob(queryable, {
    propertyId,
    providerConfigId: providerConfig.id,
    direction: 'import',
    dataset,
    source,
    mode,
    staffId,
  });

  const analyzed = await analyzeImportRows(queryable, {
    propertyId,
    providerConfigId: providerConfig.id,
    dataset,
    rows,
    apply,
  });

  const records = [];
  for (const row of analyzed) {
    // Apply mode stages external-ID mappings only. Operational DomHub records
    // and access grants remain under explicit DomHub workflows.
    records.push(await insertSyncRecord(queryable, {
      propertyId,
      syncJobId: job.id,
      providerConfigId: providerConfig.id,
      rowIndex: row.rowIndex,
      externalEntityType: row.externalEntityType,
      externalId: row.externalId,
      operation: row.operation,
      status: row.status,
      domhubEntityType: row.domhubEntityType,
      domhubEntityId: row.domhubEntityId,
      validationErrors: row.validationErrors,
      payload: row.payload,
      normalizedPayload: row.normalizedPayload,
    }) || row);
  }

  const summary = buildImportSummary(analyzed, mode);
  const finalStatus = summary.invalid > 0 || summary.conflicts > 0 ? 'partial' : 'completed';
  const syncJob = await completeSyncJob(queryable, job, {
    status: finalStatus,
    summary,
  });
  await writeAudit(queryable, {
    propertyId,
    user,
    staffId,
    action: apply ? 'erp.import.applied' : 'erp.import.previewed',
    entityType: 'erp_sync_job',
    entityId: syncJob.id,
    resourceType: 'erp_sync_job',
    resourceId: syncJob.id,
    ipAddress,
    changes: {
      provider_config_id: providerConfig.id,
      dataset,
      source,
      mode,
      summary,
      no_access_grants_created: true,
      no_billing_master: true,
    },
  });

  return {
    provider_config: providerConfig,
    sync_job: syncJob,
    summary,
    records,
  };
}

async function previewErpImport(queryable, options) {
  return runErpImport(queryable, { ...options, apply: false });
}

async function applyErpImport(queryable, options) {
  return runErpImport(queryable, { ...options, apply: true });
}

function buildTimeFilters(params, filters, column, from, to) {
  if (from) {
    params.push(from);
    filters.push(`${column} >= $${params.length}::timestamptz`);
  }
  if (to) {
    params.push(to);
    filters.push(`${column} <= $${params.length}::timestamptz`);
  }
}

async function fetchExportRows(queryable, {
  propertyId,
  dataset,
  from,
  to,
  limit,
}) {
  if (dataset === 'access_events_summary') {
    const params = [propertyId];
    const filters = ['property_id = $1'];
    buildTimeFilters(params, filters, 'occurred_at', from, to);
    params.push(limit);
    const { rows } = await queryable.query(
      `SELECT id, event_type, event_source, access_point_id, person_label,
              vehicle_plate, provider_event_id, occurred_at, created_at
         FROM visit_logs_v2
        WHERE ${filters.join(' AND ')}
        ORDER BY occurred_at DESC
        LIMIT $${params.length}`,
      params,
    );
    return rows;
  }

  if (dataset === 'incident_summary') {
    const params = [propertyId];
    const filters = ['property_id = $1'];
    buildTimeFilters(params, filters, 'created_at', from, to);
    params.push(limit);
    const { rows } = await queryable.query(
      `SELECT id, incident_type, severity, status, title,
              related_visit_log_id, created_at, resolved_at
         FROM access_incidents
        WHERE ${filters.join(' AND ')}
        ORDER BY created_at DESC
        LIMIT $${params.length}`,
      params,
    );
    return rows;
  }

  if (dataset === 'request_summary') {
    const params = [];
    const filters = ['deleted_at IS NULL'];
    buildTimeFilters(params, filters, 'created_at', from, to);
    params.push(limit);
    const { rows } = await queryable.query(
      `SELECT id, status, priority, assigned_to_role, created_at, updated_at,
              completed_at, resolved_at, first_response_at, resolution_due_at
         FROM requests
        WHERE ${filters.join(' AND ')}
        ORDER BY created_at DESC
        LIMIT $${params.length}`,
      params,
    );
    return rows;
  }

  throw serviceError(400, `unsupported export dataset '${dataset}'`);
}

async function exportErpDataset(queryable, {
  propertyId,
  providerConfigId,
  input,
  user,
  ipAddress = null,
}) {
  requireUuid(propertyId, 'property_id');
  const providerConfig = await ensureProviderConfig(queryable, {
    propertyId,
    providerConfigId,
    allowDisabled: false,
  });
  const payload = input || {};
  const dataset = normalizeEnum(payload.dataset, EXPORT_DATASETS, 'dataset');
  const source = normalizeEnum(payload.source, SOURCES, 'source', 'manual');
  const from = normalizeTimestampBoundary(payload.from || payload.from_at || payload.fromAt, 'from');
  const to = normalizeTimestampBoundary(payload.to || payload.to_at || payload.toAt, 'to');
  const limit = normalizeLimit(payload.limit);
  const staffId = await requireStaffId(queryable, user);
  const job = await createSyncJob(queryable, {
    propertyId,
    providerConfigId: providerConfig.id,
    direction: 'export',
    dataset,
    source,
    mode: 'dry_run',
    staffId,
  });

  const rows = await fetchExportRows(queryable, { propertyId, dataset, from, to, limit });
  const summary = {
    dataset,
    total: rows.length,
    format: 'json',
    delivered: false,
    no_financial_payload: true,
    access_grants_created: 0,
  };
  const syncJob = await completeSyncJob(queryable, job, {
    status: 'completed',
    summary,
  });

  await writeAudit(queryable, {
    propertyId,
    user,
    staffId,
    action: 'erp.export.generated',
    entityType: 'erp_sync_job',
    entityId: syncJob.id,
    resourceType: 'erp_sync_job',
    resourceId: syncJob.id,
    ipAddress,
    changes: {
      provider_config_id: providerConfig.id,
      dataset,
      source,
      from,
      to,
      limit,
      record_count: rows.length,
      no_financial_payload: true,
    },
  });

  return {
    provider_config: providerConfig,
    sync_job: syncJob,
    summary,
    records: rows,
  };
}

async function getErpSyncJob(queryable, { propertyId, syncJobId }) {
  requireUuid(propertyId, 'property_id');
  requireUuid(syncJobId, 'sync_job_id');
  const { rows } = await queryable.query(
    `SELECT ${SYNC_JOB_COLS}
       FROM erp_sync_jobs
      WHERE property_id = $1 AND id = $2
      LIMIT 1`,
    [propertyId, syncJobId],
  );
  const syncJob = rows[0];
  if (!syncJob) throw serviceError(404, 'ERP sync job not found');
  const recordResult = await queryable.query(
    `SELECT ${SYNC_RECORD_COLS}
       FROM erp_sync_records
      WHERE property_id = $1 AND sync_job_id = $2
      ORDER BY row_index ASC`,
    [propertyId, syncJobId],
  );
  return {
    sync_job: syncJob,
    records: recordResult.rows,
  };
}

module.exports = {
  ERP_PROVIDERS,
  EXTERNAL_ENTITY_TYPES,
  EXPORT_DATASETS,
  IMPORT_DATASETS,
  applyErpImport,
  createErpProviderConfig,
  exportErpDataset,
  getErpSyncJob,
  isErpExchangeServiceError,
  listErpProviderConfigs,
  previewErpImport,
};
