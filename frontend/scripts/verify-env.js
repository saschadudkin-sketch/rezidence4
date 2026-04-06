#!/usr/bin/env node
/**
 * verify-env.js — A-12: CI preflight env validation.
 * Run before build or test to catch missing env variables early.
 * Usage: node scripts/verify-env.js
 */

import { mkdirSync, writeFileSync } from 'fs';

const REQUIRED_PROD = ['VITE_API_URL', 'VITE_RUNTIME_MODE'];
const REQUIRED_ALWAYS = [];

const mode = process.env.NODE_ENV || 'development';
const isProd = mode === 'production';

const missing = [];
for (const v of REQUIRED_ALWAYS) {
  if (!process.env[v]) missing.push(v);
}
if (isProd) {
  for (const v of REQUIRED_PROD) {
    if (!process.env[v]) missing.push(v);
  }
}

if (missing.length > 0) {
  const remediation = [
    '# Environment preflight failed',
    '',
    `Mode: \`${mode}\``,
    '',
    '## Missing variables',
    ...missing.map((v) => `- \`${v}\``),
    '',
    '## Remediation',
    '- Set `VITE_API_URL` to your backend origin (for example, `https://api.example.com`).',
    '- Set `VITE_RUNTIME_MODE=live` for production builds.',
    '- Re-run `npm run verify:env` before `npm run build`.',
    '',
  ].join('\n');
  try {
    mkdirSync('../artifacts', { recursive: true });
    writeFileSync('../artifacts/verify-env.md', remediation, 'utf8');
  } catch {
    // ignore file-system errors in constrained CI runners
  }
  console.error('[verify:env] ✗ Missing required environment variables:');
  for (const v of missing) console.error(`  - ${v}`);
  console.error('\nSet these variables before running build or CI.');
  console.error('See ../artifacts/verify-env.md for remediation steps.\n');
  process.exit(1);
}

const checked = REQUIRED_ALWAYS.length + (isProd ? REQUIRED_PROD.length : 0);
console.log(`[verify:env] ✓ OK — mode=${mode}, checked ${checked} variable(s)`);
