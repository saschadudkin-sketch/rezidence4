#!/usr/bin/env node
/**
 * PERF-05: Bundle size budget check.
 * Fails the build if any JS chunk exceeds MAX_CHUNK_KB.
 *
 * Usage: node scripts/check-bundle-size.js [dist-dir]
 * Called by: npm run build:check (after vite build)
 */

import { readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

const MAX_CHUNK_KB = 600; // hard limit per chunk (raw, before gzip)
const WARN_CHUNK_KB = 300; // warning threshold

const distDir = process.argv[2] || 'dist/assets';

let hasError = false;
let files;

try {
  files = readdirSync(distDir);
} catch {
  console.error(`[bundle-check] dist directory not found: ${distDir}`);
  console.error('[bundle-check] Run "npm run build" first.');
  process.exit(1);
}

const jsFiles = files.filter(f => extname(f) === '.js');

if (jsFiles.length === 0) {
  console.error('[bundle-check] No JS files found in ' + distDir);
  process.exit(1);
}

console.log('\n📦 Bundle size check\n');

for (const file of jsFiles.sort()) {
  const filePath = join(distDir, file);
  const sizeKB = Math.round(statSync(filePath).size / 1024);
  const status = sizeKB > MAX_CHUNK_KB ? '❌ OVER LIMIT'
               : sizeKB > WARN_CHUNK_KB ? '⚠️  WARN'
               : '✓';
  console.log(`  ${status.padEnd(14)} ${file.padEnd(60)} ${sizeKB} KB`);
  if (sizeKB > MAX_CHUNK_KB) hasError = true;
}

console.log('');
console.log(`  Limits: warn >${WARN_CHUNK_KB} KB, error >${MAX_CHUNK_KB} KB per chunk`);

if (hasError) {
  console.error('\n❌  Bundle size budget exceeded. Split large chunks in vite.config.js.\n');
  process.exit(1);
} else {
  console.log('\n✅  All chunks within budget.\n');
}
