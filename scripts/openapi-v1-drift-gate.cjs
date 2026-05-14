#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const openApiPath = path.join(repoRoot, 'docs', 'openapi.json');
const routesPath = path.join(repoRoot, 'backend', 'src', 'app', 'registerApiRoutes.js');

const ROOT_MOUNTS = new Set(['/api/v1']);
const INTENTIONAL_EXTERNAL_DOCS = new Set([
  '/api/v1/public',
]);

function normalizeMount(prefix) {
  return String(prefix || '').replace(/\/+$/, '') || '/';
}

function toPrefix(pathname) {
  const normalized = normalizeMount(pathname.replace(/:[A-Za-z0-9_]+/g, '{param}'));
  if (ROOT_MOUNTS.has(normalized)) return null;
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length <= 2) return null;
  if (segments[2] === 'admin' && segments[3]) return `/api/v1/admin/${segments[3]}`;
  if (segments[2] === 'management-company' && segments[3]) return `/api/v1/management-company/${segments[3]}`;
  return `/api/v1/${segments[2]}`;
}

function extractMountedPrefixes(source) {
  const prefixes = new Set();
  const regex = /app\.(?:use|get|post|put|patch|delete)\(\s*['"`](\/api\/v1(?:\/[^'"`]*)?)['"`]/g;
  let match;
  while ((match = regex.exec(source)) !== null) {
    const prefix = toPrefix(match[1]);
    if (prefix && !INTENTIONAL_EXTERNAL_DOCS.has(prefix)) prefixes.add(prefix);
  }
  return [...prefixes].sort();
}

function hasOpenApiPrefix(paths, prefix) {
  return Object.keys(paths).some((pathname) => {
    const normalized = normalizeMount(pathname);
    return normalized === prefix || normalized.startsWith(`${prefix}/`);
  });
}

function run({ routesSource, openApi } = {}) {
  const source = routesSource ?? fs.readFileSync(routesPath, 'utf8');
  const spec = openApi ?? JSON.parse(fs.readFileSync(openApiPath, 'utf8'));
  const mountedPrefixes = extractMountedPrefixes(source);
  const missing = mountedPrefixes.filter((prefix) => !hasOpenApiPrefix(spec.paths || {}, prefix));
  return { ok: missing.length === 0, mountedPrefixes, missing };
}

if (require.main === module) {
  const result = run();
  if (!result.ok) {
    console.error('[openapi-v1-drift] missing OpenAPI anchors for mounted prefixes:');
    for (const prefix of result.missing) console.error(`- ${prefix}`);
    process.exit(1);
  }
  console.log(`[openapi-v1-drift] ok (${result.mountedPrefixes.length} mounted prefixes covered)`);
}

module.exports = { extractMountedPrefixes, run };
