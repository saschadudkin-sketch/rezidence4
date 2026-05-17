#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
}

function valuesFromExportedType(source, typeName) {
  const marker = `export type ${typeName}`;
  const start = source.indexOf(marker);
  if (start === -1) return null;
  const end = source.indexOf(';', start);
  if (end === -1) return null;
  const block = source.slice(start, end);
  return [...block.matchAll(/'([^']+)'/g)].map((match) => match[1]);
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

function assertValues({ failures, source, relPath, name, actual, expected }) {
  if (!actual) {
    failures.push(`${relPath}: missing ${name}`);
    return;
  }
  const normalizedActual = sortedUnique(actual);
  const normalizedExpected = sortedUnique(expected);
  const { missing, extra } = setDiff(normalizedActual, normalizedExpected);
  if (missing.length || extra.length) {
    failures.push([
      `${relPath}: ${name} drift`,
      missing.length ? `  missing: ${missing.join(', ')}` : null,
      extra.length ? `  extra: ${extra.join(', ')}` : null,
      `  source: ${source}`,
    ].filter(Boolean).join('\n'));
  }
}

function assertNoPattern({ failures, relPath, source, label, pattern }) {
  const match = source.match(pattern);
  if (!match) return;
  const line = source.slice(0, match.index).split(/\r?\n/).length;
  failures.push(`${relPath}:${line}: ${label}`);
}

const expected = Object.freeze({
  finalRoles: [
    'resident',
    'contractor',
    'security',
    'concierge',
    'technician',
    'property_admin',
    'management_company_admin',
    'platform_admin',
  ],
  membershipScopeLevels: [
    'platform',
    'management_company',
    'property',
    'building',
    'entrance',
    'floor',
    'unit',
    'parking_zone',
    'access_zone',
    'access_point',
  ],
  membershipStatuses: ['active', 'suspended', 'revoked', 'expired'],
  membershipProvisionedFrom: ['manual', 'api', 'import', 'bootstrap', 'platform_sync'],

  erpProviders: ['one_c', 'one_c_zhkh', 'housing_erp', 'generic_csv', 'generic_rest', 'generic_webhook'],
  erpProviderStatuses: ['active', 'disabled', 'degraded'],
  erpHealthStatuses: ['unknown', 'healthy', 'degraded', 'down'],
  erpSyncModes: ['import_only', 'export_only', 'hybrid', 'manual'],
  erpSources: ['csv', 'rest', 'webhook', 'manual'],
  erpImportDatasets: ['property_structure', 'resident_registry', 'staff_registry', 'contractor_registry', 'vehicle_registry'],
  erpExportDatasets: ['access_events_summary', 'incident_summary', 'request_summary'],
  erpSyncJobStatuses: ['pending', 'processing', 'completed', 'partial', 'failed', 'dead_lettered'],
  erpRecordOperations: [
    'preview_create',
    'preview_update',
    'preview_conflict',
    'preview_ignore',
    'applied_create',
    'applied_update',
    'failed',
    'skipped',
  ],
  erpRecordStatuses: ['valid', 'invalid', 'conflict', 'applied', 'failed', 'skipped'],

  skudManualControlPolicies: ['guard_allowed', 'admin_only', 'provider_only', 'prohibited'],
  skudFailSafeModes: ['fail_closed', 'fail_open_guarded', 'provider_default', 'manual_guard'],
  skudMaintenanceStatuses: ['normal', 'maintenance', 'out_of_service'],
  skudManualControlActions: [
    'manual_open',
    'manual_close',
    'manual_block',
    'manual_unblock',
    'manual_reset',
    'mark_degraded',
    'mark_restored',
  ],
  skudManualControlDecisionSources: ['guard', 'admin', 'incident', 'provider_fallback'],
  skudSyncPassActions: ['provision', 'revoke'],
  skudRolloutStages: ['lab', 'staging', 'pilot', 'production'],
  skudRolloutEvidenceTypes: ['provider_delivery', 'field_drill', 'rollout_report', 'vendor_health_probe'],
  skudRolloutStatuses: ['planned', 'running', 'passed', 'failed', 'blocked'],

  videoProviders: ['trassir', 'macroscop', 'hikvision_nvr', 'dahua_nvr', 'axxon_next', 'devline_line', 'generic_link'],
  videoProviderStatuses: ['active', 'disabled', 'degraded'],
  videoEvidenceTypes: ['clip', 'snapshot', 'event_reference', 'camera_context', 'unavailable'],
  videoEvidenceSources: ['manual', 'provider', 'webhook', 'system'],
  videoEvidenceStatuses: ['linked', 'unavailable', 'expired', 'removed'],
  videoEvidenceSensitivity: ['restricted', 'sensitive'],

  dataSubjectRequestTypes: ['export', 'delete', 'correct', 'restrict'],
  dataSubjectRequestStatuses: ['pending', 'in_progress', 'completed', 'rejected', 'cancelled'],
  dataSubjectCompletionStatuses: ['in_progress', 'completed', 'rejected', 'cancelled'],
  complianceEvidenceTypes: [
    'dsar_workflow',
    'retention_sweep',
    'data_localization',
    'ispdn_readiness',
    'no_biometrics_release_guard',
    'consent_history',
    'deletion_procedure',
  ],
  complianceEvidenceStatuses: ['draft', 'ready', 'reviewed', 'blocked'],

  assignableRequestRoles: [
    'security',
    'concierge',
    'technician',
    'contractor',
    'property_admin',
    'management_company_admin',
    'platform_admin',
    'admin',
  ],
  emergencyDispatchActions: ['acknowledge', 'dispatch', 'escalate', 'resolve', 'cancel'],
  emergencyTypes: ['water', 'heating', 'electricity', 'fire_smoke', 'access_control', 'security', 'territory', 'contractor', 'other'],
  emergencySeverities: ['P0', 'P1', 'P2'],
  emergencyEscalationTargets: ['security', 'concierge', 'technician', 'contractor', 'property_admin', 'management_company_admin'],
  emergencyNotificationStatuses: ['pending', 'sent', 'failed', 'not_required'],
  emergencyProviderDeliveryChannels: [
    'web_push',
    'sms',
    'telegram',
    'email',
    'phone',
    'webhook',
    'external_dispatch',
    'contractor_company',
    'internal_roster',
  ],
  emergencyProviderDeliveryStatuses: ['sent', 'delivered', 'acknowledged', 'failed', 'timed_out', 'not_required'],

  webhookDeliveryStatuses: ['pending', 'retrying', 'success', 'failed'],
  staffImportActions: ['ready', 'invalid', 'created', 'skipped_existing'],
  contractorImportActions: [
    'ready',
    'invalid',
    'created',
    'skipped_existing',
    'company_created',
    'company_existing',
    'skipped_inactive_company',
  ],
});

const failures = [];

const typeChecks = [
  ['frontend/src/v1/api/types.ts', 'FinalUserRole', expected.finalRoles, 'backend/src/v1/lib/authz.js FINAL_ROLES'],
  ['frontend/src/v1/api/types.ts', 'MembershipScopeLevel', expected.membershipScopeLevels, 'backend/src/v1/migrations/040_membership_review_lifecycle.js scope_level check'],
  ['frontend/src/v1/api/types.ts', 'MembershipStatus', expected.membershipStatuses, 'backend/src/v1/migrations/040_membership_review_lifecycle.js status check'],
  ['frontend/src/v1/api/types.ts', 'MembershipProvisionedFrom', expected.membershipProvisionedFrom, 'backend/src/v1/migrations/040_membership_review_lifecycle.js provisioned_from check'],
  ['frontend/src/v1/api/erpExchange.ts', 'ErpProvider', expected.erpProviders, 'backend/src/v1/services/erpExchangeService.js ERP_PROVIDERS'],
  ['frontend/src/v1/api/erpExchange.ts', 'ErpProviderStatus', expected.erpProviderStatuses, 'backend/src/v1/services/erpExchangeService.js PROVIDER_STATUSES'],
  ['frontend/src/v1/api/erpExchange.ts', 'ErpHealthStatus', expected.erpHealthStatuses, 'backend/src/v1/services/erpExchangeService.js HEALTH_STATUSES'],
  ['frontend/src/v1/api/erpExchange.ts', 'ErpSyncMode', expected.erpSyncModes, 'backend/src/v1/services/erpExchangeService.js SYNC_MODES'],
  ['frontend/src/v1/api/erpExchange.ts', 'ErpSyncSource', expected.erpSources, 'backend/src/v1/services/erpExchangeService.js SOURCES'],
  ['frontend/src/v1/api/erpExchange.ts', 'ErpImportDataset', expected.erpImportDatasets, 'backend/src/v1/services/erpExchangeService.js IMPORT_DATASETS'],
  ['frontend/src/v1/api/erpExchange.ts', 'ErpExportDataset', expected.erpExportDatasets, 'backend/src/v1/services/erpExchangeService.js EXPORT_DATASETS'],
  ['frontend/src/v1/api/erpExchange.ts', 'ErpSyncJobStatus', expected.erpSyncJobStatuses, 'backend/src/v1/migrations/038_erp_exchange_baseline.js erp_sync_jobs status check'],
  ['frontend/src/v1/api/erpExchange.ts', 'ErpSyncRecordOperation', expected.erpRecordOperations, 'backend/src/v1/migrations/038_erp_exchange_baseline.js erp_sync_records operation check'],
  ['frontend/src/v1/api/erpExchange.ts', 'ErpSyncRecordStatus', expected.erpRecordStatuses, 'backend/src/v1/migrations/038_erp_exchange_baseline.js erp_sync_records status check'],
  ['frontend/src/v1/api/skudIntegrations.ts', 'SkudManualControlPolicy', expected.skudManualControlPolicies, 'backend/src/v1/services/skudIntegrationService.js MANUAL_CONTROL_POLICIES'],
  ['frontend/src/v1/api/skudIntegrations.ts', 'SkudFailSafeMode', expected.skudFailSafeModes, 'backend/src/v1/services/skudIntegrationService.js FAIL_SAFE_MODES'],
  ['frontend/src/v1/api/skudIntegrations.ts', 'SkudMaintenanceStatus', expected.skudMaintenanceStatuses, 'backend/src/v1/services/skudIntegrationService.js MAINTENANCE_STATUSES'],
  ['frontend/src/v1/api/skudIntegrations.ts', 'SkudManualControlAction', expected.skudManualControlActions, 'backend/src/v1/services/skudIntegrationService.js MANUAL_CONTROL_ACTIONS'],
  ['frontend/src/v1/api/skudIntegrations.ts', 'SkudManualControlDecisionSource', expected.skudManualControlDecisionSources, 'backend/src/v1/services/skudIntegrationService.js MANUAL_CONTROL_DECISION_SOURCES'],
  ['frontend/src/v1/api/skudIntegrations.ts', 'SkudSyncPassAction', expected.skudSyncPassActions, 'backend/src/v1/services/skudIntegrationService.js sync pass action'],
  ['frontend/src/v1/api/skudIntegrations.ts', 'SkudFieldRolloutStage', expected.skudRolloutStages, 'backend/src/v1/services/skudIntegrationService.js FIELD_ROLLOUT_STAGES'],
  ['frontend/src/v1/api/skudIntegrations.ts', 'SkudFieldRolloutEvidenceType', expected.skudRolloutEvidenceTypes, 'backend/src/v1/services/skudIntegrationService.js FIELD_ROLLOUT_EVIDENCE_TYPES'],
  ['frontend/src/v1/api/skudIntegrations.ts', 'SkudFieldRolloutStatus', expected.skudRolloutStatuses, 'backend/src/v1/services/skudIntegrationService.js FIELD_ROLLOUT_STATUSES'],
  ['frontend/src/v1/api/videoEvidence.ts', 'VideoProviderKind', expected.videoProviders, 'backend/src/services/skud/VideoProviderRegistry.js registered providers + video migrations'],
  ['frontend/src/v1/api/videoEvidence.ts', 'VideoProviderStatus', expected.videoProviderStatuses, 'backend/src/v1/services/videoEvidenceService.js VIDEO_PROVIDER_STATUSES'],
  ['frontend/src/v1/api/videoEvidence.ts', 'VideoEvidenceType', expected.videoEvidenceTypes, 'backend/src/v1/services/videoEvidenceService.js EVIDENCE_TYPES'],
  ['frontend/src/v1/api/videoEvidence.ts', 'VideoEvidenceSource', expected.videoEvidenceSources, 'backend/src/v1/services/videoEvidenceService.js EVIDENCE_SOURCES'],
  ['frontend/src/v1/api/videoEvidence.ts', 'VideoEvidenceStatus', expected.videoEvidenceStatuses, 'backend/src/v1/services/videoEvidenceService.js EVIDENCE_STATUSES'],
  ['frontend/src/v1/api/videoEvidence.ts', 'VideoEvidenceSensitivity', expected.videoEvidenceSensitivity, 'backend/src/v1/services/videoEvidenceService.js SENSITIVITY_LEVELS'],
  ['frontend/src/v1/api/privacyCompliance.ts', 'DataSubjectRequestType', expected.dataSubjectRequestTypes, 'backend/src/services/privacyComplianceService.js DATA_SUBJECT_REQUEST_TYPES'],
  ['frontend/src/v1/api/privacyCompliance.ts', 'DataSubjectRequestStatus', expected.dataSubjectRequestStatuses, 'backend/src/services/privacyComplianceService.js DATA_SUBJECT_REQUEST_STATUSES'],
  ['frontend/src/v1/api/privacyCompliance.ts', 'DataSubjectRequestCompletionStatus', expected.dataSubjectCompletionStatuses, 'backend/src/routes/privacy.js completion status validation'],
  ['frontend/src/v1/api/privacyCompliance.ts', 'ComplianceEvidenceType', expected.complianceEvidenceTypes, 'backend/src/services/privacyComplianceService.js COMPLIANCE_EVIDENCE_TYPES'],
  ['frontend/src/v1/api/privacyCompliance.ts', 'ComplianceEvidenceStatus', expected.complianceEvidenceStatuses, 'backend/src/services/privacyComplianceService.js COMPLIANCE_EVIDENCE_STATUSES'],
  ['frontend/src/v1/api/serviceRequests.ts', 'AssignableServiceRequestRole', expected.assignableRequestRoles, 'backend/src/services/requests/RequestSlaService.js ASSIGNABLE_ROLES'],
  ['frontend/src/v1/api/serviceRequests.ts', 'ServiceRequestEmergencyDispatchAction', expected.emergencyDispatchActions, 'backend/src/services/requests/EmergencyDispatchService.js DISPATCH_ACTIONS'],
  ['frontend/src/v1/api/types.ts', 'EmergencyType', expected.emergencyTypes, 'backend/src/services/requests/EmergencyDispatchService.js EMERGENCY_TYPES'],
  ['frontend/src/v1/api/types.ts', 'EmergencySeverity', expected.emergencySeverities, 'backend/src/services/requests/EmergencyDispatchService.js SEVERITIES'],
  ['frontend/src/v1/api/types.ts', 'EmergencyEscalationTarget', expected.emergencyEscalationTargets, 'backend/src/services/requests/EmergencyDispatchService.js ESCALATION_TARGETS'],
  ['frontend/src/v1/api/types.ts', 'EmergencyNotificationStatus', expected.emergencyNotificationStatuses, 'backend/src/services/requests/EmergencyDispatchService.js notification status validation'],
  ['frontend/src/v1/api/types.ts', 'EmergencyProviderDeliveryChannel', expected.emergencyProviderDeliveryChannels, 'backend/src/services/requests/EmergencyDispatchService.js PROVIDER_DELIVERY_CHANNELS'],
  ['frontend/src/v1/api/types.ts', 'EmergencyProviderDeliveryStatus', expected.emergencyProviderDeliveryStatuses, 'backend/src/services/requests/EmergencyDispatchService.js PROVIDER_DELIVERY_STATUSES'],
  ['frontend/src/v1/api/webhooks.ts', 'WebhookDeliveryStatus', expected.webhookDeliveryStatuses, 'backend/src/services/webhookService.js delivery statuses'],
  ['frontend/src/v1/api/staff.ts', 'StaffImportAction', expected.staffImportActions, 'backend/src/v1/services/onboardingImportService.js staff import actions'],
  ['frontend/src/v1/api/contractors.ts', 'ContractorImportAction', expected.contractorImportActions, 'backend/src/v1/services/onboardingImportService.js contractor import actions'],
];

for (const [relPath, typeName, values, source] of typeChecks) {
  const text = read(relPath);
  assertValues({
    failures,
    source,
    relPath,
    name: typeName,
    actual: valuesFromExportedType(text, typeName),
    expected: values,
  });
}

const arrayChecks = [
  ['frontend/src/v1/pages/PropertyDirectoryAdminPage.tsx', 'MEMBERSHIP_SCOPE_LEVELS', expected.membershipScopeLevels, 'backend membership scope levels'],
  ['frontend/src/v1/pages/PropertyDirectoryAdminPage.tsx', 'MEMBERSHIP_ROLES', expected.finalRoles, 'backend final membership roles'],
  ['frontend/src/v1/pages/IntegrationOperationsPage.tsx', 'ERP_PROVIDERS', expected.erpProviders, 'backend ERP providers'],
  ['frontend/src/v1/pages/IntegrationOperationsPage.tsx', 'ERP_SYNC_MODES', expected.erpSyncModes, 'backend ERP sync modes'],
  ['frontend/src/v1/pages/IntegrationOperationsPage.tsx', 'ERP_IMPORT_DATASETS', expected.erpImportDatasets, 'backend ERP import datasets'],
  ['frontend/src/v1/pages/IntegrationOperationsPage.tsx', 'ERP_EXPORT_DATASETS', expected.erpExportDatasets, 'backend ERP export datasets'],
  ['frontend/src/v1/pages/IntegrationOperationsPage.tsx', 'ERP_SOURCES', expected.erpSources, 'backend ERP sources'],
  ['frontend/src/v1/pages/IntegrationOperationsPage.tsx', 'SKUD_POLICIES', expected.skudManualControlPolicies, 'backend SKUD policies'],
  ['frontend/src/v1/pages/IntegrationOperationsPage.tsx', 'SKUD_FAIL_SAFE', expected.skudFailSafeModes, 'backend SKUD fail-safe modes'],
  ['frontend/src/v1/pages/IntegrationOperationsPage.tsx', 'SKUD_MAINTENANCE', expected.skudMaintenanceStatuses, 'backend SKUD maintenance statuses'],
  ['frontend/src/v1/pages/IntegrationOperationsPage.tsx', 'SKUD_ACTIONS', expected.skudManualControlActions, 'backend SKUD manual actions'],
  ['frontend/src/v1/pages/IntegrationOperationsPage.tsx', 'SKUD_DECISION_SOURCES', expected.skudManualControlDecisionSources, 'backend SKUD decision sources'],
  ['frontend/src/v1/pages/IntegrationOperationsPage.tsx', 'SKUD_SYNC_ACTIONS', expected.skudSyncPassActions, 'backend SKUD sync actions'],
  ['frontend/src/v1/pages/IntegrationOperationsPage.tsx', 'SKUD_ROLLOUT_STAGES', expected.skudRolloutStages, 'backend SKUD rollout stages'],
  ['frontend/src/v1/pages/IntegrationOperationsPage.tsx', 'SKUD_EVIDENCE_TYPES', expected.skudRolloutEvidenceTypes, 'backend SKUD rollout evidence types'],
  ['frontend/src/v1/pages/IntegrationOperationsPage.tsx', 'SKUD_EVIDENCE_STATUSES', expected.skudRolloutStatuses, 'backend SKUD rollout statuses'],
  ['frontend/src/v1/pages/IntegrationOperationsPage.tsx', 'VIDEO_PROVIDERS', expected.videoProviders, 'backend video providers'],
  ['frontend/src/v1/pages/IntegrationOperationsPage.tsx', 'VIDEO_EVIDENCE_TYPES', expected.videoEvidenceTypes, 'backend video evidence types'],
  ['frontend/src/v1/pages/IntegrationOperationsPage.tsx', 'VIDEO_EVIDENCE_STATUSES', expected.videoEvidenceStatuses, 'backend video evidence statuses'],
  ['frontend/src/v1/pages/IntegrationOperationsPage.tsx', 'VIDEO_SENSITIVITY', expected.videoEvidenceSensitivity, 'backend video sensitivity levels'],
  ['frontend/src/v1/pages/PrivacyCompliancePage.tsx', 'REQUEST_TYPES', expected.dataSubjectRequestTypes, 'backend DSAR request types'],
  ['frontend/src/v1/pages/PrivacyCompliancePage.tsx', 'COMPLETION_STATUSES', expected.dataSubjectCompletionStatuses, 'backend DSAR completion statuses'],
  ['frontend/src/v1/pages/PrivacyCompliancePage.tsx', 'EVIDENCE_TYPES', expected.complianceEvidenceTypes, 'backend compliance evidence types'],
];

for (const [relPath, constName, values, source] of arrayChecks) {
  const text = read(relPath);
  assertValues({
    failures,
    source,
    relPath,
    name: constName,
    actual: valuesFromConstArray(text, constName),
    expected: values,
  });
}

for (const [relPath, rules] of [
  ['frontend/src/v1/api/erpExchange.ts', [
    ['ErpSyncRecord.operation must stay closed', /\boperation:\s*ErpSyncRecordOperation\s*\|\s*string\b/],
    ['ErpSyncRecord.status must stay closed', /\bstatus:\s*ErpSyncRecordStatus\s*\|\s*string\b/],
  ]],
  ['frontend/src/v1/api/memberships.ts', [
    ['CreateMembershipBody.role must use FinalUserRole', /\brole:\s*UserRole(?:\s*\|\s*string)?\b/],
    ['CreateMembershipBody.provisioned_from must stay closed', /\bprovisioned_from\?:\s*string\b/],
  ]],
  ['frontend/src/v1/api/types.ts', [
    ['RoleScopeMembership.role must stay closed', /\brole:\s*UserRole\s*\|\s*string\b/],
    ['RoleScopeMembership.scope_level must stay closed', /\bscope_level:\s*MembershipScopeLevel\s*\|\s*string\b/],
    ['RoleScopeMembership.status must stay closed', /\bstatus:\s*MembershipStatus\s*\|\s*string\b/],
  ]],
  ['frontend/src/v1/pages/PropertyDirectoryAdminPage.tsx', [
    ['membership form must not send non-DB provisioned_from values', /provisioned_from:\s*'directory_admin_ui'/],
  ]],
]) {
  const text = read(relPath);
  for (const [label, pattern] of rules) {
    assertNoPattern({ failures, relPath, source: text, label, pattern });
  }
}

if (failures.length) {
  console.error('[frontend-v1-enum-drift] failed');
  for (const failure of failures) console.error(`\n${failure}`);
  process.exit(1);
}

console.log(`[frontend-v1-enum-drift] ok (${typeChecks.length} types, ${arrayChecks.length} form arrays)`);
