#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

function walkCss(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walkCss(full, acc);
    else if (full.endsWith('.css')) acc.push(full);
  }
  return acc;
}

const cssFiles = walkCss('src/styles');
const allowedBreakpoints = new Set(['480', '768', '1024', '1280', '1536']);
let hasError = false;

for (const file of cssFiles) {
  const text = readFileSync(file, 'utf8');
  const mediaMatches = text.matchAll(/@media[^{]+\((?:min|max)-width:\s*(\d+)px\)/g);
  for (const [, bp] of mediaMatches) {
    if (!allowedBreakpoints.has(bp)) {
      console.error(`[style-governance] Non-standard breakpoint ${bp}px found in ${file}`);
      hasError = true;
    }
  }
}

const foundations = readFileSync('src/styles/foundations.css', 'utf8');
if (!foundations.includes(':focus-visible')) {
  console.error('[style-governance] foundations.css must define :focus-visible styles');
  hasError = true;
}

if (hasError) {
  console.error('\n❌ Style governance checks failed.');
  process.exit(1);
}

console.log('✅ Style governance checks passed.');
