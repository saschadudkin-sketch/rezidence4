#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const openApiPath = path.join(repoRoot, 'docs', 'openapi.json');
const routesPath = path.join(repoRoot, 'backend', 'src', 'app', 'registerApiRoutes.js');
const observabilityRoutesPath = path.join(repoRoot, 'backend', 'src', 'app', 'registerObservabilityRoutes.js');

const ROOT_MOUNTS = new Set(['/api/v1']);
const INTENTIONAL_EXTERNAL_DOCS = new Set();
const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'];

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

function extractDirectMountedOperations(source) {
  const operations = [];
  const regex = /app\.(get|post|put|patch|delete)\(\s*['"`](\/api\/v1(?:\/[^'"`]*)?)['"`]/g;
  let match;
  while ((match = regex.exec(source)) !== null) {
    operations.push({
      method: match[1].toLowerCase(),
      path: normalizeMount(match[2].replace(/:[A-Za-z0-9_]+/g, '{param}')),
    });
  }
  return operations
    .sort((a, b) => `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`));
}

function resolveRequiredFile(baseDir, requirePath) {
  const resolved = path.resolve(baseDir, requirePath);
  return path.extname(resolved) ? resolved : `${resolved}.js`;
}

function extractRouterVariableMap(source, baseDir = path.dirname(routesPath)) {
  const routerVariables = new Map();
  const requireRegex = /const\s+(\w+)\s*=\s*require\(['"`]([^'"`]+)['"`]\)/g;
  let match;
  while ((match = requireRegex.exec(source)) !== null) {
    routerVariables.set(match[1], {
      file: resolveRequiredFile(baseDir, match[2]),
      routerName: 'router',
    });
  }

  const subRouterRegex = /const\s+(\w+)\s*=\s*(\w+)\.(\w+)\s*;/g;
  while ((match = subRouterRegex.exec(source)) !== null) {
    const parent = routerVariables.get(match[2]);
    if (!parent) continue;
    routerVariables.set(match[1], {
      file: parent.file,
      routerName: match[3],
    });
  }

  return routerVariables;
}

function escapeRegex(input) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractRouterOperations(routerSource, routerName = 'router') {
  const operations = [];
  const methodPattern = HTTP_METHODS.join('|');
  const regex = new RegExp(
    `${escapeRegex(routerName)}\\.(${methodPattern})\\(\\s*['"\`]([^'"\`]+)['"\`]`,
    'g',
  );
  let match;
  while ((match = regex.exec(routerSource)) !== null) {
    operations.push({
      method: match[1].toLowerCase(),
      path: normalizeMount(match[2].replace(/:([A-Za-z0-9_]+)/g, '{$1}')),
    });
  }
  return operations;
}

function joinMountAndRoute(mount, routePath) {
  const normalizedMount = normalizeMount(mount.replace(/:([A-Za-z0-9_]+)/g, '{$1}'));
  const normalizedRoute = normalizeMount(routePath);
  if (normalizedRoute === '/') return normalizedMount;
  return normalizeMount(`${normalizedMount}/${normalizedRoute.replace(/^\/+/, '')}`);
}

function extractMountedRouterOperations(source, {
  baseDir = path.dirname(routesPath),
  readFile = fs.readFileSync,
} = {}) {
  const routerVariables = extractRouterVariableMap(source, baseDir);
  const routerSourceCache = new Map();
  const operations = [];
  const appUseRegex = /app\.use\(\s*['"`](\/api\/v1(?:\/[^'"`]*)?)['"`]([\s\S]*?)\);/g;
  let match;

  while ((match = appUseRegex.exec(source)) !== null) {
    const mount = match[1];
    const mountedIdentifiers = [...match[2].matchAll(/\b([A-Za-z_]\w*)\b/g)]
      .map((entry) => entry[1])
      .filter((identifier) => routerVariables.has(identifier));
    const routerVariable = mountedIdentifiers[mountedIdentifiers.length - 1];
    if (!routerVariable) continue;

    const routerInfo = routerVariables.get(routerVariable);
    let routerSource = routerSourceCache.get(routerInfo.file);
    if (routerSource === undefined) {
      try {
        routerSource = readFile(routerInfo.file, 'utf8');
      } catch {
        routerSource = '';
      }
      routerSourceCache.set(routerInfo.file, routerSource);
    }

    for (const operation of extractRouterOperations(routerSource, routerInfo.routerName)) {
      operations.push({
        method: operation.method,
        path: joinMountAndRoute(mount, operation.path),
      });
    }
  }

  return operations
    .sort((a, b) => `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`));
}

function extractMountedOperations(source, options = {}) {
  const operations = [
    ...extractDirectMountedOperations(source),
    ...extractMountedRouterOperations(source, options),
  ];
  const seen = new Set();
  return operations
    .filter((operation) => {
      const key = `${operation.method} ${operation.path}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`));
}

function hasOpenApiPrefix(paths, prefix) {
  return Object.keys(paths).some((pathname) => {
    const normalized = normalizeMount(pathname);
    return normalized === prefix || normalized.startsWith(`${prefix}/`);
  });
}

function hasOpenApiOperation(paths, operation) {
  const pathItem = paths[operation.path];
  return Boolean(pathItem && pathItem[operation.method]);
}

function run({ routesSource, openApi } = {}) {
  const source = routesSource ?? [
    fs.readFileSync(routesPath, 'utf8'),
    fs.readFileSync(observabilityRoutesPath, 'utf8'),
  ].join('\n');
  const spec = openApi ?? JSON.parse(fs.readFileSync(openApiPath, 'utf8'));
  const mountedPrefixes = extractMountedPrefixes(source);
  const missing = mountedPrefixes.filter((prefix) => !hasOpenApiPrefix(spec.paths || {}, prefix));
  const mountedOperations = extractMountedOperations(source);
  const missingOperations = mountedOperations.filter((operation) => !hasOpenApiOperation(spec.paths || {}, operation));
  return {
    ok: missing.length === 0 && missingOperations.length === 0,
    mountedPrefixes,
    mountedOperations,
    missing,
    missingOperations,
  };
}

if (require.main === module) {
  const result = run();
  if (!result.ok) {
    console.error('[openapi-v1-drift] missing OpenAPI anchors for mounted prefixes:');
    for (const prefix of result.missing) console.error(`- ${prefix}`);
    if (result.missingOperations.length) {
      console.error('[openapi-v1-drift] missing OpenAPI operations for mounted routes:');
      for (const operation of result.missingOperations) {
        console.error(`- ${operation.method.toUpperCase()} ${operation.path}`);
      }
    }
    process.exit(1);
  }
  console.log(`[openapi-v1-drift] ok (${result.mountedPrefixes.length} mounted prefixes covered)`);
}

module.exports = { extractMountedPrefixes, extractMountedOperations, run };
