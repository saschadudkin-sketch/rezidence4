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
const forbiddenBreakpoints = ['760px', '761px', '861px', '381px', '461px'];
const allowedBreakpoints = new Set(['380', '400', '460', '480', '500', '560', '580', '600', '680', '768', '860', '1024']);
let hasError = false;

for (const file of cssFiles) {
  const text = readFileSync(file, 'utf8');
  for (const bp of forbiddenBreakpoints) {
    if (text.includes(bp)) {
      console.error(`[style-governance] Forbidden breakpoint ${bp} found in ${file}`);
      hasError = true;
    }
  }
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
