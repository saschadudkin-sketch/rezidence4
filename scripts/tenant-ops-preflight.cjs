#!/usr/bin/env node
const path = require('node:path');
const { buildE2EEnv, loadEnvFilesDefault, repoRoot } = require('./e2e-env.cjs');

function parseArgs(argv) {
  return {
    e2eAccess: argv.includes('--e2e-access'),
    json: argv.includes('--json'),
    requireCurrentMigrations: argv.includes('--require-current-migrations')
      || process.env.TENANT_OPS_PREFLIGHT_REQUIRE_CURRENT_MIGRATIONS === '1',
    skipDb: argv.includes('--skip-db') || process.env.TENANT_OPS_PREFLIGHT_SKIP_DB === '1',
  };
}

function redactConnectionString(value) {
  if (!value) return '<missing>';
  try {
    const url = new URL(value);
    if (url.username) url.username = '***';
    if (url.password) url.password = '***';
    return url.toString();
  } catch {
    return '<invalid-url>';
  }
}

function loadPgDefault() {
  // Root package does not own backend runtime deps. Resolve pg from backend
  // so this script works from repo root without duplicating dependencies.
  return require(path.join(repoRoot, 'backend', 'node_modules', 'pg'));
}

function loadMigrationIdsDefault() {
  const { MIGRATIONS } = require(path.join(repoRoot, 'backend', 'src', 'dbMigrations'));
  const { PLATFORM_MIGRATIONS } = require(path.join(repoRoot, 'backend', 'src', 'platformMigrations'));
  const { V1_PROPERTY_MIGRATIONS } = require(path.join(repoRoot, 'backend', 'src', 'v1', 'migrations'));
  return {
    platform: PLATFORM_MIGRATIONS.map((migration) => migration.id),
    tenant: [...MIGRATIONS, ...V1_PROPERTY_MIGRATIONS].map((migration) => migration.id),
  };
}

function formatErrorMessage(err) {
  if (err && Array.isArray(err.errors) && err.errors.length > 0) {
    return err.errors
      .map((item) => item && item.message ? item.message : String(item))
      .join('; ');
  }
  return err && err.message ? err.message : String(err);
}

function buildDbTargets(env, options = {}) {
  const resolvedEnv = options.e2eAccess ? buildE2EEnv(env) : { ...env };
  const migrationIds = options.migrationIds || loadMigrationIdsDefault();
  const tenantDbUrl = resolvedEnv.ZAMOSKV_DB_URL
    || resolvedEnv.E2E_TENANT_DB_URL
    || resolvedEnv.DATABASE_URL;

  return {
    env: resolvedEnv,
    targets: [
      {
        key: 'DATABASE_URL',
        label: 'global',
        required: true,
        connectionString: resolvedEnv.DATABASE_URL,
      },
      {
        key: 'PLATFORM_DB_URL',
        label: 'platform',
        required: true,
        connectionString: resolvedEnv.PLATFORM_DB_URL,
        migrationTable: 'platform_schema_migrations',
        expectedMigrationIds: migrationIds.platform,
      },
      {
        key: tenantDbUrl === resolvedEnv.DATABASE_URL ? 'DATABASE_URL' : 'ZAMOSKV_DB_URL/E2E_TENANT_DB_URL',
        label: 'tenant',
        required: options.e2eAccess === true,
        connectionString: tenantDbUrl,
        migrationTable: 'schema_migrations',
        expectedMigrationIds: migrationIds.tenant,
      },
    ],
  };
}

async function readMigrationState(pool, target) {
  if (!target.migrationTable || !Array.isArray(target.expectedMigrationIds)) return null;
  if (!['platform_schema_migrations', 'schema_migrations'].includes(target.migrationTable)) {
    throw new Error(`Unsupported migration table ${target.migrationTable}`);
  }

  const tableCheck = await pool.query('SELECT to_regclass($1) AS table_name', [target.migrationTable]);
  const expectedIds = target.expectedMigrationIds;
  if (!tableCheck.rows[0]?.table_name) {
    return {
      table: target.migrationTable,
      status: 'missing_table',
      applied: 0,
      expected: expectedIds.length,
      pending: expectedIds,
    };
  }

  const applied = await pool.query(`SELECT id FROM ${target.migrationTable} ORDER BY id`);
  const appliedIds = new Set(applied.rows.map((row) => row.id));
  const pending = expectedIds.filter((id) => !appliedIds.has(id));
  return {
    table: target.migrationTable,
    status: pending.length > 0 ? 'pending' : 'current',
    applied: expectedIds.length - pending.length,
    expected: expectedIds.length,
    pending,
  };
}

function formatMigrationSummary(migrations) {
  if (!migrations) return null;
  if (migrations.status === 'missing_table') {
    return `migrations: ${migrations.table} missing, ${migrations.expected} pending`;
  }
  if (migrations.pending.length === 0) {
    return `migrations: ${migrations.applied}/${migrations.expected} applied`;
  }
  const preview = migrations.pending.slice(0, 3).join(', ');
  const suffix = migrations.pending.length > 3 ? ', ...' : '';
  return `migrations: ${migrations.applied}/${migrations.expected} applied, pending ${migrations.pending.length} (${preview}${suffix})`;
}

async function checkDbTarget(Pool, target, timeoutMillis, options = {}) {
  if (!target.connectionString) {
    return {
      ...target,
      ok: !target.required,
      status: target.required ? 'missing' : 'skipped',
      message: target.required ? `${target.key} is required` : `${target.key} is not configured`,
    };
  }

  let pool;
  try {
    pool = new Pool({
      connectionString: target.connectionString,
      max: 1,
      idleTimeoutMillis: 1_000,
      connectionTimeoutMillis: timeoutMillis,
      statement_timeout: timeoutMillis,
    });
    await pool.query('SELECT 1');
    let migrations = null;
    try {
      migrations = await readMigrationState(pool, target);
    } catch (err) {
      return {
        ...target,
        ok: false,
        status: 'migration_check_failed',
        message: formatErrorMessage(err),
      };
    }
    if (migrations && migrations.status !== 'current') {
      const blocking = options.requireCurrentMigrations === true;
      return {
        ...target,
        ok: !blocking,
        status: migrations.status === 'missing_table' ? 'migration_missing' : 'migration_pending',
        message: blocking
          ? `${target.label} database reachable, but migrations are not current`
          : `${target.label} database reachable; migrations are reported but not required by this preflight`,
        migrations,
      };
    }
    return {
      ...target,
      ok: true,
      status: 'ok',
      message: `${target.label} database reachable`,
      migrations,
    };
  } catch (err) {
    return {
      ...target,
      ok: false,
      status: 'unreachable',
      message: formatErrorMessage(err),
    };
  } finally {
    if (pool) await pool.end().catch(() => {});
  }
}

async function runPreflight({
  env = process.env,
  argv = process.argv.slice(2),
  loadPg = loadPgDefault,
} = {}) {
  const options = parseArgs(argv);
  const { targets } = buildDbTargets(env, options);
  const timeoutMillis = Number(env.TENANT_OPS_PREFLIGHT_DB_TIMEOUT_MS || 3000);

  if (targets.some((target) => target.required && !target.connectionString)) {
    const checks = targets.map((target) => ({
      ...target,
      ok: !(target.required && !target.connectionString),
      status: target.connectionString ? 'not_checked' : (target.required ? 'missing' : 'skipped'),
      message: target.connectionString
        ? 'DB connectivity not checked because required configuration is missing'
        : (target.required ? `${target.key} is required` : `${target.key} is not configured`),
    }));
    return {
      ok: false,
      mode: options.e2eAccess ? 'e2e-access' : 'tenant-ops',
      checks,
    };
  }

  if (options.skipDb) {
    return {
      ok: true,
      mode: options.e2eAccess ? 'e2e-access' : 'tenant-ops',
      checks: targets.map((target) => ({
        ...target,
        ok: true,
        status: 'skipped',
        message: 'DB checks skipped by TENANT_OPS_PREFLIGHT_SKIP_DB/--skip-db',
      })),
    };
  }

  const { Pool } = loadPg();
  const checks = [];
  for (const target of targets) {
    checks.push(await checkDbTarget(Pool, target, timeoutMillis, {
      requireCurrentMigrations: options.requireCurrentMigrations,
    }));
  }

  return {
    ok: checks.every((check) => check.ok),
    mode: options.e2eAccess ? 'e2e-access' : 'tenant-ops',
    checks,
  };
}

function formatReport(result) {
  const lines = [
    `[tenant-ops-preflight] mode=${result.mode}`,
  ];
  for (const check of result.checks) {
    const marker = check.ok ? '✓' : '✗';
    lines.push(`${marker} ${check.label} ${check.status}: ${redactConnectionString(check.connectionString)}`);
    const migrationSummary = formatMigrationSummary(check.migrations);
    if (migrationSummary) lines.push(`  ${migrationSummary}`);
    if (!check.ok || check.status === 'skipped' || check.status === 'migration_pending' || check.status === 'migration_missing') {
      lines.push(`  ${check.message}`);
    }
  }
  if (!result.ok) {
    lines.push(
      '[tenant-ops-preflight] failed: start local Postgres/compose or set DATABASE_URL, PLATFORM_DB_URL and ZAMOSKV_DB_URL/E2E_TENANT_DB_URL before backend-backed E2E.',
    );
  }
  return lines.join('\n');
}

async function main() {
  loadEnvFilesDefault();
  const result = await runPreflight();
  if (parseArgs(process.argv.slice(2)).json) {
    const publicChecks = result.checks.map((check) => {
      const { expectedMigrationIds, ...publicCheck } = check;
      return {
        ...publicCheck,
        connectionString: redactConnectionString(publicCheck.connectionString),
      };
    });
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({
      ...result,
      checks: publicChecks,
    }, null, 2));
  } else {
    // eslint-disable-next-line no-console
    console.log(formatReport(result));
  }
  process.exit(result.ok ? 0 : 1);
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`[tenant-ops-preflight] ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  buildDbTargets,
  checkDbTarget,
  formatErrorMessage,
  formatMigrationSummary,
  formatReport,
  loadEnvFilesDefault,
  parseArgs,
  redactConnectionString,
  readMigrationState,
  runPreflight,
};
