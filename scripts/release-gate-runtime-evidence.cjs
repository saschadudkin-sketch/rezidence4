#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  RELEASE_GATES,
  checkRuntimeEvidence,
  defaultRuntimeEvidenceForScript,
} = require('./release-gate-matrix.cjs');
const { buildE2EEnv, repoRoot } = require('./e2e-env.cjs');

const DEFAULT_ARTIFACT_DIR = 'artifacts/release-gates';
const DEFAULT_STEP_TIMEOUT_MS = 20 * 60 * 1000;
const RETRYABLE_SPAWN_ERROR_CODES = new Set(['EBUSY', 'EAGAIN', 'EPERM']);

function parseArgs(argv = []) {
  return {
    all: argv.includes('--all'),
    dryRun: argv.includes('--dry-run'),
    json: argv.includes('--json'),
    staleOnly: argv.includes('--stale-only'),
    gate: readOption(argv, '--gate'),
    scripts: readOptions(argv, '--script'),
    environment: readOption(argv, '--environment')
      || process.env.RELEASE_GATE_ENVIRONMENT
      || (process.env.CI ? 'ci' : 'local'),
    artifactDir: readOption(argv, '--artifact-dir') || DEFAULT_ARTIFACT_DIR,
    maxEvidenceAgeHours: Number(readOption(argv, '--max-evidence-age-hours') || 168),
    backupReference: readOption(argv, '--backup-reference') || 'local-backups://D:/rezidence4/backups',
    restoreTarget: readOption(argv, '--restore-target') || 'local-docker-restore-drill',
    tenantProvisionSlug: readOption(argv, '--tenant-provision-slug') || 'dryrun-zamoskv',
    tenantProvisionName: readOption(argv, '--tenant-provision-name') || 'Dry Run Zamoskv',
    stepTimeoutMs: parsePositiveInt(readOption(argv, '--step-timeout-ms'), DEFAULT_STEP_TIMEOUT_MS),
  };
}

function readOption(argv, name) {
  const inline = argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  if (index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--')) return argv[index + 1];
  return null;
}

function readOptions(argv, name) {
  const values = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith(`${name}=`)) {
      values.push(token.slice(name.length + 1));
    } else if (token === name && argv[i + 1] && !argv[i + 1].startsWith('--')) {
      values.push(argv[i + 1]);
      i += 1;
    }
  }
  return values;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function scriptArtifactName(script) {
  return `${script.replace(/[^a-z0-9_.-]/gi, '-')}.json`;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isProcessCrashStatus(status) {
  return status === -1073741819 || status === 3221225477;
}

function shouldRetry(result, attempt) {
  if (attempt >= 3) return false;
  if (isProcessCrashStatus(result.status)) return true;
  return RETRYABLE_SPAWN_ERROR_CODES.has(result.error?.code);
}

function commandString(command, args = []) {
  return [command, ...args].join(' ');
}

function tail(value) {
  const text = String(value || '').trim();
  return text.length > 2000 ? text.slice(-2000) : text;
}

function runProcess(command, args, options = {}) {
  let result;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    result = spawnSync(command, args, {
      cwd: options.cwd || repoRoot,
      env: options.env || process.env,
      encoding: 'utf8',
      stdio: 'pipe',
      shell: options.shell || false,
      timeout: options.timeoutMs || DEFAULT_STEP_TIMEOUT_MS,
    });

    if (!shouldRetry(result, attempt)) break;
    sleep(1500 * attempt);
  }

  const timedOut = result.error?.code === 'ETIMEDOUT';
  return {
    command,
    args,
    exitCode: result.status ?? (timedOut ? 124 : (result.error ? 1 : 0)),
    error: result.error ? result.error.message : null,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    signal: result.signal || null,
    timedOut,
  };
}

function buildRuntimeArtifact({ script, command, environment, result }) {
  return {
    schema_version: 1,
    script,
    command,
    captured_at: new Date().toISOString(),
    environment,
    ok: result.exitCode === 0,
    exit_code: result.exitCode,
    evidence: {
      exit_code: result.exitCode,
      timed_out: Boolean(result.timedOut),
      signal: result.signal || null,
    },
    stdout_tail: tail(result.stdout),
    stderr_tail: tail(result.stderr || result.error),
  };
}

function writeRuntimeArtifact({ root, artifactDir, script, artifact }) {
  const relativePath = path.join(artifactDir, scriptArtifactName(script)).replace(/\\/g, '/');
  const absolutePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(artifact, null, 2)}\n`);
  return relativePath;
}

function unique(values) {
  return [...new Set(values)];
}

function scriptsForGate(gateId) {
  const gate = RELEASE_GATES.find((item) => item.id === gateId);
  if (!gate) throw new Error(`unknown release gate: ${gateId}`);
  return gate.scripts;
}

function allMatrixScripts() {
  return unique(RELEASE_GATES.flatMap((gate) => gate.scripts));
}

function resolveScriptSelection(options) {
  if (options.scripts.length) return unique(options.scripts);
  if (options.gate) return unique(scriptsForGate(options.gate));
  if (options.all) return allMatrixScripts();
  return allMatrixScripts();
}

function nodeScript(relativePath, args = [], env = {}) {
  return {
    command: process.execPath,
    args: [path.join(repoRoot, relativePath), ...args],
    env,
  };
}

function buildCommandRegistry(options, env = buildE2EEnv(process.env)) {
  const tenantDbUrl = env.ZAMOSKV_DB_URL || env.TENANT_DB_URL;
  const provisionArgs = [
    '--dry-run',
    '--slug',
    options.tenantProvisionSlug,
    '--name',
    options.tenantProvisionName,
    '--property-type',
    'cottage_community',
  ];
  const provisionLabelArgs = [...provisionArgs];
  if (tenantDbUrl) provisionArgs.push('--db-url', tenantDbUrl);
  if (tenantDbUrl) provisionLabelArgs.push('--db-url', '[redacted]');

  return new Map(Object.entries({
    'backend:test': {
      label: 'npm run backend:test',
      command: process.execPath,
      args: [path.join(repoRoot, 'backend', 'node_modules', 'jest', 'bin', 'jest.js'), '--runInBand'],
      cwd: path.join(repoRoot, 'backend'),
    },
    'frontend:lint': {
      label: 'npm run frontend:lint',
      ...nodeScript('scripts/run-frontend-script.cjs', ['lint']),
    },
    typecheck: {
      label: 'npm run typecheck',
      ...nodeScript('scripts/run-frontend-script.cjs', ['typecheck:ci']),
    },
    'frontend:test': {
      label: 'npm run frontend:test',
      ...nodeScript('scripts/run-frontend-script.cjs', ['test']),
    },
    'frontend:build': {
      label: 'npm run frontend:build',
      ...nodeScript('scripts/run-frontend-script.cjs', ['build']),
    },
    'test:e2e:preflight': {
      label: 'npm run test:e2e:preflight',
      ...nodeScript('scripts/playwright-preflight.cjs'),
    },
    'test:e2e:v1-access': {
      label: 'npm run test:e2e:v1-access',
      writesOwnArtifact: true,
      ...nodeScript('scripts/run-v1-access-e2e.cjs'),
    },
    'test:e2e:v1-packages': {
      label: 'npm run test:e2e:v1-packages',
      writesOwnArtifact: true,
      ...nodeScript('scripts/run-v1-packages-e2e.cjs'),
    },
    'test:e2e:v1-service-execution': {
      label: 'npm run test:e2e:v1-service-execution',
      writesOwnArtifact: true,
      ...nodeScript('scripts/run-v1-service-execution-e2e.cjs'),
    },
    'verify:strict': {
      label: 'npm run verify:strict',
      writesOwnArtifact: true,
      ...nodeScript('scripts/run-strict-verify.cjs', ['--environment', options.environment]),
    },
    'tenant:preflight:e2e': {
      label: 'npm run tenant:preflight:e2e',
      ...nodeScript('scripts/tenant-ops-preflight.cjs', ['--e2e-access']),
    },
    'tenant:preflight:current': {
      label: 'npm run tenant:preflight:current',
      ...nodeScript('scripts/tenant-ops-preflight.cjs', ['--require-current-migrations']),
    },
    'tenant:provision': {
      label: `npm run tenant:provision -- ${provisionLabelArgs.join(' ')}`,
      ...nodeScript('scripts/tenant-ops-provision.cjs', provisionArgs),
      env,
    },
    'tenant:migrate': {
      label: 'npm run tenant:migrate',
      ...nodeScript('scripts/tenant-ops-migrate.cjs'),
    },
    'tenant:restore-drill:preflight': {
      label: 'npm run tenant:backup-restore:evidence -- --write --preflight',
      writesOwnArtifact: true,
      ...nodeScript('scripts/backup-restore-evidence.cjs', [
        '--write',
        '--preflight',
        '--environment',
        options.environment,
        '--backup-reference',
        options.backupReference,
        '--restore-target',
        options.restoreTarget,
      ]),
    },
    'tenant:restore-drill': {
      label: 'npm run tenant:backup-restore:evidence -- --write --drill',
      writesOwnArtifact: true,
      ...nodeScript('scripts/backup-restore-evidence.cjs', [
        '--write',
        '--drill',
        '--environment',
        options.environment,
        '--backup-reference',
        options.backupReference,
        '--restore-target',
        options.restoreTarget,
      ]),
    },
    'pilot:training-pack': {
      label: 'npm run pilot:training-pack',
      ...nodeScript('scripts/pilot-training-pack-check.cjs'),
    },
    'pilot:readiness': {
      label: 'npm run pilot:readiness',
      ...nodeScript('scripts/pilot-readiness-check.cjs'),
    },
    'russia:readiness': {
      label: 'npm run russia:readiness',
      ...nodeScript('scripts/russia-readiness-check.cjs'),
    },
  }));
}

function isFresh({ root, script, options }) {
  return checkRuntimeEvidence(
    root,
    script,
    options.artifactDir,
    options.maxEvidenceAgeHours,
  ).ok;
}

function runReleaseGateRuntimeEvidence({
  root = repoRoot,
  argv = process.argv.slice(2),
  spawn = runProcess,
  env = buildE2EEnv(process.env),
} = {}) {
  const options = parseArgs(argv);
  const registry = buildCommandRegistry(options, env);
  const selected = resolveScriptSelection(options);
  const steps = [];
  const unknown = selected.filter((script) => !registry.has(script));
  if (unknown.length) throw new Error(`unsupported release-gate script(s): ${unknown.join(', ')}`);

  for (const script of selected) {
    const command = registry.get(script);
    const alreadyFresh = options.staleOnly && isFresh({ root, script, options });
    if (alreadyFresh) {
      steps.push({
        script,
        ok: true,
        skipped: true,
        reason: 'fresh runtime evidence already exists',
        artifact: defaultRuntimeEvidenceForScript(script, options.artifactDir),
      });
      continue;
    }

    if (options.dryRun) {
      steps.push({
        script,
        ok: true,
        skipped: true,
        reason: 'dry run',
        command: command.label,
      });
      continue;
    }

    const result = spawn(command.command, command.args, {
      cwd: command.cwd || root,
      env: { ...process.env, ...(command.env || {}), RELEASE_GATE_ENVIRONMENT: options.environment },
      timeoutMs: options.stepTimeoutMs,
    });
    const ok = result.exitCode === 0;
    let artifact = null;

    if (!command.writesOwnArtifact) {
      artifact = writeRuntimeArtifact({
        root,
        artifactDir: options.artifactDir,
        script,
        artifact: buildRuntimeArtifact({
          script,
          command: command.label || commandString(command.command, command.args),
          environment: options.environment,
          result,
        }),
      });
    } else {
      artifact = defaultRuntimeEvidenceForScript(script, options.artifactDir);
    }

    steps.push({
      script,
      ok,
      skipped: false,
      exit_code: result.exitCode,
      command: command.label || commandString(command.command, command.args),
      artifact,
    });
    if (!ok) break;
  }

  return {
    ok: steps.every((step) => step.ok),
    environment: options.environment,
    artifactDir: options.artifactDir,
    steps,
  };
}

function formatReport(result) {
  const lines = ['[release-gate-runtime-evidence]'];
  lines.push(`[environment] ${result.environment}`);
  for (const step of result.steps) {
    if (step.skipped) {
      lines.push(`[skip] ${step.script}: ${step.reason}`);
    } else {
      lines.push(`${step.ok ? '[ok]' : '[fail]'} ${step.script}: ${step.command}`);
      if (step.artifact) lines.push(`  artifact: ${step.artifact}`);
    }
  }
  if (result.ok) lines.push('[ok] release-gate runtime evidence refreshed');
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = runReleaseGateRuntimeEvidence({ argv: process.argv.slice(2) });
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
    console.error(`[release-gate-runtime-evidence] ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  buildCommandRegistry,
  buildRuntimeArtifact,
  formatReport,
  parseArgs,
  resolveScriptSelection,
  runReleaseGateRuntimeEvidence,
  writeRuntimeArtifact,
};
