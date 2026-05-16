import fs from 'node:fs';
import path from 'node:path';

type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

interface OpenApiOperation {
  requestBody?: unknown;
  responses?: Record<string, unknown>;
}

interface OpenApiSpec {
  paths: Record<string, Partial<Record<HttpMethod, OpenApiOperation>>>;
  components?: {
    schemas?: Record<string, unknown>;
  };
}

interface ClientCall {
  file: string;
  line: number;
  method: HttpMethod;
  path: string;
}

const FRONTEND_ROOT = process.cwd();
const REPO_ROOT = path.resolve(FRONTEND_ROOT, '..');
const V1_API_DIR = path.join(FRONTEND_ROOT, 'src', 'v1', 'api');
const DIRECT_URL_DIRS = [
  path.join(FRONTEND_ROOT, 'src', 'v1', 'pages'),
  path.join(FRONTEND_ROOT, 'src', 'views', 'public'),
];

const OPENAPI = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'docs', 'openapi.json'), 'utf8'),
) as OpenApiSpec;

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
const API_MODULE_IGNORE = new Set([
  'client.ts',
  'errors.ts',
  'index.ts',
  'types.ts',
]);

function lineAt(source: string, index: number): number {
  return source.slice(0, index).split(/\r?\n/).length;
}

function skipTemplateInterpolation(source: string, start: number): number {
  let index = start + 2;
  let depth = 1;
  let quote: string | null = null;

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

function readQuotedArgument(source: string, openParen: number): { raw: string; start: number } | null {
  let index = openParen + 1;
  while (index < source.length && /\s/.test(source[index])) index += 1;

  const quote = source[index];
  if (quote !== '\'' && quote !== '"' && quote !== '`') return null;

  const start = index;
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
    if (char === quote) return { raw, start };
    raw += char;
    index += 1;
  }

  return null;
}

function normalizeTemplatePath(raw: string): string {
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

function extractV1ClientCalls(filePath: string): ClientCall[] {
  const source = fs.readFileSync(filePath, 'utf8');
  const calls: ClientCall[] = [];
  const methodPattern = HTTP_METHODS.join('|');
  const regex = new RegExp(`v1Client\\.(${methodPattern})\\b`, 'g');
  let match: RegExpExecArray | null;

  while ((match = regex.exec(source)) !== null) {
    const method = match[1] as HttpMethod;
    let index = regex.lastIndex;
    while (index < source.length && source[index] !== '(') index += 1;
    if (source[index] !== '(') continue;

    const argument = readQuotedArgument(source, index);
    if (!argument) continue;

    const normalizedPath = normalizeTemplatePath(argument.raw);
    if (!normalizedPath.startsWith('/')) continue;

    calls.push({
      file: path.relative(FRONTEND_ROOT, filePath),
      line: lineAt(source, match.index),
      method,
      path: normalizedPath,
    });
  }

  return calls;
}

function listFilesRecursive(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFilesRecursive(fullPath);
    if (!entry.isFile()) return [];
    if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.(ts|tsx)$/.test(entry.name)) return [];
    return [fullPath];
  });
}

function extractDirectApiV1Urls(filePath: string): ClientCall[] {
  const source = fs.readFileSync(filePath, 'utf8');
  const calls: ClientCall[] = [];
  const regex = /apiV1Url\s*\(/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(source)) !== null) {
    const argument = readQuotedArgument(source, match.index + match[0].length - 1);
    if (!argument) continue;

    const normalizedPath = normalizeTemplatePath(argument.raw);
    if (!normalizedPath.startsWith('/')) continue;

    calls.push({
      file: path.relative(FRONTEND_ROOT, filePath),
      line: lineAt(source, match.index),
      method: 'get',
      path: normalizedPath,
    });
  }

  return calls;
}

function apiPathMatches(openApiPath: string, clientPath: string): boolean {
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

function findOpenApiOperation(call: ClientCall): { path: string; operation: OpenApiOperation } | null {
  const fullPath = `/api/v1${call.path}`;
  const exactOperation = OPENAPI.paths[fullPath]?.[call.method];
  if (exactOperation) return { path: fullPath, operation: exactOperation };

  for (const [openApiPath, pathItem] of Object.entries(OPENAPI.paths)) {
    if (!openApiPath.startsWith('/api/v1/')) continue;
    const operation = pathItem[call.method];
    if (operation && apiPathMatches(openApiPath, fullPath)) {
      return { path: openApiPath, operation };
    }
  }

  return null;
}

function resolveSchema(schema: unknown, seen = new Set<string>()): unknown {
  if (!schema || typeof schema !== 'object') return schema;
  const ref = (schema as { $ref?: string }).$ref;
  if (!ref) return schema;
  if (seen.has(ref)) return schema;
  seen.add(ref);

  const parts = ref.replace(/^#\//, '').split('/');
  let current: unknown = OPENAPI;
  for (const part of parts) {
    current = (current as Record<string, unknown> | undefined)?.[part];
  }
  return resolveSchema(current, seen);
}

function jsonSchemaFromMedia(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return null;
  const content = (payload as { content?: Record<string, { schema?: unknown }> }).content;
  return content?.['application/json']?.schema ?? null;
}

function isGenericObjectSchema(schema: unknown): boolean {
  const resolved = resolveSchema(schema) as {
    type?: string;
    items?: unknown;
    properties?: Record<string, unknown>;
    additionalProperties?: unknown;
    oneOf?: unknown;
    anyOf?: unknown;
    allOf?: unknown;
  } | null;

  if (!resolved || typeof resolved !== 'object') return false;
  if (resolved.oneOf || resolved.anyOf || resolved.allOf) return false;
  if (resolved.type === 'array') return isGenericObjectSchema(resolved.items);

  return resolved.type === 'object'
    && !resolved.properties
    && resolved.additionalProperties === undefined;
}

const v1ClientCalls = fs.readdirSync(V1_API_DIR)
  .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts') && !API_MODULE_IGNORE.has(file))
  .flatMap((file) => extractV1ClientCalls(path.join(V1_API_DIR, file)));

const directUrlCalls = DIRECT_URL_DIRS
  .flatMap(listFilesRecursive)
  .flatMap(extractDirectApiV1Urls);

const contractCalls = [...v1ClientCalls, ...directUrlCalls];

describe('frontend v1 API contract coverage', () => {
  test('keeps every frontend v1 call mapped to an OpenAPI operation', () => {
    expect(v1ClientCalls.length).toBeGreaterThanOrEqual(160);
    expect(directUrlCalls.length).toBeGreaterThanOrEqual(3);

    const missing = contractCalls
      .filter((call) => !findOpenApiOperation(call))
      .map((call) => `${call.file}:${call.line} ${call.method.toUpperCase()} /api/v1${call.path}`);

    expect(missing).toEqual([]);
  });

  test('does not use generic object response schemas for frontend v1 calls', () => {
    const genericResponses = contractCalls.flatMap((call) => {
      const match = findOpenApiOperation(call);
      if (!match) return [];

      return Object.entries(match.operation.responses ?? {})
        .filter(([status]) => status.startsWith('2'))
        .filter(([, response]) => isGenericObjectSchema(jsonSchemaFromMedia(response)))
        .map(([status]) => (
          `${call.file}:${call.line} ${call.method.toUpperCase()} ${match.path} ${status}`
        ));
    });

    expect(genericResponses).toEqual([]);
  });
});
