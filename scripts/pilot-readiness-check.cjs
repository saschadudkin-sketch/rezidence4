#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { repoRoot } = require('./e2e-env.cjs');

const REQUIRED_ROOT_SCRIPTS = [
  'verify:strict',
  'release:gate:check',
  'tenant:preflight:e2e',
  'tenant:preflight:current',
  'tenant:provision',
  'tenant:migrate',
  'tenant:restore-drill:preflight',
  'tenant:restore-drill',
  'pilot:readiness',
  'russia:readiness',
];

const REQUIRED_EVIDENCE = [
  'docs/product/specs/domhub-operational-runbooks-index.md',
  'docs/product/specs/domhub-release-gate-checklists.md',
  'docs/product/specs/domhub-deployment-and-tenant-ops-spec.md',
  'docs/product/specs/domhub-russia-production-readiness-spec.md',
  'docs/product/specs/platform-v1/go-live-zamoskv-runbook.md',
  'docs/runbooks/restore-drill.md',
  'docs/runbooks/pilot-rollout.md',
  'e2e/v1-access-production.spec.js',
  'scripts/release-gate-matrix.cjs',
  'scripts/tenant-ops-preflight.cjs',
  'scripts/tenant-ops-provision.cjs',
  'scripts/tenant-ops-migrate.cjs',
  'scripts/restore-drill-preflight.cjs',
  'scripts/russia-readiness-check.cjs',
];

const PILOT_RUNBOOK_SECTIONS = [
  'Property launch',
  'Tenant provisioning and migrations',
  'Resident import and activation',
  'Guard/checkpoint training',
  'Degraded checkpoint mode',
  'Emergency dispatch',
  'First-week support',
  'Incident escalation',
  'Data correction and offboarding',
  'Backup/restore and rollback',
  'Go/no-go decision',
];

function parseArgs(argv = []) {
  return {
    json: argv.includes('--json'),
  };
}

function loadRootScripts(root = repoRoot) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  return pkg.scripts || {};
}

function readText(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function makeCheck(ref, ok, message, type) {
  return { type, ref, ok, message };
}

function checkPilotReadiness({
  root = repoRoot,
  scripts = loadRootScripts(root),
  evidence = REQUIRED_EVIDENCE,
  requiredScripts = REQUIRED_ROOT_SCRIPTS,
  sections = PILOT_RUNBOOK_SECTIONS,
} = {}) {
  const checks = [];

  for (const script of requiredScripts) {
    checks.push(makeCheck(
      script,
      Object.prototype.hasOwnProperty.call(scripts, script),
      Object.prototype.hasOwnProperty.call(scripts, script)
        ? 'root package script exists'
        : 'missing root package script',
      'script',
    ));
  }

  for (const relativePath of evidence) {
    const exists = fs.existsSync(path.join(root, relativePath));
    checks.push(makeCheck(
      relativePath,
      exists,
      exists ? 'evidence path exists' : 'missing evidence path',
      'evidence',
    ));
  }

  const pilotRunbookPath = 'docs/runbooks/pilot-rollout.md';
  if (fs.existsSync(path.join(root, pilotRunbookPath))) {
    const runbook = readText(root, pilotRunbookPath);
    for (const section of sections) {
      const ok = runbook.toLowerCase().includes(section.toLowerCase());
      checks.push(makeCheck(
        `${pilotRunbookPath}#${section}`,
        ok,
        ok ? 'pilot runbook section exists' : 'missing pilot runbook section',
        'runbook-section',
      ));
    }
  }

  const indexPath = 'docs/product/specs/domhub-operational-runbooks-index.md';
  if (fs.existsSync(path.join(root, indexPath))) {
    const index = readText(root, indexPath);
    const linked = index.includes('docs/runbooks/pilot-rollout.md')
      || index.includes('../../runbooks/pilot-rollout.md')
      || index.includes('../runbooks/pilot-rollout.md');
    checks.push(makeCheck(
      indexPath,
      linked,
      linked ? 'pilot runbook linked from runbook index' : 'pilot runbook is not linked from runbook index',
      'runbook-index',
    ));
  }

  return {
    ok: checks.every((check) => check.ok),
    checks,
  };
}

function formatReport(result) {
  const lines = ['[pilot-readiness]'];
  for (const check of result.checks) {
    if (!check.ok) lines.push(`[fail] ${check.type} ${check.ref}: ${check.message}`);
  }
  if (result.ok) lines.push('[ok] pilot rollout readiness evidence is registered');
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = checkPilotReadiness();
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
    console.error(`[pilot-readiness] ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  PILOT_RUNBOOK_SECTIONS,
  REQUIRED_EVIDENCE,
  REQUIRED_ROOT_SCRIPTS,
  checkPilotReadiness,
  formatReport,
  loadRootScripts,
  parseArgs,
};
