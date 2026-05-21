#!/usr/bin/env node
'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { repoRoot } = require('./e2e-env.cjs');

const node = process.execPath;
const artifactDir = path.join(repoRoot, 'artifacts', 'release-gates');
const artifactPath = path.join(artifactDir, 'verify-strict.json');
const ALLOWED_ENVIRONMENTS = ['local', 'ci', 'staging', 'prod-candidate', 'pilot', 'production'];

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readOption(argv, name) {
  const inline = argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  if (index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--')) return argv[index + 1];
  return null;
}

function parseArgs(argv = []) {
  const environment = readOption(argv, '--environment')
    || process.env.RELEASE_GATE_ENVIRONMENT
    || (process.env.CI ? 'ci' : 'local');
  if (!ALLOWED_ENVIRONMENTS.includes(environment)) {
    throw new Error(`--environment must be one of ${ALLOWED_ENVIRONMENTS.join(', ')}`);
  }
  return { environment };
}

function commandForArtifact(argv = []) {
  const suffix = argv.length ? ` -- ${argv.join(' ')}` : '';
  return `npm run verify:strict${suffix}`;
}

const phaseTimeouts = {
  verify: parsePositiveInt(process.env.STRICT_VERIFY_PHASE_TIMEOUT_MS, 20 * 60 * 1000),
  releaseMatrix: parsePositiveInt(process.env.STRICT_RELEASE_MATRIX_TIMEOUT_MS, 60 * 1000),
  v1AccessE2e: parsePositiveInt(process.env.STRICT_V1_ACCESS_E2E_TIMEOUT_MS, 15 * 60 * 1000),
  v1PackagesE2e: parsePositiveInt(process.env.STRICT_V1_PACKAGES_E2E_TIMEOUT_MS, 15 * 60 * 1000),
  v1ServiceExecutionE2e: parsePositiveInt(process.env.STRICT_V1_SERVICE_EXECUTION_E2E_TIMEOUT_MS, 15 * 60 * 1000),
};
const RETRYABLE_SPAWN_ERROR_CODES = new Set(['EBUSY', 'EAGAIN', 'EPERM']);

const phases = [
  {
    id: 'verify',
    label: 'root verify',
    args: [path.join(repoRoot, 'scripts', 'run-checks.cjs'), 'verify'],
    timeoutMs: phaseTimeouts.verify,
  },
  {
    id: 'release-matrix-metadata',
    label: 'release gate metadata matrix',
    args: [path.join(repoRoot, 'scripts', 'release-gate-matrix.cjs'), '--metadata'],
    timeoutMs: phaseTimeouts.releaseMatrix,
  },
  {
    id: 'v1-access-e2e',
    label: 'backend-backed v1 access E2E',
    args: [path.join(repoRoot, 'scripts', 'run-v1-access-e2e.cjs')],
    timeoutMs: phaseTimeouts.v1AccessE2e,
    env: {
      E2E_FAIL_ON_INFRA_RETRY: '1',
    },
  },
  {
    id: 'v1-packages-e2e',
    label: 'backend-backed v1 packages E2E',
    args: [path.join(repoRoot, 'scripts', 'run-v1-packages-e2e.cjs')],
    timeoutMs: phaseTimeouts.v1PackagesE2e,
    env: {
      E2E_FAIL_ON_INFRA_RETRY: '1',
    },
  },
  {
    id: 'v1-service-execution-e2e',
    label: 'backend-backed v1 service execution E2E',
    args: [path.join(repoRoot, 'scripts', 'run-v1-service-execution-e2e.cjs')],
    timeoutMs: phaseTimeouts.v1ServiceExecutionE2e,
    env: {
      E2E_FAIL_ON_INFRA_RETRY: '1',
    },
  },
];

function ensureArtifactDir() {
  fs.mkdirSync(artifactDir, { recursive: true });
}

function killProcessTree(child) {
  if (!child || child.killed || child.exitCode !== null) return;

  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      cwd: repoRoot,
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }

  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {}
  }
}

function isProcessCrashStatus(status) {
  return status === -1073741819 || status === 3221225477;
}

function buildArtifact(result, options = {}) {
  return {
    schema_version: 1,
    command: options.command || 'npm run verify:strict',
    captured_at: new Date().toISOString(),
    environment: options.environment || (process.env.CI ? 'ci' : 'local'),
    ok: result.ok,
    timed_out: result.timedOut,
    exit_code: result.exitCode,
    phases: result.phases,
  };
}

function writeArtifact(result, options = {}) {
  ensureArtifactDir();
  fs.writeFileSync(artifactPath, `${JSON.stringify(buildArtifact(result, options), null, 2)}\n`);
}

function runPhase(phase) {
  return new Promise((resolve) => {
    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    console.log(`[verify:strict] start ${phase.id}; timeoutMs=${phase.timeoutMs}`);

    const child = spawn(node, phase.args, {
      cwd: repoRoot,
      env: { ...process.env, ...(phase.env || {}) },
      stdio: 'inherit',
      shell: false,
      detached: process.platform !== 'win32',
    });

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killProcessTree(child);
      const durationMs = Date.now() - startedAtMs;
      const result = {
        id: phase.id,
        label: phase.label,
        ok: false,
        status: 'timeout',
        exit_code: null,
        signal: 'TIMEOUT',
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        duration_ms: durationMs,
        timeout_ms: phase.timeoutMs,
      };
      console.error(`[verify:strict] timeout ${phase.id} after ${durationMs}ms`);
      resolve(result);
    }, phase.timeoutMs);

    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        id: phase.id,
        label: phase.label,
        ok: false,
        status: 'spawn_error',
        exit_code: null,
        signal: null,
        error: error.message,
        error_code: error.code || null,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAtMs,
        timeout_ms: phase.timeoutMs,
      });
    });

    child.once('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const ok = code === 0;
      resolve({
        id: phase.id,
        label: phase.label,
        ok,
        status: ok ? 'passed' : 'failed',
        exit_code: code,
        signal: signal || null,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAtMs,
        timeout_ms: phase.timeoutMs,
      });
    });
  });
}

async function runPhaseWithRetry(phase) {
  const attempts = [];

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const result = await runPhase(phase);
    attempts.push(result);

    if (
      result.status === 'failed'
      && isProcessCrashStatus(result.exit_code)
      && attempt < 2
    ) {
      console.warn(`[verify:strict] ${phase.id} crashed before verdict; retrying once; exit_code=${result.exit_code}`);
      continue;
    }

    if (
      result.status === 'spawn_error'
      && RETRYABLE_SPAWN_ERROR_CODES.has(result.error_code)
      && attempt < 2
    ) {
      console.warn(`[verify:strict] ${phase.id} hit retryable spawn error ${result.error_code}; retrying once`);
      continue;
    }

    if (attempts.length > 1) {
      return {
        ...result,
        attempts,
      };
    }
    return result;
  }

  return attempts[attempts.length - 1];
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  process.env.RELEASE_GATE_ENVIRONMENT = options.environment;
  const startedAtMs = Date.now();
  const completedPhases = [];
  let exitCode = 0;
  let timedOut = false;

  for (const phase of phases) {
    const result = await runPhaseWithRetry(phase);
    completedPhases.push(result);
    if (!result.ok) {
      exitCode = result.status === 'timeout' ? 124 : (result.exit_code || 1);
      timedOut = result.status === 'timeout';
      break;
    }
  }

  const result = {
    ok: exitCode === 0,
    timedOut,
    exitCode,
    phases: completedPhases,
    durationMs: Date.now() - startedAtMs,
  };
  writeArtifact(result, {
    command: commandForArtifact(argv),
    environment: options.environment,
  });
  console.log(`[verify:strict] artifact=${path.relative(repoRoot, artifactPath)}`);
  process.exit(exitCode);
}

if (require.main === module) {
  main().catch((err) => {
    let options = {};
    try {
      options = parseArgs(process.argv.slice(2));
    } catch {
      options = { environment: process.env.CI ? 'ci' : 'local' };
    }
    const result = {
      ok: false,
      timedOut: false,
      exitCode: 1,
      phases: [],
      error: err.stack || err.message,
      durationMs: 0,
    };
    writeArtifact(result, {
      command: commandForArtifact(process.argv.slice(2)),
      environment: options.environment,
    });
    console.error(`[verify:strict] ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  ALLOWED_ENVIRONMENTS,
  buildArtifact,
  commandForArtifact,
  parseArgs,
};
