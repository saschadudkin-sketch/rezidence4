#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { repoRoot } = require('./e2e-env.cjs');

const DEFAULT_ARTIFACT_DIR = 'artifacts/release-gates';
const DEFAULT_BACKUP_DIR = './backups';
const DEFAULT_DATABASES = ['residenze', 'platform', 'zamoskv'];
const DEFAULT_STEP_TIMEOUT_MS = 10 * 60 * 1000;
const ALLOWED_ENVIRONMENTS = ['local', 'staging', 'prod-candidate', 'pilot', 'production'];

function parseArgs(argv = []) {
  return {
    refresh: argv.includes('--refresh'),
    preflight: argv.includes('--preflight'),
    drill: argv.includes('--drill'),
    write: argv.includes('--write'),
    writeFailed: argv.includes('--write-failed'),
    json: argv.includes('--json'),
    skipDocker: argv.includes('--skip-docker'),
    environment: readOption(argv, '--environment') || 'local',
    artifactDir: readOption(argv, '--artifact-dir') || DEFAULT_ARTIFACT_DIR,
    backupDir: readOption(argv, '--backup-dir') || DEFAULT_BACKUP_DIR,
    databases: parseList(readOption(argv, '--databases'), DEFAULT_DATABASES),
    maxAgeHours: readOption(argv, '--max-age-hours'),
    minBytes: readOption(argv, '--min-bytes'),
    backupReference: readOption(argv, '--backup-reference'),
    restoreTarget: readOption(argv, '--restore-target'),
    pgImage: readOption(argv, '--pg-image'),
    stepTimeoutMs: parsePositiveInt(readOption(argv, '--step-timeout-ms'), DEFAULT_STEP_TIMEOUT_MS),
  };
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readOption(argv, name) {
  const inline = argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  if (index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--')) return argv[index + 1];
  return null;
}

function parseList(value, fallback) {
  if (!value) return fallback;
  return String(value)
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function scriptArtifactName(script) {
  return `${script.replace(/[^a-z0-9_.-]/gi, '-')}.json`;
}

function commandString(command, args = []) {
  return [command, ...args].join(' ');
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isProcessCrashStatus(status) {
  return status === -1073741819 || status === 3221225477;
}

function isRetryableSpawnError(error) {
  return ['EBUSY', 'EAGAIN', 'EPERM'].includes(error?.code);
}

function runProcess(command, args, options = {}) {
  let result;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    result = spawnSync(command, args, {
      cwd: options.cwd || repoRoot,
      env: options.env || process.env,
      encoding: 'utf8',
      stdio: 'pipe',
      shell: options.shell || false,
      timeout: options.timeoutMs || DEFAULT_STEP_TIMEOUT_MS,
    });

    if (
      !isProcessCrashStatus(result.status)
      && !isRetryableSpawnError(result.error)
    ) {
      break;
    }
    if (attempt === 3) break;
    sleep(1500 * attempt);
  }

  const timedOut = result.error?.code === 'ETIMEDOUT';
  return {
    command,
    args,
    exitCode: result.status ?? (timedOut ? 124 : (result.error ? 1 : 0)),
    error: result.error ? result.error.message : null,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    signal: result.signal || null,
    timedOut,
  };
}

function buildRuntimeArtifact({ script, command, environment, exitCode, evidence, stdout, stderr }) {
  return {
    schema_version: 1,
    script,
    command,
    captured_at: new Date().toISOString(),
    environment,
    ok: exitCode === 0,
    exit_code: exitCode,
    evidence,
    stdout_tail: tail(stdout),
    stderr_tail: tail(stderr),
  };
}

function tail(value) {
  const text = String(value || '').trim();
  return text.length > 2000 ? text.slice(-2000) : text;
}

function writeArtifact({ root, artifactDir, script, artifact }) {
  const relativePath = path.join(artifactDir, scriptArtifactName(script)).replace(/\\/g, '/');
  const absolutePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(artifact, null, 2)}\n`);
  return relativePath;
}

function parseJsonOutput(stdout) {
  return JSON.parse(String(stdout || '').trim());
}

function summarizePreflight(preflight) {
  return {
    docker: preflight.docker?.status || 'unknown',
    backup_dir: preflight.backupDir,
    databases: preflight.databases,
    max_age_hours: preflight.maxAgeHours,
    min_bytes: preflight.minBytes,
    backups: (preflight.backups || []).map((backup) => ({
      database: backup.database,
      status: backup.status,
      ok: backup.ok,
      size_bytes: backup.sizeBytes,
      age_hours: backup.ageHours,
    })),
  };
}

function parseRestoreDrillEvidence(stdout, options = {}) {
  const evidence = {
    exit_code: 0,
  };
  if (options.backupReference) evidence.backup_reference = options.backupReference;
  if (options.restoreTarget) evidence.restore_target = options.restoreTarget;
  if (options.pgImage) evidence.pg_image = options.pgImage;

  for (const line of String(stdout || '').split(/\r?\n/)) {
    const totalMatch = line.match(/^\s{2}TOTAL:\s+(\d+)s\s*$/);
    if (totalMatch) {
      evidence.total_rto_seconds = Number(totalMatch[1]);
      continue;
    }
    const dbMatch = line.match(/^\s{2}([A-Za-z0-9_.-]+):\s+(\d+)s\s*$/);
    if (dbMatch) {
      evidence[`${dbMatch[1]}_rto_seconds`] = Number(dbMatch[2]);
    }
  }
  return evidence;
}

function buildPreflightArgs(options) {
  const args = [
    path.join(repoRoot, 'scripts', 'restore-drill-preflight.cjs'),
    '--json',
    '--backup-dir',
    options.backupDir,
    '--databases',
    options.databases.join(' '),
  ];
  if (options.maxAgeHours) args.push('--max-age-hours', String(options.maxAgeHours));
  if (options.minBytes) args.push('--min-bytes', String(options.minBytes));
  if (options.skipDocker) args.push('--skip-docker');
  return args;
}

function runBackupRefresh(options, spawn = runProcess) {
  const env = {
    ...process.env,
    BACKUP_DIR: path.resolve(repoRoot, options.backupDir),
    BACKUP_DATABASES: options.databases.join(' '),
  };
  return spawn('docker', [
    'compose',
    'run',
    '--rm',
    '--entrypoint',
    'sh',
    'backup',
    '-c',
    "tr -d '\\r' < /backup.sh > /tmp/backup.sh && sh /tmp/backup.sh",
  ], {
    cwd: repoRoot,
    env,
    timeoutMs: options.stepTimeoutMs,
  });
}

function runPreflight(options, spawn = runProcess) {
  return spawn(process.execPath, buildPreflightArgs(options), {
    cwd: repoRoot,
    timeoutMs: options.stepTimeoutMs,
  });
}

function runDrill(options, spawn = runProcess) {
  const env = {
    ...process.env,
    BACKUP_DIR: path.resolve(repoRoot, options.backupDir),
    BACKUP_DATABASES: options.databases.join(' '),
  };
  if (options.pgImage) env.PG_IMAGE = options.pgImage;
  return spawn(process.execPath, [path.join(repoRoot, 'scripts', 'restore-drill.cjs')], {
    cwd: repoRoot,
    env,
    timeoutMs: options.stepTimeoutMs,
  });
}

function runBackupRestoreEvidence({
  root = repoRoot,
  argv = process.argv.slice(2),
  spawn = runProcess,
} = {}) {
  const options = parseArgs(argv);
  if (!ALLOWED_ENVIRONMENTS.includes(options.environment)) {
    throw new Error(`--environment must be one of ${ALLOWED_ENVIRONMENTS.join(', ')}`);
  }
  if (!options.refresh && !options.preflight && !options.drill) {
    throw new Error('Specify at least one of --refresh, --preflight or --drill');
  }

  const steps = [];

  if (options.refresh) {
    const result = runBackupRefresh(options, spawn);
    steps.push({
      id: 'backup-refresh',
      ok: result.exitCode === 0,
      exit_code: result.exitCode,
      timed_out: Boolean(result.timedOut),
      command: commandString(result.command, result.args),
      stdout_tail: tail(result.stdout),
      stderr_tail: tail(result.stderr || result.error),
    });
    if (result.exitCode !== 0) return { ok: false, environment: options.environment, steps };
  }

  if (options.preflight) {
    const result = runPreflight(options, spawn);
    let evidence = { exit_code: result.exitCode };
    if (result.stdout.trim()) {
      try {
        evidence = {
          ...summarizePreflight(parseJsonOutput(result.stdout)),
          exit_code: result.exitCode,
        };
      } catch (err) {
        evidence.parse_error = err.message;
      }
    }
    const artifact = buildRuntimeArtifact({
      script: 'tenant:restore-drill:preflight',
      command: 'npm run tenant:restore-drill:preflight',
      environment: options.environment,
      exitCode: result.exitCode,
      evidence,
      stdout: result.stdout,
      stderr: result.stderr || result.error,
    });
    const pathWritten = options.write && (result.exitCode === 0 || options.writeFailed)
      ? writeArtifact({
        root,
        artifactDir: options.artifactDir,
        script: 'tenant:restore-drill:preflight',
        artifact,
      })
      : null;
    steps.push({
      id: 'restore-drill-preflight',
      ok: result.exitCode === 0,
      exit_code: result.exitCode,
      timed_out: Boolean(result.timedOut),
      artifact: pathWritten,
      evidence,
      stdout_tail: tail(result.stdout),
      stderr_tail: tail(result.stderr || result.error),
      command: commandString(result.command, result.args),
    });
    if (result.exitCode !== 0) return { ok: false, environment: options.environment, steps };
  }

  if (options.drill) {
    const result = runDrill(options, spawn);
    const evidence = {
      ...parseRestoreDrillEvidence(result.stdout, options),
      exit_code: result.exitCode,
    };
    const artifact = buildRuntimeArtifact({
      script: 'tenant:restore-drill',
      command: 'npm run tenant:restore-drill',
      environment: options.environment,
      exitCode: result.exitCode,
      evidence,
      stdout: result.stdout,
      stderr: result.stderr || result.error,
    });
    const pathWritten = options.write && (result.exitCode === 0 || options.writeFailed)
      ? writeArtifact({
        root,
        artifactDir: options.artifactDir,
        script: 'tenant:restore-drill',
        artifact,
      })
      : null;
    steps.push({
      id: 'restore-drill',
      ok: result.exitCode === 0,
      exit_code: result.exitCode,
      timed_out: Boolean(result.timedOut),
      artifact: pathWritten,
      evidence,
      stdout_tail: tail(result.stdout),
      stderr_tail: tail(result.stderr || result.error),
      command: commandString(result.command, result.args),
    });
    if (result.exitCode !== 0) return { ok: false, environment: options.environment, steps };
  }

  return {
    ok: steps.every((step) => step.ok),
    environment: options.environment,
    steps,
  };
}

function formatReport(result) {
  const lines = ['[backup-restore-evidence]'];
  lines.push(`[environment] ${result.environment}`);
  for (const step of result.steps) {
    lines.push(`${step.ok ? '[ok]' : '[fail]'} ${step.id} exit=${step.exit_code}`);
    if (step.artifact) lines.push(`  artifact: ${step.artifact}`);
    if (!step.ok && step.evidence?.backups) {
      for (const backup of step.evidence.backups.filter((item) => !item.ok)) {
        const age = Number.isFinite(backup.age_hours) ? `, ${backup.age_hours.toFixed(1)}h old` : '';
        lines.push(`  ${backup.database}: ${backup.status}${age}`);
      }
    }
  }
  if (result.ok) lines.push('[ok] backup/restore evidence complete');
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = runBackupRestoreEvidence({ argv: process.argv.slice(2) });
  if (args.json) {
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
    console.error(`[backup-restore-evidence] ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  buildRuntimeArtifact,
  parseArgs,
  parseRestoreDrillEvidence,
  runBackupRestoreEvidence,
  summarizePreflight,
  formatReport,
};
