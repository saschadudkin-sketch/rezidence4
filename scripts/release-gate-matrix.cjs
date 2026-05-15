#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { repoRoot } = require('./e2e-env.cjs');

const RELEASE_GATES = [
  {
    id: 'v2-core',
    title: 'Gate v2 Core',
    coverage: 'DH-01..DH-26',
    scripts: ['backend:test', 'frontend:lint', 'typecheck', 'test:e2e:preflight', 'test:e2e:v1-access'],
    evidence: [
      'docs/product/specs/domhub-test-strategy-spec.md',
      'docs/product/specs/domhub-release-gate-checklists.md',
      'e2e/login-flow.spec.js',
      'e2e/pass-flow.spec.js',
      'e2e/v1-access-production.spec.js',
      'e2e/navigation-role-matrix.spec.js',
      'frontend/src/v1/pages/StaffWorkspacePage.test.tsx',
    ],
  },
  {
    id: 'operations-plus',
    title: 'Gate v2 Operations+',
    coverage: 'DH-27..DH-34',
    scripts: ['backend:test', 'frontend:test', 'frontend:build'],
    evidence: [
      'backend/src/__tests__/v1TechnicianWorkspaceRoutes.test.js',
      'backend/src/__tests__/v1ContractorWorkspaceRoutes.test.js',
      'backend/src/__tests__/v1PackagesEndpoint.test.js',
      'backend/src/__tests__/v1AnnouncementsEndpoint.test.js',
      'frontend/src/v1/pages/TechnicianWorkspacePage.test.tsx',
      'frontend/src/v1/pages/ContractorWorkspacePage.test.tsx',
      'frontend/src/v1/store/session.role-predicates.test.ts',
    ],
  },
  {
    id: 'portfolio-ready',
    title: 'Gate Portfolio-Ready',
    coverage: 'DH-35..DH-40',
    scripts: ['backend:test', 'frontend:test'],
    evidence: [
      'backend/src/__tests__/v1OperationsDashboardEndpoint.test.js',
      'backend/src/__tests__/v1ManagementCompanyPortfolioEndpoint.test.js',
      'backend/src/__tests__/platformPropertiesPhase1.test.js',
      'backend/src/__tests__/webhookService.test.js',
      'frontend/src/v1/V1Router.test.tsx',
      'docs/product/specs/domhub-event-taxonomy-spec.md',
    ],
  },
  {
    id: 'pilot-to-production',
    title: 'Gate Pilot-To-Production Hardening',
    coverage: 'DH-41..DH-49',
    scripts: [
      'verify:strict',
      'test:e2e:v1-access',
      'tenant:preflight:e2e',
      'tenant:preflight:current',
      'tenant:provision',
      'tenant:migrate',
      'tenant:restore-drill:preflight',
      'tenant:restore-drill',
      'pilot:training-pack',
      'pilot:readiness',
    ],
    evidence: [
      'scripts/run-strict-verify.cjs',
      'scripts/run-v1-access-e2e.cjs',
      'scripts/tenant-ops-preflight.cjs',
      'scripts/tenant-ops-provision.cjs',
      'scripts/tenant-ops-migrate.cjs',
      'scripts/restore-drill-preflight.cjs',
      'scripts/pilot-training-pack-check.cjs',
      'scripts/pilot-readiness-check.cjs',
      'e2e/v1-access-production.spec.js',
      'docs/runbooks/restore-drill.md',
      'docs/runbooks/pilot-rollout.md',
      'docs/runbooks/pilot-operations-training-pack.md',
      'docs/product/specs/domhub-deployment-and-tenant-ops-spec.md',
    ],
  },
  {
    id: 'russia-production',
    title: 'Gate Russia Production Readiness',
    coverage: 'DH-55..DH-61',
    scripts: ['backend:test', 'tenant:preflight:current', 'pilot:training-pack', 'russia:readiness'],
    evidence: [
      'scripts/russia-readiness-check.cjs',
      'docs/product/specs/domhub-russia-production-readiness-spec.md',
      'docs/product/specs/domhub-security-threat-model.md',
      'docs/product/specs/platform-v1/resident-ownership-transfer-spec.md',
      'docs/product/specs/platform-v1/privacy-compliance-controls-spec.md',
      'docs/product/specs/platform-v1/pilot-operations-training-pack-spec.md',
      'docs/product/specs/platform-v1/emergency-dispatch-readiness-spec.md',
      'docs/product/specs/platform-v1/gis-oss-readiness-spec.md',
      'docs/product/specs/platform-v1/skud-provider-failure-dashboard-spec.md',
      'docs/product/specs/platform-v1/sensitive-actions-review-report-spec.md',
      'backend/src/services/privacyComplianceService.js',
      'backend/src/__tests__/privacyComplianceService.test.js',
      'backend/src/__tests__/pilotTrainingPackScript.test.js',
      'backend/src/__tests__/privacy.test.js',
      'backend/src/__tests__/v1ResidentOffboardingService.test.js',
      'backend/src/__tests__/v1GisOssReadinessService.test.js',
      'backend/src/__tests__/v1AuditReviewsRoute.test.js',
      'backend/src/__tests__/v1SkudIntegrationService.test.js',
      'frontend/src/v1/pages/EmergencyDispatchPage.test.tsx',
      'frontend/src/v1/pages/SensitiveActionsReviewPage.test.tsx',
    ],
  },
  {
    id: 'expansion-layer',
    title: 'Gate Expansion Layer',
    coverage: 'DH-50..DH-54',
    scripts: ['backend:test', 'frontend:test'],
    evidence: [
      'docs/product/specs/platform-v1/legacy-utilities-freeze-spec.md',
      'backend/src/__tests__/featureFlagsRegistry.test.js',
      'backend/src/__tests__/adminSettingsFeatureFlags.test.js',
      'frontend/src/config/features.test.tsx',
    ],
  },
];

function parseArgs(argv = []) {
  return {
    json: argv.includes('--json'),
    list: argv.includes('--list'),
    gate: readOption(argv, '--gate'),
  };
}

function readOption(argv, name) {
  const inline = argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  if (index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--')) {
    return argv[index + 1];
  }
  return null;
}

function loadRootScripts(root = repoRoot) {
  const packageJsonPath = path.join(root, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  return pkg.scripts || {};
}

function selectGates(matrix, gateId) {
  if (!gateId) return matrix;
  return matrix.filter((gate) => gate.id === gateId);
}

function checkMatrix({
  root = repoRoot,
  matrix = RELEASE_GATES,
  gateId = null,
  scripts = loadRootScripts(root),
} = {}) {
  const gates = selectGates(matrix, gateId).map((gate) => {
    const scriptChecks = gate.scripts.map((script) => ({
      type: 'script',
      ref: script,
      ok: Object.prototype.hasOwnProperty.call(scripts, script),
      message: Object.prototype.hasOwnProperty.call(scripts, script)
        ? 'root package script exists'
        : 'missing root package script',
    }));
    const evidenceChecks = gate.evidence.map((relativePath) => {
      const absolutePath = path.join(root, relativePath);
      const ok = fs.existsSync(absolutePath);
      return {
        type: 'evidence',
        ref: relativePath,
        ok,
        message: ok ? 'evidence path exists' : 'missing evidence path',
      };
    });
    const checks = [...scriptChecks, ...evidenceChecks];
    return {
      ...gate,
      ok: checks.every((check) => check.ok),
      checks,
    };
  });

  return {
    ok: gates.length > 0 && gates.every((gate) => gate.ok),
    gateId,
    gates,
  };
}

function formatList(matrix = RELEASE_GATES) {
  return matrix
    .map((gate) => `${gate.id}: ${gate.title} (${gate.coverage})`)
    .join('\n');
}

function formatReport(result) {
  const lines = ['[release-gate-matrix]'];
  for (const gate of result.gates) {
    lines.push(`${gate.ok ? '[ok]' : '[fail]'} ${gate.id}: ${gate.title}`);
    for (const check of gate.checks) {
      if (!check.ok) lines.push(`  [fail] ${check.type} ${check.ref}: ${check.message}`);
    }
  }
  if (!result.ok) lines.push('[release-gate-matrix] failed');
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.list) {
    // eslint-disable-next-line no-console
    console.log(formatList());
    return;
  }

  const result = checkMatrix({ gateId: args.gate });
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
    console.error(`[release-gate-matrix] ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  RELEASE_GATES,
  checkMatrix,
  formatList,
  formatReport,
  loadRootScripts,
  parseArgs,
  selectGates,
};
