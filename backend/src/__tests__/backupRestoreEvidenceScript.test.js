'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  parseRestoreDrillEvidence,
  runBackupRestoreEvidence,
  summarizePreflight,
} = require('../../../scripts/backup-restore-evidence.cjs');

function makeSpawn(responses) {
  const calls = [];
  const spawn = (command, args, options) => {
    calls.push({ command, args, options });
    return responses.shift() || { exitCode: 0, stdout: '', stderr: '', command, args };
  };
  spawn.calls = calls;
  return spawn;
}

describe('backup-restore-evidence script', () => {
  test('parses restore drill RTO summary into runtime evidence fields', () => {
    const evidence = parseRestoreDrillEvidence(`
RTO summary:
  residenze: 6s
  platform: 1s
  zamoskv: 5s
  TOTAL: 18s
`, {
      backupReference: 's3://backups/staging/2026-05-21',
      restoreTarget: 'restore-drill-pg-123',
      pgImage: 'postgres:16-alpine',
    });

    expect(evidence).toMatchObject({
      exit_code: 0,
      residenze_rto_seconds: 6,
      platform_rto_seconds: 1,
      zamoskv_rto_seconds: 5,
      total_rto_seconds: 18,
      backup_reference: 's3://backups/staging/2026-05-21',
      restore_target: 'restore-drill-pg-123',
      pg_image: 'postgres:16-alpine',
    });
  });

  test('summarizes restore preflight JSON without embedding raw paths only', () => {
    const summary = summarizePreflight({
      backupDir: 'D:/backups',
      databases: ['residenze'],
      maxAgeHours: 48,
      minBytes: 1024,
      docker: { status: 'ok' },
      backups: [{
        database: 'residenze',
        status: 'ok',
        ok: true,
        sizeBytes: 4096,
        ageHours: 1.5,
      }],
    });

    expect(summary).toEqual({
      docker: 'ok',
      backup_dir: 'D:/backups',
      databases: ['residenze'],
      max_age_hours: 48,
      min_bytes: 1024,
      backups: [{
        database: 'residenze',
        status: 'ok',
        ok: true,
        size_bytes: 4096,
        age_hours: 1.5,
      }],
    });
  });

  test('writes preflight and drill runtime artifacts when both steps pass', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'domhub-backup-evidence-'));
    const preflightJson = JSON.stringify({
      ok: true,
      backupDir: 'D:/backups',
      databases: ['residenze', 'platform', 'zamoskv'],
      maxAgeHours: 48,
      minBytes: 1024,
      docker: { status: 'ok' },
      backups: [],
    });
    const spawn = makeSpawn([
      { exitCode: 0, stdout: preflightJson, stderr: '', command: 'node', args: [] },
      {
        exitCode: 0,
        stdout: 'RTO summary:\n  residenze: 6s\n  platform: 1s\n  zamoskv: 5s\n  TOTAL: 18s\n[drill] passed\n',
        stderr: '',
        command: 'node',
        args: [],
      },
    ]);

    const result = runBackupRestoreEvidence({
      root,
      spawn,
      argv: [
        '--write',
        '--preflight',
        '--drill',
        '--environment', 'staging',
        '--backup-reference', 's3://backups/staging/2026-05-21',
        '--restore-target', 'restore-drill-pg-123',
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.steps.map((step) => step.artifact)).toEqual([
      'artifacts/release-gates/tenant-restore-drill-preflight.json',
      'artifacts/release-gates/tenant-restore-drill.json',
    ]);
    const drill = JSON.parse(fs.readFileSync(
      path.join(root, 'artifacts/release-gates/tenant-restore-drill.json'),
      'utf8',
    ));
    expect(drill).toMatchObject({
      script: 'tenant:restore-drill',
      environment: 'staging',
      ok: true,
      exit_code: 0,
      evidence: {
        total_rto_seconds: 18,
        backup_reference: 's3://backups/staging/2026-05-21',
        restore_target: 'restore-drill-pg-123',
      },
    });
  });

  test('stops before drill when refresh step fails', () => {
    const spawn = makeSpawn([
      { exitCode: 1, stdout: '', stderr: 'pg_dump failed', command: 'docker', args: [] },
    ]);

    const result = runBackupRestoreEvidence({
      spawn,
      argv: ['--refresh', '--preflight', '--drill'],
    });

    expect(result.ok).toBe(false);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toMatchObject({
      id: 'backup-refresh',
      ok: false,
      exit_code: 1,
    });
    expect(spawn.calls).toHaveLength(1);
  });

  test('propagates step timeout and records timed out backup refresh', () => {
    const spawn = makeSpawn([
      {
        exitCode: 124,
        stdout: '',
        stderr: '',
        error: 'spawnSync docker ETIMEDOUT',
        timedOut: true,
        command: 'docker',
        args: [],
      },
    ]);

    const result = runBackupRestoreEvidence({
      spawn,
      argv: ['--refresh', '--step-timeout-ms', '1234'],
    });

    expect(result.ok).toBe(false);
    expect(spawn.calls[0].options.timeoutMs).toBe(1234);
    expect(spawn.calls[0].args).toEqual([
      'compose',
      'run',
      '--rm',
      '--entrypoint',
      'sh',
      'backup',
      '-c',
      "tr -d '\\r' < /backup.sh > /tmp/backup.sh && sh /tmp/backup.sh",
    ]);
    expect(result.steps[0]).toMatchObject({
      id: 'backup-refresh',
      ok: false,
      exit_code: 124,
      timed_out: true,
      stderr_tail: 'spawnSync docker ETIMEDOUT',
    });
  });
});
