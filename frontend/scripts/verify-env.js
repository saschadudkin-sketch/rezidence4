#!/usr/bin/env node
/**
 * verify-env.js — A-12: CI preflight env validation.
 * Run before build or test to catch missing env variables early.
 * Usage: node scripts/verify-env.js
 */

const REQUIRED_PROD = ['VITE_API_URL'];
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
  console.error('[verify:env] ✗ Missing required environment variables:');
  for (const v of missing) console.error(`  - ${v}`);
  console.error('\nSet these variables before running build or CI.\n');
  process.exit(1);
}

const checked = REQUIRED_ALWAYS.length + (isProd ? REQUIRED_PROD.length : 0);
console.log(`[verify:env] ✓ OK — mode=${mode}, checked ${checked} variable(s)`);
