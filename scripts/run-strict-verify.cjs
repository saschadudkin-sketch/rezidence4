#!/usr/bin/env node
'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { repoRoot } = require('./e2e-env.cjs');

const node = process.execPath;
const artifactDir = path.join(repoRoot, 'artifacts', 'release-gates');
const artifactPath = path.join(artifactDir, 'verify-strict.json');

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const phaseTimeouts = {
  verify: parsePositiveInt(process.env.STRICT_VERIFY_PHASE_TIMEOUT_MS, 20 * 60 * 1000),
  releaseMatrix: parsePositiveInt(process.env.STRICT_RELEASE_MATRIX_TIMEOUT_MS, 60 * 1000),
  v1AccessE2e: parsePositiveInt(process.env.STRICT_V1_ACCESS_E2E_TIMEOUT_MS, 15 * 60 * 1000),
};

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

function writeArtifact(result) {
  ensureArtifactDir();
  fs.writeFileSync(artifactPath, `${JSON.stringify({
    schema_version: 1,
    command: 'npm run verify:strict',
    captured_at: new Date().toISOString(),
    environment: process.env.CI ? 'ci' : 'local',
    ok: result.ok,
    timed_out: result.timedOut,
    exit_code: result.exitCode,
    phases: result.phases,
  }, null, 2)}\n`);
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

async function main() {
  const startedAtMs = Date.now();
  const completedPhases = [];
  let exitCode = 0;
  let timedOut = false;

  for (const phase of phases) {
    const result = await runPhase(phase);
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
  writeArtifact(result);
  console.log(`[verify:strict] artifact=${path.relative(repoRoot, artifactPath)}`);
  process.exit(exitCode);
}

if (require.main === module) {
  main().catch((err) => {
    const result = {
      ok: false,
      timedOut: false,
      exitCode: 1,
      phases: [],
      error: err.stack || err.message,
      durationMs: 0,
    };
    writeArtifact(result);
    console.error(`[verify:strict] ${err.stack || err.message}`);
    process.exit(1);
  });
}
