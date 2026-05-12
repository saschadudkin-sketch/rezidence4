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
];

const SHARED_EVIDENCE = [
  'docs/product/specs/domhub-russia-production-readiness-spec.md',
  'docs/product/specs/domhub-release-gate-checklists.md',
  'docs/product/specs/platform-v1/README.md',
  'docs/runbooks/pilot-rollout.md',
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
  'staging-verify-strict.json',
  'staging-restore-drill.json',
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
      const ok = fs.existsSync(path.join(root, relativePath));
      checks.push(makeCheck(
        'live-evidence',
        relativePath,
        ok,
        ok ? 'live pilot/staging evidence exists' : 'missing live pilot/staging evidence',
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
  READINESS_GROUPS,
  REQUIRED_ROOT_SCRIPTS,
  SHARED_EVIDENCE,
  checkRussiaReadiness,
  formatReport,
  loadRootScripts,
  parseArgs,
};
