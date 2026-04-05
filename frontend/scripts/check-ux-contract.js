#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

function walkTsx(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walkTsx(full, acc);
    else if (full.endsWith('.tsx')) acc.push(full);
  }
  return acc;
}

const targetFiles = [...walkTsx('src/views'), ...walkTsx('src/perms')];
let hasError = false;

for (const file of targetFiles) {
  const text = readFileSync(file, 'utf8');
  if (!text.includes('StateBlock')) continue;
  if (!text.includes('getViewStateCopy')) {
    console.error(`[ux-contract] ${file} uses StateBlock but does not import getViewStateCopy`);
    hasError = true;
  }
}

if (hasError) {
  console.error('\n❌ UX contract check failed.');
  process.exit(1);
}

console.log('✅ UX contract check passed.');
