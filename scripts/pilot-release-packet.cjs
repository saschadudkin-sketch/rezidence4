#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { repoRoot } = require('./e2e-env.cjs');

const ALLOWED_ENVIRONMENTS = ['staging', 'prod-candidate', 'pilot', 'production'];

function parseArgs(argv = []) {
  return {
    environment: readOption(argv, '--environment'),
    propertySlug: readOption(argv, '--property-slug'),
    capturedBy: readOption(argv, '--captured-by'),
    logReference: readOption(argv, '--log-reference'),
    backupReference: readOption(argv, '--backup-reference'),
    restoreTarget: readOption(argv, '--restore-target'),
    liveDir: readOption(argv, '--live-dir') || 'artifacts/russia-readiness',
    templates: argv.includes('--templates'),
    json: argv.includes('--json'),
    skipVerify: argv.includes('--skip-verify'),
    skipBackupRestore: argv.includes('--skip-backup-restore'),
    skipCommandEvidence: argv.includes('--skip-command-evidence'),
    skipLiveGate: argv.includes('--skip-live-gate'),
  };
}

function readOption(argv, name) {
  const inline = argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  if (index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--')) return argv[index + 1];
  return null;
}

function validateOptions(options) {
  const failures = [];
  if (!ALLOWED_ENVIRONMENTS.includes(options.environment)) {
    failures.push(`--environment must be one of ${ALLOWED_ENVIRONMENTS.join(', ')}`);
  }
  if (!options.propertySlug) failures.push('--property-slug is required');
  if (!options.capturedBy) failures.push('--captured-by is required');
  if (!options.skipCommandEvidence && !options.logReference) failures.push('--log-reference is required');
  if ((!options.skipBackupRestore || !options.skipCommandEvidence) && !options.backupReference) {
    failures.push('--backup-reference is required');
  }
  if ((!options.skipBackupRestore || !options.skipCommandEvidence) && !options.restoreTarget) {
    failures.push('--restore-target is required');
  }
  if (failures.length) throw new Error(failures.join('; '));
}

function scriptPath(name) {
  return path.join(repoRoot, 'scripts', name);
}

function buildPlan(options) {
  const plan = [];
  if (!options.skipVerify) {
    plan.push({
      id: 'verify-strict',
      command: 'npm run verify:strict',
      args: [scriptPath('run-strict-verify.cjs'), '--environment', options.environment],
    });
  }

  if (!options.skipBackupRestore) {
    plan.push({
      id: 'backup-restore-evidence',
      command: 'npm run tenant:backup-restore:evidence',
      args: [
        scriptPath('backup-restore-evidence.cjs'),
        '--write',
        '--refresh',
        '--preflight',
        '--drill',
        '--environment',
        options.environment,
        '--backup-reference',
        options.backupReference,
        '--restore-target',
        options.restoreTarget,
      ],
    });
  }

  if (!options.skipCommandEvidence) {
    const args = [
      scriptPath('russia-readiness-evidence.cjs'),
      '--write',
      '--environment',
      options.environment,
      '--property-slug',
      options.propertySlug,
      '--captured-by',
      options.capturedBy,
      '--log-reference',
      options.logReference,
      '--backup-reference',
      options.backupReference,
      '--restore-target',
      options.restoreTarget,
    ];
    if (options.templates) args.push('--templates');
    plan.push({
      id: 'russia-command-evidence',
      command: 'npm run russia:readiness:evidence',
      args,
    });
  }

  if (!options.skipLiveGate) {
    plan.push({
      id: 'russia-live-readiness',
      command: 'npm run russia:readiness -- --require-live',
      args: [
        scriptPath('russia-readiness-check.cjs'),
        '--require-live',
        '--live-dir',
        options.liveDir,
      ],
    });
  }
  return plan;
}

function runProcess(args, env = process.env) {
  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    env,
    stdio: 'inherit',
    encoding: 'utf8',
  });
  return {
    exitCode: result.status ?? (result.error ? 1 : 0),
    error: result.error ? result.error.message : null,
  };
}

function runReleasePacket({
  argv = process.argv.slice(2),
  runner = runProcess,
} = {}) {
  const options = parseArgs(argv);
  validateOptions(options);
  const plan = buildPlan(options);
  const steps = [];
  const env = {
    ...process.env,
    RELEASE_GATE_ENVIRONMENT: options.environment,
  };

  for (const step of plan) {
    const result = runner(step.args, env, step);
    const outcome = {
      id: step.id,
      command: step.command,
      ok: result.exitCode === 0,
      exit_code: result.exitCode,
      error: result.error || null,
    };
    steps.push(outcome);
    if (!outcome.ok) {
      return { ok: false, environment: options.environment, steps };
    }
  }

  return { ok: true, environment: options.environment, steps };
}

function formatReport(result) {
  const lines = ['[pilot-release-packet]'];
  lines.push(`[environment] ${result.environment}`);
  for (const step of result.steps) {
    lines.push(`${step.ok ? '[ok]' : '[fail]'} ${step.id}: ${step.command}`);
    if (step.error) lines.push(`  ${step.error}`);
  }
  if (result.ok) lines.push('[ok] pilot release packet gates passed');
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = runReleasePacket({ argv: process.argv.slice(2) });
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
    console.error(`[pilot-release-packet] ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  ALLOWED_ENVIRONMENTS,
  buildPlan,
  formatReport,
  parseArgs,
  runReleasePacket,
  validateOptions,
};
