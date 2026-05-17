#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relPath), 'utf8'));
}

function read(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
}

function valuesFromConstArray(source, constName) {
  const start = source.search(new RegExp(`const\\s+${constName}\\b`));
  if (start === -1) return null;
  const assign = source.indexOf('=', start);
  if (assign === -1) return null;
  const open = source.indexOf('[', assign);
  const close = source.indexOf(']', open);
  if (open === -1 || close === -1) return null;
  const block = source.slice(open, close + 1);
  return [...block.matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

function requireSourceValues(values, source) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`[frontend-v1-openapi-schema-drift] missing enum source: ${source}`);
  }
  return values;
}

function backendConstValues(relPath, constName) {
  const source = `${relPath} ${constName}`;
  return requireSourceValues(valuesFromConstArray(read(relPath), constName), source);
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function setDiff(actual, expected) {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  return {
    missing: expected.filter((value) => !actualSet.has(value)),
    extra: actual.filter((value) => !expectedSet.has(value)),
  };
}

function getResponseSchema(openApi, pathname, method, status = '200') {
  return openApi.paths?.[pathname]?.[method]?.responses?.[status]?.content?.['application/json']?.schema || null;
}

function getRequestSchema(openApi, pathname, method) {
  return openApi.paths?.[pathname]?.[method]?.requestBody?.content?.['application/json']?.schema || null;
}

function isGenericObject(schema) {
  return Boolean(schema && schema.type === 'object' && schema.additionalProperties === true);
}

function assertRef({ failures, openApi, pathname, method, kind, expectedRef, status = '200' }) {
  const schema = kind === 'request'
    ? getRequestSchema(openApi, pathname, method)
    : getResponseSchema(openApi, pathname, method, status);
  if (schema?.$ref === expectedRef) return;
  failures.push([
    `docs/openapi.json: ${method.toUpperCase()} ${pathname} ${kind}${kind === 'response' ? ` ${status}` : ''} schema drift`,
    `  expected: ${expectedRef}`,
    schema ? `  actual: ${schema.$ref || JSON.stringify(schema)}` : '  actual: missing schema',
  ].join('\n'));
}

function assertNotGeneric({ failures, openApi, pathname, method, kind, status = '200' }) {
  const schema = kind === 'request'
    ? getRequestSchema(openApi, pathname, method)
    : getResponseSchema(openApi, pathname, method, status);
  if (!isGenericObject(schema)) return;
  failures.push(`docs/openapi.json: ${method.toUpperCase()} ${pathname} ${kind}${kind === 'response' ? ` ${status}` : ''} schema must not be generic`);
}

function assertEnum({ failures, openApi, schemaName, property, expected, source }) {
  const actual = openApi.components?.schemas?.[schemaName]?.properties?.[property]?.enum || null;
  if (!actual) {
    failures.push(`docs/openapi.json: missing enum ${schemaName}.${property}`);
    return;
  }
  const normalizedActual = sortedUnique(actual);
  const normalizedExpected = sortedUnique(expected);
  const { missing, extra } = setDiff(normalizedActual, normalizedExpected);
  if (missing.length || extra.length) {
    failures.push([
      `docs/openapi.json: ${schemaName}.${property} enum drift`,
      missing.length ? `  missing: ${missing.join(', ')}` : null,
      extra.length ? `  extra: ${extra.join(', ')}` : null,
      `  source: ${source}`,
    ].filter(Boolean).join('\n'));
  }
}

const requestRefs = [
  ['/api/v1/access-incidents/{id}/assign', 'post', '#/components/schemas/AssignAccessIncidentRequest'],
  ['/api/v1/access-incidents/{id}/resolve', 'post', '#/components/schemas/ResolveAccessIncidentRequest'],
  ['/api/v1/access-incidents/{id}/dismiss', 'post', '#/components/schemas/IncidentReasonRequest'],
  ['/api/v1/access-incidents/{id}/reopen', 'post', '#/components/schemas/ReopenAccessIncidentRequest'],
  ['/api/v1/access-incidents/{id}/status', 'post', '#/components/schemas/UpdateAccessIncidentStatusRequest'],
  ['/api/v1/analytics/snapshots', 'post', '#/components/schemas/CreateAnalyticsSnapshotRequest'],
  ['/api/v1/erp/providers', 'post', '#/components/schemas/CreateErpProviderRequest'],
  ['/api/v1/erp/providers/{providerConfigId}/import/preview', 'post', '#/components/schemas/ErpImportRequest'],
  ['/api/v1/erp/providers/{providerConfigId}/import/apply', 'post', '#/components/schemas/ErpImportRequest'],
  ['/api/v1/erp/providers/{providerConfigId}/export', 'post', '#/components/schemas/ErpExportRequest'],
  ['/api/v1/skud/providers/{providerConfigId}/events', 'post', '#/components/schemas/SkudProviderAccessEventRequest'],
  ['/api/v1/skud/field-rollout-evidence', 'post', '#/components/schemas/SkudFieldRolloutEvidenceRequest'],
  ['/api/v1/skud/hardware-devices/{hardwareDeviceId}/boundary', 'patch', '#/components/schemas/SkudHardwareBoundaryRequest'],
  ['/api/v1/skud/hardware-devices/{hardwareDeviceId}/manual-control', 'post', '#/components/schemas/SkudManualControlRequest'],
  ['/api/v1/skud/providers/{providerConfigId}/sync-pass', 'post', '#/components/schemas/SkudSyncPassRequest'],
  ['/api/v1/webhooks', 'post', '#/components/schemas/CreateWebhookRequest'],
  ['/api/v1/webhooks/{id}', 'patch', '#/components/schemas/UpdateWebhookRequest'],
  ['/api/v1/webhooks/{id}/test', 'post', '#/components/schemas/WebhookTestDeliveryRequest'],
];

const responseRefs = [
  ['/api/v1/analytics/traffic', 'get', '#/components/schemas/TrafficAnalyticsResponse'],
  ['/api/v1/analytics/top-residents', 'get', '#/components/schemas/TopResidentsAnalyticsResponse'],
  ['/api/v1/analytics/sla', 'get', '#/components/schemas/SlaAnalyticsResponse'],
  ['/api/v1/analytics/requests', 'get', '#/components/schemas/RequestsAnalyticsResponse'],
  ['/api/v1/analytics/packages', 'get', '#/components/schemas/PackagesAnalyticsResponse'],
  ['/api/v1/analytics/snapshots', 'get', '#/components/schemas/AnalyticsSnapshotListResponse'],
  ['/api/v1/analytics/snapshots/latest', 'get', '#/components/schemas/AnalyticsSnapshotResponse'],
  ['/api/v1/analytics/snapshots', 'post', '#/components/schemas/CreateAnalyticsSnapshotResponse', '201'],
  ['/api/v1/erp/providers', 'get', '#/components/schemas/ErpProviderListResponse'],
  ['/api/v1/erp/providers', 'post', '#/components/schemas/ErpProviderResponse', '201'],
  ['/api/v1/erp/providers/{providerConfigId}/import/preview', 'post', '#/components/schemas/ErpImportResponse', '202'],
  ['/api/v1/erp/providers/{providerConfigId}/import/apply', 'post', '#/components/schemas/ErpImportResponse', '202'],
  ['/api/v1/erp/providers/{providerConfigId}/export', 'post', '#/components/schemas/ErpExportResponse', '202'],
  ['/api/v1/erp/sync-jobs/{syncJobId}', 'get', '#/components/schemas/ErpSyncJobResponse'],
  ['/api/v1/skud/providers/{providerConfigId}/events', 'post', '#/components/schemas/SkudProviderAccessEventResponse'],
  ['/api/v1/skud/providers/{providerConfigId}/events', 'post', '#/components/schemas/SkudProviderAccessEventResponse', '201'],
  ['/api/v1/skud/provider-failures', 'get', '#/components/schemas/SkudProviderFailureDashboardResponse'],
  ['/api/v1/skud/field-rollout-evidence', 'post', '#/components/schemas/SkudFieldRolloutEvidenceResponse', '201'],
  ['/api/v1/skud/hardware-devices', 'get', '#/components/schemas/SkudHardwareDeviceListResponse'],
  ['/api/v1/skud/hardware-devices/{hardwareDeviceId}/boundary', 'patch', '#/components/schemas/SkudHardwareDeviceResponse'],
  ['/api/v1/skud/hardware-devices/{hardwareDeviceId}/manual-control', 'post', '#/components/schemas/SkudManualControlResponse', '201'],
  ['/api/v1/skud/hardware-devices/{hardwareDeviceId}/manual-control-events', 'get', '#/components/schemas/SkudManualControlEventListResponse'],
  ['/api/v1/skud/providers/{providerConfigId}/sync-pass', 'post', '#/components/schemas/SkudSyncPassResponse', '202'],
  ['/api/v1/webhooks', 'get', '#/components/schemas/WebhookListResponse'],
  ['/api/v1/webhooks', 'post', '#/components/schemas/WebhookResponse', '201'],
  ['/api/v1/webhooks/{id}', 'patch', '#/components/schemas/WebhookResponse'],
  ['/api/v1/webhooks/{id}', 'delete', '#/components/schemas/WebhookDeactivateResponse'],
  ['/api/v1/webhooks/{id}/test', 'post', '#/components/schemas/WebhookTestDeliveryResponse', '202'],
  ['/api/v1/webhooks/{id}/deliveries', 'get', '#/components/schemas/WebhookDeliveryListResponse'],
];

const enumChecks = [
  ['AccessIncident', 'severity', backendConstValues('backend/src/v1/routes/accessIncidents.js', 'SEVERITIES')],
  ['AccessIncident', 'status', backendConstValues('backend/src/v1/routes/accessIncidents.js', 'INCIDENT_STATUSES')],
  ['ErpProviderConfig', 'provider', backendConstValues('backend/src/v1/services/erpExchangeService.js', 'ERP_PROVIDERS')],
  ['ErpProviderConfig', 'status', backendConstValues('backend/src/v1/services/erpExchangeService.js', 'PROVIDER_STATUSES')],
  ['ErpProviderConfig', 'sync_mode', backendConstValues('backend/src/v1/services/erpExchangeService.js', 'SYNC_MODES')],
  ['ErpProviderConfig', 'health_status', backendConstValues('backend/src/v1/services/erpExchangeService.js', 'HEALTH_STATUSES')],
  ['SkudHardwareBoundaryRequest', 'manual_control_policy', backendConstValues('backend/src/v1/services/skudIntegrationService.js', 'MANUAL_CONTROL_POLICIES')],
  ['SkudHardwareBoundaryRequest', 'fail_safe_mode', backendConstValues('backend/src/v1/services/skudIntegrationService.js', 'FAIL_SAFE_MODES')],
  ['SkudHardwareBoundaryRequest', 'maintenance_status', backendConstValues('backend/src/v1/services/skudIntegrationService.js', 'MAINTENANCE_STATUSES')],
  ['SkudManualControlRequest', 'action', backendConstValues('backend/src/v1/services/skudIntegrationService.js', 'MANUAL_CONTROL_ACTIONS')],
  ['SkudManualControlRequest', 'decision_source', backendConstValues('backend/src/v1/services/skudIntegrationService.js', 'MANUAL_CONTROL_DECISION_SOURCES')],
  ['SkudFieldRolloutEvidenceRequest', 'evidence_type', backendConstValues('backend/src/v1/services/skudIntegrationService.js', 'FIELD_ROLLOUT_EVIDENCE_TYPES')],
  ['SkudFieldRolloutEvidenceRequest', 'rollout_stage', backendConstValues('backend/src/v1/services/skudIntegrationService.js', 'FIELD_ROLLOUT_STAGES')],
  ['SkudFieldRolloutEvidenceRequest', 'status', backendConstValues('backend/src/v1/services/skudIntegrationService.js', 'FIELD_ROLLOUT_STATUSES')],
];

const failures = [];
const openApi = readJson('docs/openapi.json');

for (const [pathname, method, expectedRef] of requestRefs) {
  assertRef({ failures, openApi, pathname, method, kind: 'request', expectedRef });
  assertNotGeneric({ failures, openApi, pathname, method, kind: 'request' });
}

for (const [pathname, method, expectedRef, status = '200'] of responseRefs) {
  assertRef({ failures, openApi, pathname, method, kind: 'response', expectedRef, status });
  assertNotGeneric({ failures, openApi, pathname, method, kind: 'response', status });
}

for (const [schemaName, property, expected] of enumChecks) {
  assertEnum({
    failures,
    openApi,
    schemaName,
    property,
    expected,
    source: `${schemaName}.${property}`,
  });
}

if (failures.length) {
  console.error('[frontend-v1-openapi-schema-drift] failed');
  for (const failure of failures) console.error(`\n${failure}`);
  process.exit(1);
}

console.log(`[frontend-v1-openapi-schema-drift] ok (${requestRefs.length} requests, ${responseRefs.length} responses, ${enumChecks.length} enums)`);
