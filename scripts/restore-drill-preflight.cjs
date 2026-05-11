#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DEFAULT_DATABASES = ['residenze', 'platform', 'zamoskv'];
const DEFAULT_MAX_AGE_HOURS = 48;
const DEFAULT_MIN_BYTES = 1024;

function parseArgs(argv = []) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;

    const raw = token.slice(2);
    const eq = raw.indexOf('=');
    const key = eq === -1 ? raw : raw.slice(0, eq);
    let value = eq === -1 ? true : raw.slice(eq + 1);
    if (eq === -1 && argv[i + 1] && !argv[i + 1].startsWith('--')) {
      value = argv[i + 1];
      i += 1;
    }
    args[key] = value;
  }
  return args;
}

function parseList(value, fallback) {
  if (!value) return fallback;
  return String(value)
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseNumber(value, fallback, name) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }
  return parsed;
}

function booleanArg(value) {
  return value === true || value === '1' || value === 'true' || value === 'yes';
}

function isGzipFile(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(2);
    const bytesRead = fs.readSync(fd, buffer, 0, 2, 0);
    return bytesRead === 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
  } finally {
    fs.closeSync(fd);
  }
}

function checkBackupFile({ backupDir, database, nowMs, maxAgeHours, minBytes }) {
  const filePath = path.join(backupDir, `${database}_latest.sql.gz`);
  if (!fs.existsSync(filePath)) {
    return {
      database,
      filePath,
      ok: false,
      status: 'missing',
      message: `${database}_latest.sql.gz is missing`,
    };
  }

  const stat = fs.statSync(filePath);
  const ageHours = Math.max(0, (nowMs - stat.mtimeMs) / 3600000);
  if (stat.size < minBytes) {
    return {
      database,
      filePath,
      ok: false,
      status: stat.size === 0 ? 'empty' : 'too_small',
      sizeBytes: stat.size,
      ageHours,
      message: `backup is ${stat.size} bytes, expected at least ${minBytes}`,
    };
  }

  if (!isGzipFile(filePath)) {
    return {
      database,
      filePath,
      ok: false,
      status: 'invalid_gzip',
      sizeBytes: stat.size,
      ageHours,
      message: 'backup file does not have a gzip header',
    };
  }

  if (ageHours > maxAgeHours) {
    return {
      database,
      filePath,
      ok: false,
      status: 'stale',
      sizeBytes: stat.size,
      ageHours,
      message: `backup is ${ageHours.toFixed(1)}h old, max allowed is ${maxAgeHours}h`,
    };
  }

  return {
    database,
    filePath,
    ok: true,
    status: 'ok',
    sizeBytes: stat.size,
    ageHours,
    message: 'backup file is present, fresh and gzip-compressed',
  };
}

function checkDocker({ skipDocker = false, spawn = spawnSync } = {}) {
  if (skipDocker) {
    return {
      ok: true,
      status: 'skipped',
      message: 'docker check skipped',
    };
  }

  const result = spawn('docker', ['info'], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.error) {
    return {
      ok: false,
      status: 'unavailable',
      message: result.error.message,
    };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      status: 'unavailable',
      message: (result.stderr || result.stdout || 'docker info failed').trim(),
    };
  }
  return {
    ok: true,
    status: 'ok',
    message: 'docker daemon is available',
  };
}

function buildOptions({ env = process.env, argv = process.argv.slice(2) } = {}) {
  const args = parseArgs(argv);
  const backupDir = path.resolve(String(args['backup-dir'] || env.BACKUP_DIR || './backups'));
  return {
    backupDir,
    databases: parseList(args.databases || env.BACKUP_DATABASES, DEFAULT_DATABASES),
    maxAgeHours: parseNumber(
      args['max-age-hours'] || env.RESTORE_DRILL_MAX_BACKUP_AGE_HOURS,
      DEFAULT_MAX_AGE_HOURS,
      'max-age-hours',
    ),
    minBytes: parseNumber(
      args['min-bytes'] || env.RESTORE_DRILL_MIN_BACKUP_BYTES,
      DEFAULT_MIN_BYTES,
      'min-bytes',
    ),
    skipDocker: booleanArg(args['skip-docker']) || env.RESTORE_DRILL_SKIP_DOCKER === '1',
    json: booleanArg(args.json),
  };
}

function runPreflight({
  env = process.env,
  argv = process.argv.slice(2),
  nowMs = Date.now(),
  spawn = spawnSync,
} = {}) {
  const options = buildOptions({ env, argv });
  const backups = options.databases.map((database) => checkBackupFile({
    backupDir: options.backupDir,
    database,
    nowMs,
    maxAgeHours: options.maxAgeHours,
    minBytes: options.minBytes,
  }));
  const docker = checkDocker({ skipDocker: options.skipDocker, spawn });

  return {
    ok: backups.every((backup) => backup.ok) && docker.ok,
    backupDir: options.backupDir,
    databases: options.databases,
    maxAgeHours: options.maxAgeHours,
    minBytes: options.minBytes,
    docker,
    backups,
  };
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '?';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatReport(result) {
  const lines = [
    '[restore-drill-preflight]',
    `backup dir: ${result.backupDir}`,
    `databases: ${result.databases.join(', ')}`,
    `limits: max age ${result.maxAgeHours}h, min size ${result.minBytes}B`,
  ];

  const dockerMarker = result.docker.ok ? '[ok]' : '[fail]';
  lines.push(`${dockerMarker} docker ${result.docker.status}: ${result.docker.message}`);

  for (const backup of result.backups) {
    const marker = backup.ok ? '[ok]' : '[fail]';
    const meta = backup.sizeBytes === undefined
      ? ''
      : ` (${formatBytes(backup.sizeBytes)}, ${backup.ageHours.toFixed(1)}h old)`;
    lines.push(`${marker} ${backup.database} ${backup.status}: ${backup.filePath}${meta}`);
    if (!backup.ok) lines.push(`  ${backup.message}`);
  }

  return lines.join('\n');
}

async function main() {
  const options = buildOptions();
  const result = runPreflight();
  if (options.json) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result, null, 2));
  } else {
    // eslint-disable-next-line no-console
    console.log(formatReport(result));
  }
  process.exit(result.ok ? 0 : 1);
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`[restore-drill-preflight] ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  buildOptions,
  checkBackupFile,
  checkDocker,
  formatReport,
  isGzipFile,
  parseArgs,
  parseList,
  runPreflight,
};
