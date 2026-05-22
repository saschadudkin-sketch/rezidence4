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

function valuesFromSqlInCheck(source, marker) {
  const start = source.indexOf(marker);
  if (start === -1) return null;
  const inStart = source.indexOf('IN', start);
  if (inStart === -1) return null;
  const open = source.indexOf('(', inStart);
  if (open === -1) return null;
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(') depth += 1;
    if (char === ')') {
      depth -= 1;
      if (depth === 0) {
        const block = source.slice(open, index + 1);
        return [...block.matchAll(/'([^']+)'/g)].map((match) => match[1]);
      }
    }
  }
  return null;
}

function valuesFromObjectValues(source, constName) {
  const start = source.search(new RegExp(`const\\s+${constName}\\b`));
  if (start === -1) return null;
  const assign = source.indexOf('=', start);
  if (assign === -1) return null;
  const open = source.indexOf('{', assign);
  const close = source.indexOf('});', open);
  if (open === -1 || close === -1) return null;
  const block = source.slice(open, close);
  return [...block.matchAll(/:\s*'([^']+)'/g)].map((match) => match[1]);
}

function requireSourceValues(values, source) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`[frontend-v1-enum-drift] missing enum source: ${source}`);
  }
  return values;
}

function backendConstValues(relPath, constName) {
  const source = `${relPath} ${constName}`;
  return requireSourceValues(valuesFromConstArray(read(relPath), constName), source);
}

function backendObjectValues(relPath, constName) {
  const source = `${relPath} ${constName}`;
  return requireSourceValues(valuesFromObjectValues(read(relPath), constName), source);
}

function migrationCheckValues(relPath, marker) {
  const source = `${relPath} ${marker}`;
  return requireSourceValues(valuesFromSqlInCheck(read(relPath), marker), source);
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

function listFilesRecursive(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFilesRecursive(fullPath);
    return entry.isFile() ? [fullPath] : [];
  });
}

function toRepoPath(absPath) {
  return path.relative(repoRoot, absPath).replace(/\\/g, '/');
}

const broadTypeAllowlist = Object.freeze([
  {
    relPath: 'frontend/src/v1/api/client.ts',
    pattern: /Promise<V1ApiErrorPayload \| string \| null>/,
    reason: 'v1Client error body may be plain text before JSON parsing succeeds',
  },
  {
    relPath: 'frontend/src/v1/api/client.ts',
    pattern: /V1ApiErrorPayload \| string \| null, status: number/,
    reason: 'v1Client error message extraction consumes the same parsed plain-text error body',
  },
  {
    relPath: 'frontend/src/v1/api/staff.ts',
    pattern: /role\?: StaffRole \| string;/,
    reason: 'staff CSV import accepts raw role strings before preview validation',
  },
  {
    relPath: 'frontend/src/v1/api/staff.ts',
    pattern: /specialization\?: StaffSpecialization \| string \| null;/,
    reason: 'staff CSV import accepts raw specialization strings before preview validation',
  },
  {
    relPath: 'frontend/src/v1/api/staff.ts',
    pattern: /can_view_resident_phone\?: boolean \| string \| null;/,
    reason: 'staff CSV import accepts raw boolean strings before preview validation',
  },
  {
    relPath: 'frontend/src/v1/api/staff.ts',
    pattern: /canViewResidentPhone\?: boolean \| string \| null;/,
    reason: 'staff CSV import accepts raw boolean strings before preview validation',
  },
  {
    relPath: 'frontend/src/v1/api/staff.ts',
    pattern: /can_assign_requests\?: boolean \| string \| null;/,
    reason: 'staff CSV import accepts raw boolean strings before preview validation',
  },
  {
    relPath: 'frontend/src/v1/api/staff.ts',
    pattern: /canAssignRequests\?: boolean \| string \| null;/,
    reason: 'staff CSV import accepts raw boolean strings before preview validation',
  },
  {
    relPath: 'frontend/src/v1/api/types.ts',
    pattern: /reason\?: DenyReason \| string;/,
    reason: 'verify denial reasons are intentionally forward-compatible with backend policy additions',
  },
  {
    relPath: 'frontend/src/v1/api/types.ts',
    pattern: /external_subject_type: MembershipSubjectType \| string \| null;/,
    reason: 'external membership subjects can carry provider-defined raw subject types',
  },
]);

function assertBroadTypeAllowlist(failures) {
  const apiRoot = path.join(repoRoot, 'frontend', 'src', 'v1', 'api');
  const broadTypePattern = /\|\s*string\b|\(string\s*&\s*\{\}\)/;
  const matches = [];

  for (const absPath of listFilesRecursive(apiRoot)) {
    if (!absPath.endsWith('.ts')) continue;
    const relPath = toRepoPath(absPath);
    const lines = fs.readFileSync(absPath, 'utf8').split(/\r?\n/);
    lines.forEach((lineText, index) => {
      if (broadTypePattern.test(lineText)) {
        matches.push({ relPath, line: index + 1, lineText: lineText.trim() });
      }
    });
  }

  const usedAllowlistIndexes = new Set();
  for (const match of matches) {
    const allowlistIndex = broadTypeAllowlist.findIndex((entry) => (
      entry.relPath === match.relPath && entry.pattern.test(match.lineText)
    ));
    if (allowlistIndex === -1) {
      failures.push([
        `${match.relPath}:${match.line}: unallowlisted broad frontend v1 API type`,
        `  line: ${match.lineText}`,
        '  add a closed enum/union, or document the exception in broadTypeAllowlist',
      ].join('\n'));
    } else {
      usedAllowlistIndexes.add(allowlistIndex);
    }
  }

  broadTypeAllowlist.forEach((entry, index) => {
    if (usedAllowlistIndexes.has(index)) return;
    failures.push([
      `${entry.relPath}: stale broad type allowlist entry`,
      `  reason: ${entry.reason}`,
      `  pattern: ${entry.pattern}`,
    ].join('\n'));
  });
}

const expected = Object.freeze({
  finalRoles: backendObjectValues('backend/src/v1/lib/authz.js', 'FINAL_ROLES'),
  membershipScopeLevels: backendConstValues('backend/src/v1/lib/authz.js', 'SCOPE_LEVELS'),
  membershipStatuses: migrationCheckValues('backend/src/v1/migrations/040_membership_review_lifecycle.js', 'ADD CONSTRAINT role_scope_memberships_status_check'),
  membershipProvisionedFrom: migrationCheckValues('backend/src/v1/migrations/040_membership_review_lifecycle.js', 'ADD CONSTRAINT role_scope_memberships_provisioned_from_check'),

  erpProviders: backendConstValues('backend/src/v1/services/erpExchangeService.js', 'ERP_PROVIDERS'),
  erpProviderStatuses: backendConstValues('backend/src/v1/services/erpExchangeService.js', 'PROVIDER_STATUSES'),
  erpHealthStatuses: backendConstValues('backend/src/v1/services/erpExchangeService.js', 'HEALTH_STATUSES'),
  erpSyncModes: backendConstValues('backend/src/v1/services/erpExchangeService.js', 'SYNC_MODES'),
  erpSources: backendConstValues('backend/src/v1/services/erpExchangeService.js', 'SOURCES'),
  erpImportDatasets: backendConstValues('backend/src/v1/services/erpExchangeService.js', 'IMPORT_DATASETS'),
  erpExportDatasets: backendConstValues('backend/src/v1/services/erpExchangeService.js', 'EXPORT_DATASETS'),
  erpSyncJobStatuses: migrationCheckValues('backend/src/v1/migrations/038_erp_exchange_baseline.js', "status                 VARCHAR(20) NOT NULL DEFAULT 'pending'"),
  erpRecordOperations: migrationCheckValues('backend/src/v1/migrations/038_erp_exchange_baseline.js', 'operation              VARCHAR(30) NOT NULL'),
  erpRecordStatuses: migrationCheckValues('backend/src/v1/migrations/038_erp_exchange_baseline.js', "CHECK (status IN ('valid','invalid'"),

  skudManualControlPolicies: backendConstValues('backend/src/v1/services/skudIntegrationService.js', 'MANUAL_CONTROL_POLICIES'),
  skudFailSafeModes: backendConstValues('backend/src/v1/services/skudIntegrationService.js', 'FAIL_SAFE_MODES'),
  skudMaintenanceStatuses: backendConstValues('backend/src/v1/services/skudIntegrationService.js', 'MAINTENANCE_STATUSES'),
  skudManualControlActions: backendConstValues('backend/src/v1/services/skudIntegrationService.js', 'MANUAL_CONTROL_ACTIONS'),
  skudManualControlDecisionSources: backendConstValues('backend/src/v1/services/skudIntegrationService.js', 'MANUAL_CONTROL_DECISION_SOURCES'),
  skudSyncPassActions: ['provision', 'revoke'],
  skudRolloutStages: backendConstValues('backend/src/v1/services/skudIntegrationService.js', 'FIELD_ROLLOUT_STAGES'),
  skudRolloutEvidenceTypes: backendConstValues('backend/src/v1/services/skudIntegrationService.js', 'FIELD_ROLLOUT_EVIDENCE_TYPES'),
  skudRolloutStatuses: backendConstValues('backend/src/v1/services/skudIntegrationService.js', 'FIELD_ROLLOUT_STATUSES'),

  videoProviders: ['trassir', 'macroscop', 'hikvision_nvr', 'dahua_nvr', 'axxon_next', 'devline_line', 'generic_link'],
  videoProviderStatuses: backendConstValues('backend/src/v1/services/videoEvidenceService.js', 'VIDEO_PROVIDER_STATUSES'),
  videoEvidenceTypes: backendConstValues('backend/src/v1/services/videoEvidenceService.js', 'EVIDENCE_TYPES'),
  videoEvidenceSources: backendConstValues('backend/src/v1/services/videoEvidenceService.js', 'EVIDENCE_SOURCES'),
  videoEvidenceStatuses: backendConstValues('backend/src/v1/services/videoEvidenceService.js', 'EVIDENCE_STATUSES'),
  videoEvidenceSensitivity: backendConstValues('backend/src/v1/services/videoEvidenceService.js', 'SENSITIVITY_LEVELS'),

  dataSubjectRequestTypes: backendConstValues('backend/src/services/privacyComplianceService.js', 'DATA_SUBJECT_REQUEST_TYPES'),
  dataSubjectRequestStatuses: backendConstValues('backend/src/services/privacyComplianceService.js', 'DATA_SUBJECT_REQUEST_STATUSES'),
  dataSubjectCompletionStatuses: ['in_progress', 'completed', 'rejected', 'cancelled'],
  complianceEvidenceTypes: backendConstValues('backend/src/services/privacyComplianceService.js', 'COMPLIANCE_EVIDENCE_TYPES'),
  complianceEvidenceStatuses: backendConstValues('backend/src/services/privacyComplianceService.js', 'COMPLIANCE_EVIDENCE_STATUSES'),

  assignableRequestRoles: backendConstValues('backend/src/services/requests/RequestSlaService.js', 'ASSIGNABLE_ROLES'),
  staffRequestStatuses: [
    'pending',
    'new',
    'triaged',
    'assigned',
    'approved',
    'accepted',
    'in_progress',
    'waiting_resident',
    'waiting_parts',
    'waiting_contractor',
    'resolved',
    'arrived',
    'cancelled',
    'scheduled',
    'expired',
    'completed',
    'rejected',
  ],
  staffRequestTypes: backendConstValues('backend/src/services/requests/RequestValidator.js', 'VALID_TYPES'),
  staffRequestTargetTypes: migrationCheckValues('backend/src/v1/migrations/029_service_request_core.js', 'requests_target_type_check'),
  staffSlaStates: migrationCheckValues('backend/src/v1/migrations/031_request_assignment_sla.js', 'requests_sla_state_check'),
  requestAttachmentFileKinds: backendConstValues('backend/src/services/requests/RequestUpdatesService.js', 'VALID_FILE_KINDS'),
  requestCommunicationVisibilities: migrationCheckValues('backend/src/v1/migrations/030_request_attachments_updates.js', "visibility        VARCHAR(20) NOT NULL DEFAULT 'resident'"),
  requestSlaEventTypes: migrationCheckValues('backend/src/v1/migrations/031_request_assignment_sla.js', 'event_type    VARCHAR(40) NOT NULL'),
  requestSlaEventSeverities: migrationCheckValues('backend/src/v1/migrations/031_request_assignment_sla.js', 'severity      VARCHAR(20) NOT NULL'),
  technicianWorkspaceEventTypes: migrationCheckValues('backend/src/v1/migrations/032_technician_workflow.js', 'event_type      VARCHAR(40) NOT NULL'),
  contractorWorkspaceEventTypes: migrationCheckValues('backend/src/v1/migrations/033_contractor_workflow.js', 'event_type                     VARCHAR(40) NOT NULL'),
  emergencyDispatchActions: backendConstValues('backend/src/services/requests/EmergencyDispatchService.js', 'DISPATCH_ACTIONS'),
  emergencyTypes: backendConstValues('backend/src/services/requests/EmergencyDispatchService.js', 'EMERGENCY_TYPES'),
  emergencySeverities: backendConstValues('backend/src/services/requests/EmergencyDispatchService.js', 'SEVERITIES'),
  emergencyEscalationTargets: backendConstValues('backend/src/services/requests/EmergencyDispatchService.js', 'ESCALATION_TARGETS'),
  emergencyNotificationStatuses: ['pending', 'sent', 'failed', 'not_required'],
  emergencyProviderDeliveryChannels: backendConstValues('backend/src/services/requests/EmergencyDispatchService.js', 'PROVIDER_DELIVERY_CHANNELS'),
  emergencyProviderDeliveryStatuses: backendConstValues('backend/src/services/requests/EmergencyDispatchService.js', 'PROVIDER_DELIVERY_STATUSES'),

  webhookDeliveryStatuses: ['pending', 'retrying', 'success', 'failed'],
  notificationRecipientTypes: ['resident', 'staff', 'contractor', 'external'],
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

  accessIncidentTypes: backendConstValues('backend/src/v1/routes/accessIncidents.js', 'INCIDENT_TYPES'),
  accessIncidentSeverities: backendConstValues('backend/src/v1/routes/accessIncidents.js', 'SEVERITIES'),
  accessIncidentStatuses: backendConstValues('backend/src/v1/routes/accessIncidents.js', 'INCIDENT_STATUSES'),
  accessOverrideTypes: backendConstValues('backend/src/v1/routes/accessIncidents.js', 'OVERRIDE_TYPES'),
});

const failures = [];

const typeChecks = [
  ['frontend/src/v1/api/types.ts', 'FinalUserRole', expected.finalRoles, 'backend/src/v1/lib/authz.js FINAL_ROLES'],
  ['frontend/src/v1/api/types.ts', 'IncidentType', expected.accessIncidentTypes, 'backend/src/v1/routes/accessIncidents.js INCIDENT_TYPES'],
  ['frontend/src/v1/api/types.ts', 'Severity', expected.accessIncidentSeverities, 'backend/src/v1/routes/accessIncidents.js SEVERITIES'],
  ['frontend/src/v1/api/types.ts', 'IncidentStatus', expected.accessIncidentStatuses, 'backend/src/v1/routes/accessIncidents.js INCIDENT_STATUSES'],
  ['frontend/src/v1/api/types.ts', 'OverrideType', expected.accessOverrideTypes, 'backend/src/v1/routes/accessIncidents.js OVERRIDE_TYPES'],
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
  ['frontend/src/v1/api/types.ts', 'StaffRequestStatus', expected.staffRequestStatuses, 'backend requests status state machine'],
  ['frontend/src/v1/api/types.ts', 'StaffRequestType', expected.staffRequestTypes, 'backend/src/services/requests/RequestValidator.js VALID_TYPES'],
  ['frontend/src/v1/api/types.ts', 'StaffRequestTargetType', expected.staffRequestTargetTypes, 'backend/src/v1/migrations/029_service_request_core.js target_type check'],
  ['frontend/src/v1/api/types.ts', 'StaffSlaState', expected.staffSlaStates, 'backend/src/v1/migrations/031_request_assignment_sla.js requests_sla_state_check'],
  ['frontend/src/v1/api/types.ts', 'RequestAttachmentFileKind', expected.requestAttachmentFileKinds, 'backend/src/services/requests/RequestUpdatesService.js VALID_FILE_KINDS'],
  ['frontend/src/v1/api/types.ts', 'RequestCommunicationVisibility', expected.requestCommunicationVisibilities, 'backend/src/v1/migrations/030_request_attachments_updates.js visibility checks'],
  ['frontend/src/v1/api/types.ts', 'RequestSlaEventType', expected.requestSlaEventTypes, 'backend/src/v1/migrations/031_request_assignment_sla.js request_sla_events event_type check'],
  ['frontend/src/v1/api/types.ts', 'RequestSlaEventSeverity', expected.requestSlaEventSeverities, 'backend/src/v1/migrations/031_request_assignment_sla.js request_sla_events severity check'],
  ['frontend/src/v1/api/types.ts', 'TechnicianWorkspaceEventType', expected.technicianWorkspaceEventTypes, 'backend/src/v1/migrations/032_technician_workflow.js event_type check'],
  ['frontend/src/v1/api/types.ts', 'ContractorWorkspaceEventType', expected.contractorWorkspaceEventTypes, 'backend/src/v1/migrations/033_contractor_workflow.js event_type check'],
  ['frontend/src/v1/api/serviceRequests.ts', 'ServiceRequestEmergencyDispatchAction', expected.emergencyDispatchActions, 'backend/src/services/requests/EmergencyDispatchService.js DISPATCH_ACTIONS'],
  ['frontend/src/v1/api/types.ts', 'EmergencyType', expected.emergencyTypes, 'backend/src/services/requests/EmergencyDispatchService.js EMERGENCY_TYPES'],
  ['frontend/src/v1/api/types.ts', 'EmergencySeverity', expected.emergencySeverities, 'backend/src/services/requests/EmergencyDispatchService.js SEVERITIES'],
  ['frontend/src/v1/api/types.ts', 'EmergencyEscalationTarget', expected.emergencyEscalationTargets, 'backend/src/services/requests/EmergencyDispatchService.js ESCALATION_TARGETS'],
  ['frontend/src/v1/api/types.ts', 'EmergencyNotificationStatus', expected.emergencyNotificationStatuses, 'backend/src/services/requests/EmergencyDispatchService.js notification status validation'],
  ['frontend/src/v1/api/types.ts', 'EmergencyProviderDeliveryChannel', expected.emergencyProviderDeliveryChannels, 'backend/src/services/requests/EmergencyDispatchService.js PROVIDER_DELIVERY_CHANNELS'],
  ['frontend/src/v1/api/types.ts', 'EmergencyProviderDeliveryStatus', expected.emergencyProviderDeliveryStatuses, 'backend/src/services/requests/EmergencyDispatchService.js PROVIDER_DELIVERY_STATUSES'],
  ['frontend/src/v1/api/webhooks.ts', 'WebhookDeliveryStatus', expected.webhookDeliveryStatuses, 'backend/src/services/webhookService.js delivery statuses'],
  ['frontend/src/v1/api/types.ts', 'NotificationRecipientType', expected.notificationRecipientTypes, 'backend notification outbox/log recipient_type checks'],
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
    ['StaffSlaState must stay closed', /export type StaffSlaState[\s\S]*?\|\s*\(string & \{\}\)/],
    ['ServiceRequest.type must stay closed', /\btype:\s*StaffRequestType\s*\|\s*\(string & \{\}\)/],
    ['ServiceRequest.status must stay closed', /\bstatus:\s*StaffRequestStatus\s*\|\s*\(string & \{\}\)/],
    ['ServiceRequestAttachment.fileKind must stay closed', /\bfileKind:\s*'photo'\s*\|\s*'document'\s*\|\s*'other'\s*\|\s*string\b/],
    ['Request visibility must stay closed', /\bvisibility:\s*'resident'\s*\|\s*(?:'internal'\s*\|\s*)?(?:\(string & \{\}\)|string)\b/],
    ['Notification recipient_type must stay closed', /\brecipient_type:\s*NotificationRecipientType\s*\|\s*string\b/],
    ['GIS/OSS format versions must stay closed', /\bformat_version:\s*'gis_oss_(?:readiness|artifact_manifest)\.v1'\s*\|\s*string\b/],
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

assertBroadTypeAllowlist(failures);

if (failures.length) {
  console.error('[frontend-v1-enum-drift] failed');
  for (const failure of failures) console.error(`\n${failure}`);
  process.exit(1);
}

console.log(`[frontend-v1-enum-drift] ok (${typeChecks.length} types, ${arrayChecks.length} form arrays, ${broadTypeAllowlist.length} broad type exceptions)`);
