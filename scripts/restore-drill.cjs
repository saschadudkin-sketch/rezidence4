#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');

function splitList(value, fallback) {
  return String(value || fallback)
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function shQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function quoteIdent(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function formatTail(value) {
  return String(value || '').trim().slice(-2000);
}

function runDocker(args, { capture = true, allowFailure = false } = {}) {
  const result = spawnSync('docker', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
  });

  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    const tail = [formatTail(result.stdout), formatTail(result.stderr)].filter(Boolean).join('\n');
    throw new Error(`docker ${args.join(' ')} failed with exit ${result.status}${tail ? `\n${tail}` : ''}`);
  }
  return result;
}

function cleanup({ container, network }) {
  runDocker(['rm', '-f', container], { capture: true, allowFailure: true });
  runDocker(['network', 'rm', network], { capture: true, allowFailure: true });
}

function waitForPostgres({ container, user }) {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const result = runDocker(['exec', container, 'pg_isready', '-U', user], {
      capture: true,
      allowFailure: true,
    });
    if (result.status === 0) return attempt;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  throw new Error('restore drill postgres did not become ready in 30s');
}

function readCount({ container, user, password, database, sql }) {
  const result = runDocker([
    'exec',
    '-e',
    `PGPASSWORD=${password}`,
    container,
    'psql',
    '-U',
    user,
    '-d',
    database,
    '-tAc',
    sql,
  ]);
  const count = Number.parseInt(String(result.stdout || '').trim(), 10);
  if (!Number.isFinite(count)) {
    throw new Error(`${database}: invariant query did not return a number`);
  }
  return count;
}

function assertBackupFiles({ backupDir, databases }) {
  for (const database of databases) {
    const filePath = path.join(backupDir, `${database}_latest.sql.gz`);
    if (!fs.existsSync(filePath)) {
      throw new Error(`missing backup file: ${filePath}`);
    }
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size <= 0) {
      throw new Error(`backup file is empty or not a regular file: ${filePath}`);
    }
  }
}

async function main(env = process.env) {
  const backupDir = path.resolve(String(env.BACKUP_DIR || './backups'));
  const databases = splitList(env.BACKUP_DATABASES, 'residenze platform zamoskv');
  const image = env.PG_IMAGE || 'postgres:16-alpine';
  const port = env.PG_PORT || '15432';
  const user = env.PG_USER || 'residenze';
  const password = env.PG_PASSWORD || `drill_only_${crypto.randomBytes(6).toString('hex')}`;
  const network = env.NETWORK || 'domhub_drill';
  const container = env.CONTAINER || 'domhub-restore-drill-pg';
  const rto = new Map();
  const startedAt = Date.now();

  assertBackupFiles({ backupDir, databases });

  console.log('=== DATA-1 Restore Drill - pristine docker ===');
  console.log(`Backup dir:     ${backupDir}`);
  console.log(`Databases:      ${databases.join(' ')}`);
  console.log(`Postgres image: ${image}`);

  runDocker(['info']);
  cleanup({ container, network });

  try {
    runDocker(['network', 'create', network]);
    runDocker([
      'run',
      '-d',
      '--name',
      container,
      '--network',
      network,
      '-p',
      `127.0.0.1:${port}:5432`,
      '-e',
      `POSTGRES_USER=${user}`,
      '-e',
      `POSTGRES_PASSWORD=${password}`,
      '-e',
      'POSTGRES_DB=postgres',
      image,
    ]);

    const readyAfter = waitForPostgres({ container, user });
    console.log(`[drill] postgres ready after ${readyAfter}s`);

    for (const database of databases) {
      runDocker([
        'exec',
        '-e',
        `PGPASSWORD=${password}`,
        container,
        'psql',
        '-U',
        user,
        '-d',
        'postgres',
        '-c',
        `CREATE DATABASE ${quoteIdent(database)} OWNER ${quoteIdent(user)};`,
      ]);
      console.log(`[drill] database created: ${database}`);
    }

    for (const database of databases) {
      const restoreStartedAt = Date.now();
      const latestPath = `/backups/${database}_latest.sql.gz`;
      console.log(`[drill] restoring ${database} from ${latestPath}`);
      runDocker([
        'run',
        '--rm',
        '--network',
        network,
        '-v',
        `${backupDir}:/backups:ro`,
        '-e',
        `PGPASSWORD=${password}`,
        image,
        'sh',
        '-c',
        `gunzip -c ${shQuote(latestPath)} | psql -h ${shQuote(container)} -U ${shQuote(user)} -d ${shQuote(database)} -v ON_ERROR_STOP=1 >/tmp/restore.log`,
      ]);
      const seconds = Math.max(1, Math.round((Date.now() - restoreStartedAt) / 1000));
      rto.set(database, seconds);
      console.log(`[drill] ${database} restored in ${seconds}s`);
    }

    const checks = [];
    if (databases.includes('residenze')) {
      checks.push({
        database: 'residenze',
        label: 'users count',
        min: 1,
        count: readCount({
          container,
          user,
          password,
          database: 'residenze',
          sql: 'SELECT COUNT(*) FROM users',
        }),
      });
    }
    if (databases.includes('platform')) {
      checks.push({
        database: 'platform',
        label: 'properties count',
        min: 1,
        count: readCount({
          container,
          user,
          password,
          database: 'platform',
          sql: 'SELECT COUNT(*) FROM properties',
        }),
      });
    }
    if (databases.includes('zamoskv')) {
      checks.push({
        database: 'zamoskv',
        label: 'v1 schema_migrations applied',
        min: 25,
        count: readCount({
          container,
          user,
          password,
          database: 'zamoskv',
          sql: "SELECT COUNT(*) FROM schema_migrations WHERE id LIKE 'v1_%'",
        }),
      });
    }

    for (const check of checks) {
      if (check.count < check.min) {
        throw new Error(`${check.database}: ${check.label} count=${check.count}, expected >= ${check.min}`);
      }
      console.log(`[drill] invariant ok: ${check.database} ${check.label}=${check.count}`);
    }

    const totalSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    console.log('RTO summary:');
    for (const database of databases) {
      console.log(`  ${database}: ${rto.get(database) || '?'}s`);
    }
    console.log(`  TOTAL: ${totalSeconds}s`);
    console.log('[drill] passed');
  } finally {
    cleanup({ container, network });
    console.log('[drill] cleanup done');
  }
}

main().catch((err) => {
  console.error(`[restore-drill] ${err.stack || err.message}`);
  process.exit(1);
});
