const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const defaultFrontendOrigins = ['http://127.0.0.1:3000', 'http://localhost:3000'];

function addOrigin(frontendOrigins, rawUrl) {
  if (!rawUrl) return;
  try {
    frontendOrigins.add(new URL(rawUrl).origin);
  } catch {
    // Ignore non-URL values; explicit FRONTEND_URL remains the escape hatch.
  }
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};

  const result = {};
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq <= 0) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function buildE2EEnv(baseEnv = process.env) {
  const rootEnv = parseEnvFile(path.join(repoRoot, '.env'));
  const backendEnv = parseEnvFile(path.join(repoRoot, 'backend', '.env'));
  const env = { ...backendEnv, ...rootEnv, ...baseEnv };

  const dbPassword = env.DB_PASSWORD;
  const hasExplicitDatabaseUrl = Boolean(baseEnv.DATABASE_URL);

  if (!hasExplicitDatabaseUrl && dbPassword) {
    env.DATABASE_URL = `postgresql://residenze:${dbPassword}@localhost:5432/residenze`;
  }
  if (!baseEnv.PLATFORM_DB_URL && dbPassword) {
    env.PLATFORM_DB_URL = `postgresql://residenze:${dbPassword}@localhost:5432/platform`;
  }
  if (!baseEnv.ZAMOSKV_DB_URL && dbPassword) {
    env.ZAMOSKV_DB_URL = `postgresql://residenze:${dbPassword}@localhost:5432/zamoskv`;
  }
  if (!baseEnv.REDIS_URL && env.REDIS_PASSWORD) {
    env.REDIS_URL = `redis://:${env.REDIS_PASSWORD}@localhost:6379`;
  }

  env.PORT = env.E2E_BACKEND_PORT || env.PORT || '3001';
  const frontendOrigins = new Set(
    String(env.FRONTEND_URL || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  for (const origin of defaultFrontendOrigins) frontendOrigins.add(origin);
  if (env.E2E_FRONTEND_PORT) {
    frontendOrigins.add(`http://127.0.0.1:${env.E2E_FRONTEND_PORT}`);
    frontendOrigins.add(`http://localhost:${env.E2E_FRONTEND_PORT}`);
  }
  addOrigin(frontendOrigins, env.PLAYWRIGHT_BASE_URL);
  addOrigin(frontendOrigins, env.PLAYWRIGHT_WEBSERVER_URL);
  env.FRONTEND_URL = Array.from(frontendOrigins).join(',');
  env.BACKEND_URL = env.BACKEND_URL || `http://127.0.0.1:${env.PORT}`;
  env.E2E_DISABLE_RATE_LIMITS = env.E2E_DISABLE_RATE_LIMITS || '1';

  return env;
}

function loadEnvFilesDefault() {
  let dotenv;
  try {
    dotenv = require(path.join(repoRoot, 'backend', 'node_modules', 'dotenv'));
  } catch {
    return;
  }

  for (const envPath of [
    path.join(repoRoot, '.env'),
    path.join(repoRoot, 'backend', '.env'),
  ]) {
    dotenv.config({ path: envPath, override: false, quiet: true });
  }
}

module.exports = {
  buildE2EEnv,
  loadEnvFilesDefault,
  parseEnvFile,
  repoRoot,
};
