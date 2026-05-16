#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { run: runOpenApiDrift } = require('./openapi-v1-drift-gate.cjs');

const repoRoot = path.resolve(__dirname, '..');
const frontendSrcDir = path.join(repoRoot, 'frontend', 'src');

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'];
const API_MODULE_IGNORE = new Set([
  'client.ts',
  'errors.ts',
  'index.ts',
  'types.ts',
]);

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

const INTENTIONALLY_NO_FRONTEND_OPERATIONS = new Set([
  // External provider webhook. It requires x-skud-secret / x-integration-secret
  // headers and is not a browser product surface.
  'post /api/v1/skud/providers/{param}/events',
]);

function lineAt(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

function skipTemplateInterpolation(source, start) {
  let index = start + 2;
  let depth = 1;
  let quote = null;

  while (index < source.length && depth > 0) {
    const char = source[index];
    const prev = source[index - 1];

    if (quote) {
      if (char === quote && prev !== '\\') quote = null;
      index += 1;
      continue;
    }

    if (char === '\'' || char === '"' || char === '`') {
      quote = char;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
    }

    index += 1;
  }

  return index;
}

function readQuotedArgument(source, openParen) {
  let index = openParen + 1;
  while (index < source.length && /\s/.test(source[index])) index += 1;

  const quote = source[index];
  if (quote !== '\'' && quote !== '"' && quote !== '`') return null;

  index += 1;
  let raw = '';
  let escaped = false;

  while (index < source.length) {
    const char = source[index];
    if (escaped) {
      raw += char;
      escaped = false;
      index += 1;
      continue;
    }
    if (char === '\\') {
      raw += char;
      escaped = true;
      index += 1;
      continue;
    }
    if (char === quote) return { raw };
    raw += char;
    index += 1;
  }

  return null;
}

function normalizeTemplatePath(raw) {
  let out = '';
  let index = 0;

  while (index < raw.length) {
    if (raw[index] === '$' && raw[index + 1] === '{') {
      const isPathSegment = out.endsWith('/');
      index = skipTemplateInterpolation(raw, index);
      if (isPathSegment) out += '{param}';
      continue;
    }

    out += raw[index];
    index += 1;
  }

  return out.replace(/\s+/g, '').replace(/\?.*$/, '');
}

function extractV1ClientCalls(filePath, frontendRoot) {
  const source = fs.readFileSync(filePath, 'utf8');
  const calls = [];
  const methodPattern = HTTP_METHODS.join('|');
  const regex = new RegExp(`v1Client\\.(${methodPattern})\\b`, 'g');
  let match;

  while ((match = regex.exec(source)) !== null) {
    const method = match[1];
    let index = regex.lastIndex;
    while (index < source.length && source[index] !== '(') index += 1;
    if (source[index] !== '(') continue;

    const argument = readQuotedArgument(source, index);
    if (!argument) continue;

    const normalizedPath = normalizeTemplatePath(argument.raw);
    if (!normalizedPath.startsWith('/')) continue;

    calls.push({
      file: path.relative(frontendRoot, filePath).replace(/\\/g, '/'),
      line: lineAt(source, match.index),
      method,
      path: normalizedPath,
    });
  }

  return calls;
}

function listFilesRecursive(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFilesRecursive(fullPath);
    if (!entry.isFile()) return [];
    if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.(ts|tsx)$/.test(entry.name)) return [];
    return [fullPath];
  });
}

function walkSourceFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkSourceFiles(fullPath);
    return /\.(ts|tsx|js|jsx)$/.test(fullPath) ? [fullPath] : [];
  });
}

function extractDirectApiV1Urls(filePath, frontendRoot) {
  const source = fs.readFileSync(filePath, 'utf8');
  const calls = [];
  const regex = /apiV1Url\s*\(/g;
  let match;

  while ((match = regex.exec(source)) !== null) {
    const argument = readQuotedArgument(source, match.index + match[0].length - 1);
    if (!argument) continue;

    const normalizedPath = normalizeTemplatePath(argument.raw);
    if (!normalizedPath.startsWith('/')) continue;

    calls.push({
      file: path.relative(frontendRoot, filePath).replace(/\\/g, '/'),
      line: lineAt(source, match.index),
      method: 'get',
      path: normalizedPath,
    });
  }

  return calls;
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
  const files = walkSourceFiles(frontendSrcDir).filter((file) => {
    const normalized = file.replace(/\\/g, '/');
    return !normalized.includes('/api/generated/')
      && !/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(normalized);
  });
  const operations = [];

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');

    for (const call of extractV1ClientCalls(file, path.join(repoRoot, 'frontend'))) {
      operations.push({
        method: call.method,
        path: normalizeRoutePath(`/api/v1${call.path}`),
        file: `frontend/${call.file}`,
      });
    }

    for (const call of extractDirectApiV1Urls(file, path.join(repoRoot, 'frontend'))) {
      operations.push({
        method: call.method,
        path: normalizeRoutePath(`/api/v1${call.path}`),
        file: `frontend/${call.file}`,
      });
    }

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

function apiPathMatches(openApiPath, clientPath) {
  const openSegments = openApiPath.split('/').filter(Boolean);
  const clientSegments = clientPath.split('/').filter(Boolean);
  if (openSegments.length !== clientSegments.length) return false;

  return openSegments.every((segment, index) => {
    const clientSegment = clientSegments[index];
    return /^\{[^}]+\}$/.test(segment)
      || /^\{[^}]+\}$/.test(clientSegment)
      || segment === clientSegment;
  });
}

function findOpenApiOperation(openApi, call) {
  const fullPath = `/api/v1${call.path}`;
  const exactOperation = openApi.paths[fullPath]?.[call.method];
  if (exactOperation) return { path: fullPath, operation: exactOperation };

  for (const [openApiPath, pathItem] of Object.entries(openApi.paths)) {
    if (!openApiPath.startsWith('/api/v1/')) continue;
    const operation = pathItem[call.method];
    if (operation && apiPathMatches(openApiPath, fullPath)) {
      return { path: openApiPath, operation };
    }
  }

  return null;
}

function resolveSchema(openApi, schema, seen = new Set()) {
  if (!schema || typeof schema !== 'object') return schema;
  const ref = schema.$ref;
  if (!ref) return schema;
  if (seen.has(ref)) return schema;
  seen.add(ref);

  const parts = ref.replace(/^#\//, '').split('/');
  let current = openApi;
  for (const part of parts) current = current?.[part];
  return resolveSchema(openApi, current, seen) || schema;
}

function jsonSchemaFromMedia(payload) {
  if (!payload || typeof payload !== 'object') return null;
  return payload.content?.['application/json']?.schema ?? null;
}

function isGenericObjectSchema(openApi, schema) {
  const resolved = resolveSchema(openApi, schema);

  if (!resolved || typeof resolved !== 'object') return false;
  if (resolved.oneOf || resolved.anyOf || resolved.allOf) return false;
  if (resolved.type === 'array') return isGenericObjectSchema(openApi, resolved.items);

  return resolved.type === 'object'
    && !resolved.properties
    && resolved.additionalProperties === undefined;
}

function collectCoverage({
  repoRoot = path.resolve(__dirname, '..'),
  minV1ClientCalls = 160,
  minDirectUrlCalls = 3,
} = {}) {
  const frontendRoot = path.join(repoRoot, 'frontend');
  const v1ApiDir = path.join(frontendRoot, 'src', 'v1', 'api');
  const directUrlDirs = [
    path.join(frontendRoot, 'src', 'v1', 'pages'),
    path.join(frontendRoot, 'src', 'views', 'public'),
  ];
  const openApi = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'docs', 'openapi.json'), 'utf8'),
  );

  const v1ClientCalls = fs.readdirSync(v1ApiDir)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts') && !API_MODULE_IGNORE.has(file))
    .flatMap((file) => extractV1ClientCalls(path.join(v1ApiDir, file), frontendRoot));

  const directUrlCalls = directUrlDirs
    .flatMap(listFilesRecursive)
    .flatMap((file) => extractDirectApiV1Urls(file, frontendRoot));

  const contractCalls = [...v1ClientCalls, ...directUrlCalls];

  const missingOperations = contractCalls
    .filter((call) => !findOpenApiOperation(openApi, call))
    .map((call) => `${call.file}:${call.line} ${call.method.toUpperCase()} /api/v1${call.path}`);

  const genericResponses = contractCalls.flatMap((call) => {
    const match = findOpenApiOperation(openApi, call);
    if (!match) return [];

    return Object.entries(match.operation.responses ?? {})
      .filter(([status]) => status.startsWith('2'))
      .filter(([, response]) => isGenericObjectSchema(openApi, jsonSchemaFromMedia(response)))
      .map(([status]) => (
        `${call.file}:${call.line} ${call.method.toUpperCase()} ${match.path} ${status}`
      ));
  });

  const thresholdFailures = [];
  if (v1ClientCalls.length < minV1ClientCalls) {
    thresholdFailures.push(`expected at least ${minV1ClientCalls} v1Client calls, found ${v1ClientCalls.length}`);
  }
  if (directUrlCalls.length < minDirectUrlCalls) {
    thresholdFailures.push(`expected at least ${minDirectUrlCalls} direct apiV1Url calls, found ${directUrlCalls.length}`);
  }

  return {
    ok: missingOperations.length === 0
      && genericResponses.length === 0
      && thresholdFailures.length === 0,
    counts: {
      v1ClientCalls: v1ClientCalls.length,
      directUrlCalls: directUrlCalls.length,
      contractCalls: contractCalls.length,
    },
    missingOperations,
    genericResponses,
    thresholdFailures,
  };
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

function isIntentionallyNoFrontendOperation(operation) {
  const prefix = prefixFor(operation.path);
  return INTENTIONALLY_NO_FRONTEND_CLIENT.has(prefix)
    || LEGACY_UTILITY_PREFIXES.has(prefix)
    || INTENTIONALLY_NO_FRONTEND_OPERATIONS.has(operationKey(operation));
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
  const ignored = uncovered.filter(isIntentionallyNoFrontendOperation);
  const productGaps = uncovered.filter((operation) => !isIntentionallyNoFrontendOperation(operation));

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
  console.log('# Frontend v1 Contract Coverage Audit\n');
  console.log(`Generated: ${result.generatedAt}\n`);
  console.log('| Metric | Count |');
  console.log('|---|---:|');
  for (const [key, value] of Object.entries(result.totals)) {
    console.log(`| ${key} | ${value} |`);
  }
  console.log('\n## Product Gaps\n');
  for (const bucket of result.productGapBuckets) {
    console.log(`### ${bucket.prefix} (${bucket.operations.length})`);
    for (const operation of bucket.operations) {
      console.log(`- ${operation.method.toUpperCase()} ${operation.path}`);
    }
    console.log('');
  }
  console.log('## Ignored / Non Product-UI Surfaces\n');
  for (const bucket of result.ignoredBuckets) {
    console.log(`### ${bucket.prefix} (${bucket.operations.length})`);
    for (const operation of bucket.operations) {
      console.log(`- ${operation.method.toUpperCase()} ${operation.path}`);
    }
    console.log('');
  }
}

function formatFailures(result) {
  const lines = [];
  if (result.thresholdFailures.length) {
    lines.push('[frontend-v1-contract-coverage] coverage thresholds failed:');
    lines.push(...result.thresholdFailures.map((failure) => `- ${failure}`));
  }
  if (result.missingOperations.length) {
    lines.push('[frontend-v1-contract-coverage] missing OpenAPI operations:');
    lines.push(...result.missingOperations.map((failure) => `- ${failure}`));
  }
  if (result.genericResponses.length) {
    lines.push('[frontend-v1-contract-coverage] generic object response schemas used by frontend:');
    lines.push(...result.genericResponses.map((failure) => `- ${failure}`));
  }
  return lines.join('\n');
}

function assertCoverage(options) {
  const result = collectCoverage(options);
  if (!result.ok) {
    throw new Error(formatFailures(result));
  }
  return result;
}

if (require.main === module) {
  if (process.argv.includes('--gate')) {
    try {
      const result = assertCoverage();
      console.log(
        `[frontend-v1-contract-coverage] ok (${result.counts.contractCalls} calls, `
        + `${result.counts.v1ClientCalls} v1Client, ${result.counts.directUrlCalls} direct URLs)`,
      );
    } catch (error) {
      console.error(error.message || error);
      process.exit(1);
    }
  } else {
    const result = audit();
    if (process.argv.includes('--json')) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printMarkdown(result);
    }
  }
}

module.exports = {
  audit,
  assertCoverage,
  collectCoverage,
  extractFrontendOperations,
  formatFailures,
};
