#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOTS = [
  path.resolve('src/services/providers'),
  path.resolve('src/services/http'),
];

const offenders = [];

function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(ts|tsx|js|jsx)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) checkFile(full);
  }
}

function checkFile(file) {
  const src = fs.readFileSync(file, 'utf8');
  const re = /(["'`])(\/api\/(?!v1\/)[^"'`\s]*)\1/g;
  let m;
  while ((m = re.exec(src))) {
    offenders.push({ file, endpoint: m[2] });
  }
}

ROOTS.forEach(walk);

if (offenders.length) {
  console.error('[verify:api-version] Legacy /api/* endpoints found (use /api/v1/*):');
  for (const { file, endpoint } of offenders) {
    console.error(` - ${path.relative(process.cwd(), file)} -> ${endpoint}`);
  }
  process.exit(1);
}

console.log('[verify:api-version] OK');
