#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { buildE2EEnv, repoRoot } = require('./e2e-env.cjs');

const node = process.execPath;

function run(args, env) {
  const result = spawnSync(node, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env,
  });
  return result.status ?? 1;
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

let status = run([
  path.join(repoRoot, 'scripts', 'tenant-ops-preflight.cjs'),
  '--e2e-access',
], e2eEnv);
if (status !== 0) process.exit(status);

status = run([
  path.join(repoRoot, 'scripts', 'playwright-preflight.cjs'),
], e2eEnv);
if (status !== 0) process.exit(status);

status = run([
  path.join(repoRoot, 'scripts', 'run-playwright-tests.cjs'),
  'e2e/v1-access-production.spec.js',
  '--project=chromium',
], e2eEnv);

process.exit(status);
