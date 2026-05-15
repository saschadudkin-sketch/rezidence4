#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { repoRoot } = require('./e2e-env.cjs');

const node = process.execPath;

function run(args, env = process.env) {
  const result = spawnSync(node, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env,
  });
  return result.status ?? 1;
}

let status = run([path.join(repoRoot, 'scripts', 'run-checks.cjs'), 'verify']);
if (status !== 0) process.exit(status);

status = run([path.join(repoRoot, 'scripts', 'release-gate-matrix.cjs')]);
if (status !== 0) process.exit(status);

status = run([
  path.join(repoRoot, 'scripts', 'run-v1-access-e2e.cjs'),
]);

process.exit(status);
