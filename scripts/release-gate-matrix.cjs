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
    scripts: ['backend:test', 'frontend:test', 'frontend:build', 'test:e2e:v1-service-execution'],
    evidence: [
      'backend/src/__tests__/v1TechnicianWorkspaceRoutes.test.js',
      'backend/src/__tests__/v1ContractorWorkspaceRoutes.test.js',
      'backend/src/__tests__/v1PackagesEndpoint.test.js',
      'backend/src/__tests__/v1AnnouncementsEndpoint.test.js',
      'e2e/v1-service-execution-production.spec.js',
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
      'test:e2e:v1-packages',
      'test:e2e:v1-service-execution',
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
      'scripts/run-v1-packages-e2e.cjs',
      'scripts/run-v1-service-execution-e2e.cjs',
      'scripts/tenant-ops-preflight.cjs',
      'scripts/tenant-ops-provision.cjs',
      'scripts/tenant-ops-migrate.cjs',
      'scripts/restore-drill-preflight.cjs',
      'scripts/pilot-training-pack-check.cjs',
      'scripts/pilot-readiness-check.cjs',
      'e2e/v1-access-production.spec.js',
      'e2e/v1-packages-production.spec.js',
      'e2e/v1-service-execution-production.spec.js',
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
      'scripts/russia-readiness-evidence.cjs',
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
    metadataOnly: argv.includes('--metadata'),
    requireRuntimeEvidence: argv.includes('--require-runtime-evidence')
      || (!argv.includes('--metadata') && !argv.includes('--list')),
    gate: readOption(argv, '--gate'),
    evidenceDir: readOption(argv, '--evidence-dir') || process.env.RELEASE_GATE_EVIDENCE_DIR || 'artifacts/release-gates',
    maxEvidenceAgeHours: Number(readOption(argv, '--max-evidence-age-hours') || process.env.RELEASE_GATE_EVIDENCE_MAX_AGE_HOURS || 168),
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

function scriptArtifactName(script) {
  return `${script.replace(/[^a-z0-9_.-]/gi, '-')}.json`;
}

function defaultRuntimeEvidenceForScript(script, evidenceDir = 'artifacts/release-gates') {
  return path.join(evidenceDir, scriptArtifactName(script)).replace(/\\/g, '/');
}

function readJsonFile(filePath) {
  try {
    return {
      ok: true,
      value: JSON.parse(fs.readFileSync(filePath, 'utf8')),
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message,
    };
  }
}

function isFreshIsoTimestamp(value, maxAgeHours, now = Date.now()) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return false;
  const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
  return timestamp <= now && now - timestamp <= maxAgeMs;
}

function validateRuntimeEvidencePayload(payload, script, maxEvidenceAgeHours) {
  const failures = [];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return ['runtime evidence must be a JSON object'];
  }
  if (payload.schema_version !== 1) failures.push('schema_version must be 1');
  if (payload.command && !String(payload.command).includes(script)) {
    failures.push(`command must reference ${script}`);
  }
  if (payload.script && payload.script !== script) {
    failures.push(`script must be ${script}`);
  }
  if (!payload.command && !payload.script) {
    failures.push('command or script is required');
  }
  if (!isFreshIsoTimestamp(payload.captured_at, maxEvidenceAgeHours)) {
    failures.push(`captured_at must be an ISO timestamp within ${maxEvidenceAgeHours}h`);
  }
  const ok = payload.ok === true || payload.exit_code === 0 || payload.evidence?.exit_code === 0;
  if (!ok) failures.push('runtime evidence must show ok=true or exit_code=0');
  return failures;
}

function checkRuntimeEvidence(root, script, evidenceDir, maxEvidenceAgeHours) {
  const relativePath = defaultRuntimeEvidenceForScript(script, evidenceDir);
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    return {
      type: 'runtime-evidence',
      ref: `${script} -> ${relativePath}`,
      ok: false,
      message: 'missing runtime evidence artifact',
    };
  }

  const parsed = readJsonFile(absolutePath);
  if (!parsed.ok) {
    return {
      type: 'runtime-evidence',
      ref: `${script} -> ${relativePath}`,
      ok: false,
      message: `invalid runtime evidence JSON: ${parsed.error}`,
    };
  }

  const failures = validateRuntimeEvidencePayload(parsed.value, script, maxEvidenceAgeHours);
  return {
    type: 'runtime-evidence',
    ref: `${script} -> ${relativePath}`,
    ok: failures.length === 0,
    message: failures.length === 0 ? 'fresh passing runtime evidence exists' : failures.join('; '),
  };
}

function checkMatrix({
  root = repoRoot,
  matrix = RELEASE_GATES,
  gateId = null,
  scripts = loadRootScripts(root),
  requireRuntimeEvidence = false,
  evidenceDir = 'artifacts/release-gates',
  maxEvidenceAgeHours = 168,
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
    const runtimeEvidenceChecks = requireRuntimeEvidence
      ? gate.scripts.map((script) => checkRuntimeEvidence(root, script, evidenceDir, maxEvidenceAgeHours))
      : [];
    const checks = [...scriptChecks, ...evidenceChecks, ...runtimeEvidenceChecks];
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
  if (result.requireRuntimeEvidence) {
    lines.push(`[mode] runtime evidence required; evidenceDir=${result.evidenceDir}; maxAgeHours=${result.maxEvidenceAgeHours}`);
  } else {
    lines.push('[mode] metadata only');
  }
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

  const result = checkMatrix({
    gateId: args.gate,
    requireRuntimeEvidence: args.requireRuntimeEvidence,
    evidenceDir: args.evidenceDir,
    maxEvidenceAgeHours: args.maxEvidenceAgeHours,
  });
  result.requireRuntimeEvidence = args.requireRuntimeEvidence;
  result.evidenceDir = args.evidenceDir;
  result.maxEvidenceAgeHours = args.maxEvidenceAgeHours;
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
  checkRuntimeEvidence,
  defaultRuntimeEvidenceForScript,
  formatList,
  formatReport,
  loadRootScripts,
  parseArgs,
  selectGates,
  validateRuntimeEvidencePayload,
};
