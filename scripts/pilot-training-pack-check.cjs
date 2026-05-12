#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { repoRoot } = require('./e2e-env.cjs');

const REQUIRED_ROOT_SCRIPTS = [
  'pilot:training-pack',
  'pilot:readiness',
  'russia:readiness',
  'release:gate:check',
];

const REQUIRED_EVIDENCE = [
  'docs/runbooks/pilot-operations-training-pack.md',
  'docs/runbooks/pilot-rollout.md',
  'docs/product/specs/platform-v1/pilot-operations-training-pack-spec.md',
  'docs/product/specs/domhub-operational-runbooks-index.md',
  'docs/product/specs/domhub-russia-production-readiness-spec.md',
  'docs/product/specs/domhub-release-gate-checklists.md',
  'scripts/pilot-training-pack-check.cjs',
  'scripts/pilot-readiness-check.cjs',
  'scripts/russia-readiness-check.cjs',
];

const TRAINING_PACK_SECTIONS = [
  'Pack Overview',
  'Roles And Sign-Off',
  'First-Week Support',
  'Guard/Checkpoint Training',
  'Emergency Drill',
  'Resident Offboarding Drill',
  'PDn/DSAR Support',
  'Daily Evidence Capture',
  'Go/No-Go And Rollback',
  'Training Acceptance',
];

const TRAINING_PACK_MARKERS = [
  ['docs/runbooks/pilot-operations-training-pack.md', 'DH-61'],
  ['docs/runbooks/pilot-operations-training-pack.md', 'first-week support'],
  ['docs/runbooks/pilot-operations-training-pack.md', 'guard/checkpoint'],
  ['docs/runbooks/pilot-operations-training-pack.md', 'emergency drill'],
  ['docs/runbooks/pilot-operations-training-pack.md', 'resident offboarding'],
  ['docs/runbooks/pilot-operations-training-pack.md', 'PDn/DSAR'],
  ['docs/runbooks/pilot-operations-training-pack.md', 'evidence capture'],
  ['docs/product/specs/platform-v1/pilot-operations-training-pack-spec.md', 'DH-61'],
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

function makeCheck(type, ref, ok, message) {
  return { type, ref, ok, message };
}

function checkPilotTrainingPack({
  root = repoRoot,
  scripts = loadRootScripts(root),
  requiredScripts = REQUIRED_ROOT_SCRIPTS,
  evidence = REQUIRED_EVIDENCE,
  sections = TRAINING_PACK_SECTIONS,
  markers = TRAINING_PACK_MARKERS,
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

  for (const relativePath of evidence) {
    const ok = fs.existsSync(path.join(root, relativePath));
    checks.push(makeCheck(
      'evidence',
      relativePath,
      ok,
      ok ? 'evidence path exists' : 'missing evidence path',
    ));
  }

  const packPath = 'docs/runbooks/pilot-operations-training-pack.md';
  if (fs.existsSync(path.join(root, packPath))) {
    const pack = readText(root, packPath).toLowerCase();
    for (const section of sections) {
      const ok = pack.includes(section.toLowerCase());
      checks.push(makeCheck(
        'training-section',
        `${packPath}#${section}`,
        ok,
        ok ? 'training pack section exists' : 'missing training pack section',
      ));
    }
  }

  for (const [relativePath, marker] of markers) {
    const absolutePath = path.join(root, relativePath);
    const ok = fs.existsSync(absolutePath)
      && fs.readFileSync(absolutePath, 'utf8').includes(marker);
    checks.push(makeCheck(
      'marker',
      `${relativePath} :: ${marker}`,
      ok,
      ok ? 'expected marker found' : 'expected marker missing',
    ));
  }

  return {
    ok: checks.every((check) => check.ok),
    checks,
  };
}

function formatReport(result) {
  const lines = ['[pilot-training-pack]'];
  for (const check of result.checks) {
    if (!check.ok) lines.push(`[fail] ${check.type} ${check.ref}: ${check.message}`);
  }
  if (result.ok) lines.push('[ok] pilot operations training pack evidence is registered');
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = checkPilotTrainingPack();
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
    console.error(`[pilot-training-pack] ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  REQUIRED_EVIDENCE,
  REQUIRED_ROOT_SCRIPTS,
  TRAINING_PACK_MARKERS,
  TRAINING_PACK_SECTIONS,
  checkPilotTrainingPack,
  formatReport,
  loadRootScripts,
  parseArgs,
};
