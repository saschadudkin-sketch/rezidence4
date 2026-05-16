#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { run: runOpenApiDrift } = require('./openapi-v1-drift-gate.cjs');

const repoRoot = path.resolve(__dirname, '..');
const frontendSrcDir = path.join(repoRoot, 'frontend', 'src');

const INTENTIONALLY_NO_FRONTEND_CLIENT = new Set([
  '/api/v1/events',
  '/api/v1/events/health',
  '/api/v1/client-logs',
  '/api/v1/upload',
  '/api/v1/public',
  '/api/v1/push-subscriptions',
  '/api/v1/telegram',
  '/api/v1/auth',
]);

const LEGACY_UTILITY_PREFIXES = new Set([
  '/api/v1/billing',
  '/api/v1/blacklist',
  '/api/v1/bookings',
  '/api/v1/chat',
  '/api/v1/contracts',
  '/api/v1/integrations',
  '/api/v1/meter-readings',
  '/api/v1/perms',
  '/api/v1/spaces',
  '/api/v1/templates',
  '/api/v1/users',
  '/api/v1/visit-logs',
]);

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    return /\.(ts|tsx|js|jsx)$/.test(fullPath) ? [fullPath] : [];
  });
}

function normalizeRoutePath(routePath) {
  return String(routePath || '')
    .replace(/\/+$/, '')
    .replace(/\{[^}]+\}/g, '{param}') || '/';
}

function normalizeFrontendTemplate(template) {
  return template
    .replace(/\$\{toQuery\([^`]*?\)\}/g, '')
    .replace(/\$\{qs\}/g, '')
    .replace(/\$\{query\}/g, '')
    .replace(/\$\{[^}]+\}/g, '{param}')
    .replace(/\?.*$/, '')
    .replace(/\/+$/, '') || '/';
}

function extractFrontendOperations() {
  const files = walk(frontendSrcDir).filter((file) => {
    const normalized = file.replace(/\\/g, '/');
    return !normalized.includes('/api/generated/')
      && !/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(normalized);
  });
  const operations = [];

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');

    const v1ClientRegex = /v1Client\.(get|post|put|patch|delete)\s*<[^>]*>\s*\(\s*([`'"])([\s\S]*?)\2/g;
    let match;
    while ((match = v1ClientRegex.exec(source)) !== null) {
      operations.push({
        method: match[1].toLowerCase(),
        path: normalizeRoutePath(`/api/v1${normalizeFrontendTemplate(match[3])}`),
        file: path.relative(repoRoot, file).replace(/\\/g, '/'),
      });
    }

    const absoluteClientRegex = /\b(?:apiClient|client)\.(get|post|put|patch|delete)\s*(?:<[^>]*>)?\s*\(\s*([`'"])(\/api\/v1[\s\S]*?)\2/g;
    while ((match = absoluteClientRegex.exec(source)) !== null) {
      operations.push({
        method: match[1].toLowerCase(),
        path: normalizeRoutePath(normalizeFrontendTemplate(match[3])),
        file: path.relative(repoRoot, file).replace(/\\/g, '/'),
      });
    }

    const fetchRegex = /\bfetch\(\s*([`'"])(?:[^`'"]*?)(\/api\/v1\/[^`'"]*?)\1([\s\S]{0,300}?)(?:\);|\),)/g;
    while ((match = fetchRegex.exec(source)) !== null) {
      const methodMatch = match[3].match(/method:\s*['"`](GET|POST|PUT|PATCH|DELETE)['"`]/i);
      operations.push({
        method: methodMatch ? methodMatch[1].toLowerCase() : 'get',
        path: normalizeRoutePath(normalizeFrontendTemplate(match[2])),
        file: path.relative(repoRoot, file).replace(/\\/g, '/'),
      });
    }
  }

  const seen = new Map();
  for (const operation of operations) {
    const key = `${operation.method} ${operation.path}`;
    if (!seen.has(key)) seen.set(key, operation);
  }
  return [...seen.values()].sort((a, b) => `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`));
}

function prefixFor(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[2] === 'admin' && parts[3]) return `/api/v1/admin/${parts[3]}`;
  if (parts[2] === 'management-company' && parts[3]) return `/api/v1/management-company/${parts[3]}`;
  if (parts[2] === 'public') return '/api/v1/public';
  if (parts[2] === 'notifications') return '/api/v1/notifications';
  return `/api/v1/${parts[2] || ''}`;
}

function operationKey(operation) {
  return `${operation.method} ${normalizeRoutePath(operation.path)}`;
}

function bucketOperations(operations) {
  const buckets = new Map();
  for (const operation of operations) {
    const prefix = prefixFor(operation.path);
    if (!buckets.has(prefix)) buckets.set(prefix, []);
    buckets.get(prefix).push(operation);
  }
  return [...buckets.entries()]
    .map(([prefix, items]) => ({ prefix, operations: items }))
    .sort((a, b) => b.operations.length - a.operations.length || a.prefix.localeCompare(b.prefix));
}

function audit() {
  const backendOperations = runOpenApiDrift().mountedOperations.map((operation) => ({
    method: operation.method,
    path: normalizeRoutePath(operation.path),
  }));
  const frontendOperations = extractFrontendOperations();
  const frontendKeys = new Set(frontendOperations.map(operationKey));
  const uncovered = backendOperations.filter((operation) => !frontendKeys.has(operationKey(operation)));
  const ignored = uncovered.filter((operation) => {
    const prefix = prefixFor(operation.path);
    return INTENTIONALLY_NO_FRONTEND_CLIENT.has(prefix) || LEGACY_UTILITY_PREFIXES.has(prefix);
  });
  const productGaps = uncovered.filter((operation) => {
    const prefix = prefixFor(operation.path);
    return !INTENTIONALLY_NO_FRONTEND_CLIENT.has(prefix) && !LEGACY_UTILITY_PREFIXES.has(prefix);
  });

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      backendOperations: backendOperations.length,
      frontendClientOperations: frontendOperations.length,
      uncoveredOperations: uncovered.length,
      productGapOperations: productGaps.length,
      intentionallyNoFrontendClientOperations: ignored.length,
    },
    productGapBuckets: bucketOperations(productGaps),
    ignoredBuckets: bucketOperations(ignored),
    frontendOperations,
  };
}

function printMarkdown(result) {
  console.log(`# Frontend v1 Contract Coverage Audit\n`);
  console.log(`Generated: ${result.generatedAt}\n`);
  console.log(`| Metric | Count |`);
  console.log(`|---|---:|`);
  for (const [key, value] of Object.entries(result.totals)) {
    console.log(`| ${key} | ${value} |`);
  }
  console.log(`\n## Product Gaps\n`);
  for (const bucket of result.productGapBuckets) {
    console.log(`### ${bucket.prefix} (${bucket.operations.length})`);
    for (const operation of bucket.operations) {
      console.log(`- ${operation.method.toUpperCase()} ${operation.path}`);
    }
    console.log('');
  }
  console.log(`## Ignored / Non Product-UI Surfaces\n`);
  for (const bucket of result.ignoredBuckets) {
    console.log(`### ${bucket.prefix} (${bucket.operations.length})`);
    for (const operation of bucket.operations) {
      console.log(`- ${operation.method.toUpperCase()} ${operation.path}`);
    }
    console.log('');
  }
}

if (require.main === module) {
  const result = audit();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printMarkdown(result);
  }
}

module.exports = { audit, extractFrontendOperations };
