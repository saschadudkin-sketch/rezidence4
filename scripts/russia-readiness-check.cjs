#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { repoRoot } = require('./e2e-env.cjs');

const REQUIRED_ROOT_SCRIPTS = [
  'russia:readiness',
  'release:gate:check',
  'tenant:preflight:current',
  'tenant:restore-drill:preflight',
  'tenant:restore-drill',
  'pilot:training-pack',
  'russia:readiness:evidence',
  'russia:readiness:live-evidence',
  'russia:readiness:live-gap',
];

const READINESS_GROUPS = [
  {
    id: 'DH-55',
    title: 'Resident ownership/offboarding evidence',
    evidence: [
      'backend/src/v1/migrations/047_readiness_live_evidence_and_transfers.js',
      'backend/src/v1/services/residentOffboardingService.js',
      'backend/src/v1/routes/residents.js',
      'backend/src/__tests__/v1ResidentOffboardingService.test.js',
      'frontend/src/v1/api/residents.ts',
      'frontend/src/v1/pages/ResidentOffboardingReportPage.tsx',
      'frontend/src/v1/pages/ResidentOffboardingReportPage.test.tsx',
      'docs/product/specs/platform-v1/resident-offboarding-report-spec.md',
      'docs/product/specs/platform-v1/resident-ownership-transfer-spec.md',
    ],
    markers: [
      ['backend/src/v1/routes/residents.js', 'transfer-ownership'],
      ['backend/src/v1/services/residentOffboardingService.js', 'notification_preferences_cascaded'],
    ],
  },
  {
    id: 'DH-56',
    title: 'Personal-data compliance controls',
    evidence: [
      'backend/src/v1/migrations/048_privacy_compliance_controls.js',
      'backend/src/services/privacyComplianceService.js',
      'backend/src/routes/privacy.js',
      'backend/src/__tests__/privacyComplianceService.test.js',
      'backend/src/__tests__/privacy.test.js',
      'docs/product/specs/platform-v1/privacy-compliance-controls-spec.md',
    ],
    markers: [
      ['backend/src/services/privacyComplianceService.js', 'privacy_data_subject_requests'],
      ['backend/src/services/privacyComplianceService.js', 'no_biometrics_release_guard'],
      ['backend/src/routes/privacy.js', 'data-subject-requests'],
    ],
  },
  {
    id: 'DH-57',
    title: 'Emergency dispatch readiness evidence',
    evidence: [
      'backend/src/v1/migrations/046_emergency_readiness_evidence.js',
      'backend/src/v1/migrations/047_readiness_live_evidence_and_transfers.js',
      'backend/src/services/requests/EmergencyDispatchService.js',
      'backend/src/routes/requests.js',
      'backend/src/__tests__/emergencyDispatchService.test.js',
      'backend/src/__tests__/requests.test.js',
      'frontend/src/v1/api/emergencyDispatch.ts',
      'frontend/src/v1/pages/EmergencyDispatchPage.tsx',
      'frontend/src/v1/pages/EmergencyDispatchPage.test.tsx',
      'docs/product/specs/platform-v1/emergency-dispatch-readiness-spec.md',
    ],
    markers: [
      ['backend/src/routes/requests.js', 'provider-delivery-evidence'],
      ['backend/src/services/requests/EmergencyDispatchService.js', 'live_provider_delivery_evidence'],
    ],
  },
  {
    id: 'DH-58',
    title: 'GIS/OSS readiness exports',
    evidence: [
      'backend/src/v1/migrations/045_gis_oss_readiness_exports.js',
      'backend/src/v1/services/gisOssReadinessService.js',
      'backend/src/v1/routes/gisOssReadiness.js',
      'backend/src/__tests__/v1GisOssReadinessService.test.js',
      'backend/src/__tests__/v1GisOssReadinessRoute.test.js',
      'frontend/src/v1/api/gisOssReadiness.ts',
      'frontend/src/v1/pages/GisOssReadinessPage.tsx',
      'frontend/src/v1/pages/GisOssReadinessPage.test.tsx',
      'docs/product/specs/platform-v1/gis-oss-readiness-spec.md',
    ],
    markers: [
      ['backend/src/v1/services/gisOssReadinessService.js', 'legally_authoritative: false'],
      ['backend/src/v1/routes/gisOssReadiness.js', 'artifact'],
    ],
  },
  {
    id: 'DH-59',
    title: 'SKUD provider failure and field rollout evidence',
    evidence: [
      'backend/src/v1/migrations/044_hardware_manual_control_boundaries.js',
      'backend/src/v1/migrations/047_readiness_live_evidence_and_transfers.js',
      'backend/src/v1/services/skudIntegrationService.js',
      'backend/src/v1/routes/skudIntegrations.js',
      'backend/src/__tests__/v1SkudIntegrationService.test.js',
      'backend/src/__tests__/v1SkudIntegrationsRoute.test.js',
      'frontend/src/v1/api/skudIntegrations.ts',
      'frontend/src/v1/pages/SkudProviderFailuresPage.tsx',
      'frontend/src/v1/pages/SkudProviderFailuresPage.test.tsx',
      'docs/product/specs/platform-v1/skud-provider-failure-dashboard-spec.md',
    ],
    markers: [
      ['backend/src/v1/routes/skudIntegrations.js', 'field-rollout-evidence'],
      ['backend/src/v1/services/skudIntegrationService.js', 'skud_field_rollout_evidence'],
    ],
  },
  {
    id: 'DH-60',
    title: 'Sensitive-action review report evidence',
    evidence: [
      'backend/src/v1/migrations/041_sensitive_review_ops.js',
      'backend/src/v1/migrations/047_readiness_live_evidence_and_transfers.js',
      'backend/src/v1/services/auditReviewService.js',
      'backend/src/v1/routes/auditReviews.js',
      'backend/src/__tests__/v1AuditReviewService.test.js',
      'backend/src/__tests__/v1AuditReviewsRoute.test.js',
      'frontend/src/v1/api/auditReviews.ts',
      'frontend/src/v1/pages/SensitiveActionsReviewPage.tsx',
      'frontend/src/v1/pages/SensitiveActionsReviewPage.test.tsx',
      'docs/product/specs/platform-v1/sensitive-actions-review-report-spec.md',
    ],
    markers: [
      ['backend/src/v1/routes/auditReviews.js', '_report-evidence'],
      ['backend/src/v1/services/auditReviewService.js', 'sensitive_action_report_evidence'],
    ],
  },
  {
    id: 'DH-61',
    title: 'Pilot operations and training pack',
    evidence: [
      'scripts/pilot-training-pack-check.cjs',
      'backend/src/__tests__/pilotTrainingPackScript.test.js',
      'docs/runbooks/pilot-operations-training-pack.md',
      'docs/runbooks/pilot-rollout.md',
      'docs/product/specs/platform-v1/pilot-operations-training-pack-spec.md',
      'docs/product/specs/domhub-operational-runbooks-index.md',
    ],
    markers: [
      ['docs/runbooks/pilot-operations-training-pack.md', 'DH-61'],
      ['docs/runbooks/pilot-operations-training-pack.md', 'PDn/DSAR'],
      ['docs/runbooks/pilot-operations-training-pack.md', 'emergency drill'],
      ['scripts/pilot-training-pack-check.cjs', 'TRAINING_PACK_SECTIONS'],
    ],
  },
];

const SHARED_EVIDENCE = [
  'docs/product/specs/domhub-russia-production-readiness-spec.md',
  'docs/product/specs/domhub-release-gate-checklists.md',
  'docs/product/specs/platform-v1/README.md',
  'docs/runbooks/pilot-rollout.md',
  'docs/runbooks/pilot-operations-training-pack.md',
  'docs/runbooks/russia-readiness-evidence-capture.md',
  'scripts/pilot-training-pack-check.cjs',
  'scripts/russia-readiness-evidence.cjs',
  'scripts/russia-live-evidence-capture.cjs',
  'scripts/russia-readiness-live-gap.cjs',
  'scripts/release-gate-matrix.cjs',
  'scripts/pilot-readiness-check.cjs',
  'e2e/v1-access-production.spec.js',
];

const LIVE_EVIDENCE_FILES = [
  'dh55-ownership-transfer.json',
  'dh56-privacy-compliance.json',
  'dh57-provider-delivery.json',
  'dh58-gis-oss-package.json',
  'dh59-field-rollout.json',
  'dh60-sensitive-report.json',
  'dh61-training-pack.json',
  'staging-verify-strict.json',
  'staging-restore-drill.json',
];

const LIVE_EVIDENCE_ENVIRONMENTS = [
  'staging',
  'prod-candidate',
  'pilot',
  'production',
];

const LIVE_EVIDENCE_RESULT_STATUSES = [
  'passed',
  'accepted',
  'completed',
  'green',
  'waived',
];

const LIVE_EVIDENCE_REQUIREMENTS = [
  {
    filename: 'dh55-ownership-transfer.json',
    dh: 'DH-55',
    evidenceKeys: [
      'property_slug',
      'ownership_transfer_id',
      'offboarding_report_id',
      'notification_cascade_evidence',
    ],
  },
  {
    filename: 'dh56-privacy-compliance.json',
    dh: 'DH-56',
    evidenceKeys: [
      'property_slug',
      'dsar_request_id',
      'privacy_readiness_report_id',
      'no_biometrics_guard_checked',
    ],
  },
  {
    filename: 'dh57-provider-delivery.json',
    dh: 'DH-57',
    evidenceKeys: [
      'property_slug',
      'emergency_request_id',
      'provider_delivery_evidence_id',
      'notification_provider',
    ],
  },
  {
    filename: 'dh58-gis-oss-package.json',
    dh: 'DH-58',
    evidenceKeys: [
      'property_slug',
      'export_package_id',
      'document_registry_id',
      'legally_authoritative',
    ],
  },
  {
    filename: 'dh59-field-rollout.json',
    dh: 'DH-59',
    evidenceKeys: [
      'property_slug',
      'provider_config_id',
      'field_rollout_evidence_id',
      'drill_type',
    ],
  },
  {
    filename: 'dh60-sensitive-report.json',
    dh: 'DH-60',
    evidenceKeys: [
      'property_slug',
      'report_evidence_id',
      'review_report_id',
      'anti_abuse_summary_id',
    ],
  },
  {
    filename: 'dh61-training-pack.json',
    dh: 'DH-61',
    evidenceKeys: [
      'property_slug',
      'training_date',
      'accepted_by',
      'open_waivers',
    ],
  },
  {
    filename: 'staging-verify-strict.json',
    dh: null,
    evidenceKeys: [
      'property_slug',
      'command',
      'exit_code',
      'log_reference',
    ],
  },
  {
    filename: 'staging-restore-drill.json',
    dh: null,
    evidenceKeys: [
      'property_slug',
      'command',
      'exit_code',
      'backup_reference',
      'restore_target',
    ],
  },
];

function parseArgs(argv = []) {
  return {
    json: argv.includes('--json'),
    requireLive: argv.includes('--require-live') || process.env.RUSSIA_READINESS_REQUIRE_LIVE === '1',
    liveDir: readOption(argv, '--live-dir') || process.env.RUSSIA_READINESS_EVIDENCE_DIR || 'artifacts/russia-readiness',
  };
}

function readOption(argv, name) {
  const inline = argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  if (index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--')) return argv[index + 1];
  return null;
}

function loadRootScripts(root = repoRoot) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  return pkg.scripts || {};
}

function makeCheck(type, ref, ok, message, group = null) {
  return { type, ref, ok, message, group };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPlaceholderString(value) {
  if (typeof value !== 'string') return false;
  return ['', 'todo', 'tbd', 'example', 'sample', 'template', 'placeholder', 'local']
    .includes(value.trim().toLowerCase());
}

function hasMeaningfulValue(value) {
  if (typeof value === 'string') return !isPlaceholderString(value);
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.length > 0;
  if (isPlainObject(value)) return Object.keys(value).length > 0;
  return false;
}

function isIsoTimestamp(value) {
  if (typeof value !== 'string' || isPlaceholderString(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && value.includes('T');
}

function getLiveEvidenceRequirement(filename) {
  return LIVE_EVIDENCE_REQUIREMENTS.find((requirement) => requirement.filename === filename) || {
    filename,
    dh: null,
    evidenceKeys: [],
  };
}

function readJsonEvidence(root, relativePath) {
  try {
    return {
      ok: true,
      value: JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8')),
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message,
    };
  }
}

function validateLiveEvidencePayload(payload, requirement = {}) {
  const failures = [];

  if (!isPlainObject(payload)) {
    return ['payload must be a JSON object'];
  }

  if (payload.schema_version !== 1) {
    failures.push('schema_version must be 1');
  }

  if (requirement.dh && payload.dh !== requirement.dh) {
    failures.push(`dh must be ${requirement.dh}`);
  }

  if (!LIVE_EVIDENCE_ENVIRONMENTS.includes(payload.environment)) {
    failures.push(`environment must be one of ${LIVE_EVIDENCE_ENVIRONMENTS.join(', ')}`);
  }

  if (!isIsoTimestamp(payload.captured_at)) {
    failures.push('captured_at must be an ISO timestamp');
  }

  if (!hasMeaningfulValue(payload.captured_by)) {
    failures.push('captured_by is required');
  }

  if (!isPlainObject(payload.source)) {
    failures.push('source object is required');
  } else {
    if (!hasMeaningfulValue(payload.source.type)) failures.push('source.type is required');
    const sourceRefKeys = ['command', 'endpoint', 'report_uri', 'runbook', 'artifact_url', 'request_id'];
    if (!sourceRefKeys.some((key) => hasMeaningfulValue(payload.source[key]))) {
      failures.push(`source must include one of ${sourceRefKeys.join(', ')}`);
    }
  }

  if (!isPlainObject(payload.result)) {
    failures.push('result object is required');
  } else if (!LIVE_EVIDENCE_RESULT_STATUSES.includes(payload.result.status)) {
    failures.push(`result.status must be one of ${LIVE_EVIDENCE_RESULT_STATUSES.join(', ')}`);
  }

  if (payload.result?.status === 'waived') {
    const waiver = payload.waiver;
    if (!isPlainObject(waiver)) {
      failures.push('waived evidence requires waiver object');
    } else {
      for (const key of ['reason', 'risk', 'owner', 'follow_up_ticket']) {
        if (!hasMeaningfulValue(waiver[key])) failures.push(`waiver.${key} is required`);
      }
    }
  }

  if (!isPlainObject(payload.evidence)) {
    failures.push('evidence object is required');
  } else {
    for (const key of requirement.evidenceKeys || []) {
      if (
        requirement.filename === 'dh61-training-pack.json'
        && key === 'open_waivers'
        && Array.isArray(payload.evidence[key])
      ) {
        continue;
      }
      if (!hasMeaningfulValue(payload.evidence[key])) failures.push(`evidence.${key} is required`);
    }
    if (requirement.filename === 'dh58-gis-oss-package.json' && payload.evidence.legally_authoritative !== false) {
      failures.push('evidence.legally_authoritative must be false');
    }
    if (
      (requirement.filename === 'staging-verify-strict.json'
        || requirement.filename === 'staging-restore-drill.json')
      && payload.evidence.exit_code !== 0
    ) {
      failures.push('evidence.exit_code must be 0');
    }
  }

  if (payload.pii_policy !== 'no_personal_data_embedded') {
    failures.push('pii_policy must be no_personal_data_embedded');
  }

  return failures;
}

function validateLiveEvidenceFile(root, relativePath, filename) {
  const parsed = readJsonEvidence(root, relativePath);
  if (!parsed.ok) {
    return {
      ok: false,
      message: `invalid live pilot/staging evidence: invalid JSON (${parsed.error})`,
    };
  }

  const failures = validateLiveEvidencePayload(parsed.value, getLiveEvidenceRequirement(filename));
  if (failures.length) {
    return {
      ok: false,
      message: `invalid live pilot/staging evidence: ${failures.join('; ')}`,
    };
  }

  return {
    ok: true,
    message: 'validated live pilot/staging evidence',
  };
}

function fileContains(root, relativePath, marker) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) return false;
  return fs.readFileSync(absolutePath, 'utf8').includes(marker);
}

function checkRussiaReadiness({
  root = repoRoot,
  scripts = loadRootScripts(root),
  requiredScripts = REQUIRED_ROOT_SCRIPTS,
  groups = READINESS_GROUPS,
  sharedEvidence = SHARED_EVIDENCE,
  requireLive = false,
  liveDir = 'artifacts/russia-readiness',
  liveEvidenceFiles = LIVE_EVIDENCE_FILES,
} = {}) {
  const checks = [];

  for (const script of requiredScripts) {
    const ok = Object.prototype.hasOwnProperty.call(scripts, script);
    checks.push(makeCheck(
      'script',
      script,
      ok,
      ok ? 'root package script exists' : 'missing root package script',
    ));
  }

  for (const relativePath of sharedEvidence) {
    const ok = fs.existsSync(path.join(root, relativePath));
    checks.push(makeCheck(
      'shared-evidence',
      relativePath,
      ok,
      ok ? 'shared evidence exists' : 'missing shared evidence',
    ));
  }

  for (const group of groups) {
    for (const relativePath of group.evidence) {
      const ok = fs.existsSync(path.join(root, relativePath));
      checks.push(makeCheck(
        'evidence',
        relativePath,
        ok,
        ok ? 'evidence path exists' : 'missing evidence path',
        group.id,
      ));
    }

    for (const [relativePath, marker] of group.markers || []) {
      const ok = fileContains(root, relativePath, marker);
      checks.push(makeCheck(
        'marker',
        `${relativePath} :: ${marker}`,
        ok,
        ok ? 'expected marker found' : 'expected marker missing',
        group.id,
      ));
    }
  }

  if (requireLive) {
    for (const filename of liveEvidenceFiles) {
      const relativePath = path.join(liveDir, filename).replace(/\\/g, '/');
      const absolutePath = path.join(root, relativePath);
      const exists = fs.existsSync(absolutePath);
      const validation = exists
        ? validateLiveEvidenceFile(root, relativePath, filename)
        : { ok: false, message: 'missing live pilot/staging evidence' };
      checks.push(makeCheck(
        'live-evidence',
        relativePath,
        validation.ok,
        validation.message,
      ));
    }
  }

  return {
    ok: checks.every((check) => check.ok),
    requireLive,
    liveDir,
    groups: groups.map((group) => ({ id: group.id, title: group.title })),
    checks,
  };
}

function formatReport(result) {
  const lines = ['[russia-readiness]'];
  const failed = result.checks.filter((check) => !check.ok);
  for (const check of failed) {
    const prefix = check.group ? `${check.group} ` : '';
    lines.push(`[fail] ${prefix}${check.type} ${check.ref}: ${check.message}`);
  }
  if (result.ok) {
    lines.push('[ok] Russia readiness baseline evidence is registered');
  }
  if (!result.requireLive) {
    lines.push(`[info] live pilot/staging artifacts not required in this run; use --require-live --live-dir ${result.liveDir}`);
  }
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = checkRussiaReadiness(args);
  if (args.json) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result, null, 2));
  } else {
    // eslint-disable-next-line no-console
    console.log(formatReport(result));
  }
  process.exit(result.ok ? 0 : 1);
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`[russia-readiness] ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  LIVE_EVIDENCE_FILES,
  LIVE_EVIDENCE_REQUIREMENTS,
  READINESS_GROUPS,
  REQUIRED_ROOT_SCRIPTS,
  SHARED_EVIDENCE,
  checkRussiaReadiness,
  formatReport,
  loadRootScripts,
  parseArgs,
  validateLiveEvidencePayload,
};
