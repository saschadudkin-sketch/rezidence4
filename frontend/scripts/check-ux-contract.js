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
const featureListViews = [
  'src/views/ResidentsView.tsx',
  'src/views/GarageView.tsx',
  'src/views/VisitLogView.tsx',
  'src/views/BlacklistView.tsx',
  'src/views/GuardPostMode.tsx',
  'src/views/AdminView.tsx',
  'src/views/SecurityConciergeViews.tsx',
  'src/perms/PermsList.tsx',
];

for (const file of targetFiles) {
  const text = readFileSync(file, 'utf8');
  if (!text.includes('StateBlock')) continue;
  if (!text.includes('getViewStateCopy')) {
    console.error(`[ux-contract] ${file} uses StateBlock but does not import getViewStateCopy`);
    hasError = true;
  }
}

for (const file of featureListViews) {
  const text = readFileSync(file, 'utf8');
  if (!text.includes('StateBlock')) {
    console.error(`[ux-contract] ${file} must render <StateBlock> for loading/empty/error states`);
    hasError = true;
  }
}

if (hasError) {
  console.error('\n❌ UX contract check failed.');
  process.exit(1);
}

console.log('✅ UX contract check passed.');
