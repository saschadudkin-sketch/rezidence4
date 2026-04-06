#!/usr/bin/env node
import { readFileSync } from 'fs';
import { spawnSync } from 'child_process';

const baseline = JSON.parse(readFileSync(new URL('../type-debt-noex-baseline.json', import.meta.url), 'utf8'));
const result = spawnSync('npx', ['tsc', '--noEmit', '-p', 'tsconfig.ci.json'], { encoding: 'utf8' });
const output = `${result.stdout || ''}\n${result.stderr || ''}`;
const currentErrors = (output.match(/error TS\d+:/g) || []).length;

if (currentErrors > baseline.maxTypeErrors) {
  console.error(output.trim());
  console.error(`\n❌ No-exclusions type debt regression: ${currentErrors} errors (baseline ${baseline.maxTypeErrors}).`);
  process.exit(1);
}

console.log(`✅ No-exclusions type debt gate passed: ${currentErrors} errors (baseline ${baseline.maxTypeErrors}).`);
if (currentErrors > 0) {
  console.log('ℹ️  Debt remains in broad source+tests typecheck; continue burn-down.');
}
