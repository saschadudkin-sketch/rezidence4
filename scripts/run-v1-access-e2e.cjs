#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { buildE2EEnv, repoRoot } = require('./e2e-env.cjs');

const node = process.execPath;
const artifactDir = path.join(repoRoot, 'artifacts', 'release-gates');
const artifactPath = path.join(artifactDir, 'test-e2e-v1-access.json');

function run(args, env) {
  const result = spawnSync(node, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env,
  });
  return result.status ?? 1;
}

function evidenceEnvironment() {
  return process.env.RELEASE_GATE_ENVIRONMENT || (process.env.CI ? 'ci' : 'local');
}

function isProcessCrashStatus(status) {
  return status === -1073741819 || status === 3221225477;
}

function runWithCrashRetry(args, env) {
  let status = 1;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    status = run(args, env);
    if (!isProcessCrashStatus(status) || attempt === 3) return status;
    console.warn(`[test:e2e:v1-access] child process crashed before verdict; retrying (${attempt}/3); status=${status}`);
  }
  return status;
}

function writeArtifact(status) {
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(artifactPath, `${JSON.stringify({
    schema_version: 1,
    script: 'test:e2e:v1-access',
    command: 'npm run test:e2e:v1-access',
    captured_at: new Date().toISOString(),
    environment: evidenceEnvironment(),
    ok: status === 0,
    exit_code: status,
  }, null, 2)}\n`);
}

const e2eEnv = buildE2EEnv({
  ...process.env,
  E2E_BACKEND_MODE: '1',
  E2E_V1_ACCESS: '1',
  E2E_START_BACKEND: '1',
  E2E_PROPERTY_TYPE: 'cottage_community',
  VITE_RUNTIME_MODE: 'live',
  VITE_ENABLE_DEMO: 'false',
});

let status = runWithCrashRetry([
  path.join(repoRoot, 'scripts', 'tenant-ops-preflight.cjs'),
  '--e2e-access',
], e2eEnv);
if (status !== 0) {
  writeArtifact(status);
  process.exit(status);
}

status = runWithCrashRetry([
  path.join(repoRoot, 'scripts', 'playwright-preflight.cjs'),
], e2eEnv);
if (status !== 0) {
  writeArtifact(status);
  process.exit(status);
}

status = runWithCrashRetry([
  path.join(repoRoot, 'scripts', 'run-playwright-tests.cjs'),
  'e2e/v1-access-production.spec.js',
  '--project=chromium',
], e2eEnv);

writeArtifact(status);
process.exit(status);
