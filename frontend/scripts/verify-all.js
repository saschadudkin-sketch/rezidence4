#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const steps = [
  ['verify:env', ['node', ['scripts/verify-env.js']]],
  ['verify:api-version', ['node', ['scripts/check-no-legacy-api.js']]],
  ['verify:styles', ['node', ['scripts/check-style-governance.js']]],
  ['verify:ux-contract', ['node', ['scripts/check-ux-contract.js']]],
  ['verify:visual-state-matrix', ['node', ['scripts/check-visual-state-matrix.js']]],
  ['verify:design-governance', ['node', ['scripts/check-design-governance.js']]],
  ['verify:architecture-governance', ['node', ['scripts/check-architecture-governance.js']]],
  ['verify:modal-a11y', ['node', ['scripts/check-modal-a11y.js']]],
  ['lint', ['node', ['./node_modules/eslint/bin/eslint.js', 'src/**/*.{ts,tsx,js,jsx}', '--ignore-pattern', 'src/**/*.stories.*']]],
  ['typecheck:debt', ['node', ['scripts/check-type-debt.js']]],
  ['typecheck:compile', ['node', ['./node_modules/typescript/bin/tsc', '--noEmit', '-p', 'tsconfig.strict.json']]],
  ['test', ['node', ['./node_modules/vitest/vitest.mjs', 'run']]],
  ['verify:env:prod', ['node', ['scripts/verify-env.js', 'production']]],
  ['build', ['node', ['./node_modules/vite/bin/vite.js', 'build']]],
];

for (const [label, [command, args]] of steps) {
  console.log(`\n[verify:all] ${label}`);
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    if (result.error) console.error(result.error.message);
    process.exit(result.status || 1);
  }
}

console.log('\n[verify:all] passed');
