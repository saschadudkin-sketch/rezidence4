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
let hasError = false;

for (const file of cssFiles) {
  const text = readFileSync(file, 'utf8');
  const mediaLiteralMatches = text.matchAll(/@media[^{]+\((?:min|max)-width:\s*\d+px\)/g);
  for (const [match] of mediaLiteralMatches) {
    if (file.endsWith('tokens.css')) continue;
    console.error(`[style-governance] Literal breakpoint is forbidden in ${file}: ${match}`);
    hasError = true;
  }

  const widthMediaAliases = text.matchAll(/@media[^{]+\(--bp-[^)]+\)/g);
  const widthMediaQueries = text.matchAll(/@media[^{]+\((?:min|max)-width:[^)]+\)/g);
  const hasWidthQueries = Array.from(widthMediaQueries).length > 0;
  if (hasWidthQueries && !file.endsWith('tokens.css') && Array.from(widthMediaAliases).length === 0) {
    console.error(`[style-governance] ${file} has width media queries without --bp-* custom-media aliases`);
    hasError = true;
  }
}

function walkCode(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walkCode(full, acc);
    else if (/\.(ts|tsx|js|jsx)$/.test(full)) acc.push(full);
  }
  return acc;
}

const codeFiles = walkCode('src');
for (const file of codeFiles) {
  const text = readFileSync(file, 'utf8');
  const literalMatchMedia = text.match(/matchMedia\(\s*['"`]\(.*(?:min|max)-width:\s*\d+px.*\)['"`]\s*\)/);
  if (literalMatchMedia) {
    console.error(`[style-governance] Literal matchMedia breakpoint is forbidden in ${file}: ${literalMatchMedia[0]}`);
    hasError = true;
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
