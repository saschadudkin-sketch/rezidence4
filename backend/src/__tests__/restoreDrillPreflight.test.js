'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const {
  formatReport,
  runPreflight,
} = require('../../../scripts/restore-drill-preflight.cjs');

function writeBackup(dir, database, content = 'SELECT 1;\n') {
  const filePath = path.join(dir, `${database}_latest.sql.gz`);
  fs.writeFileSync(filePath, zlib.gzipSync(content));
  return filePath;
}

describe('restore-drill-preflight script', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-drill-preflight-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('passes when all expected latest backups are fresh gzip files', () => {
    for (const db of ['residenze', 'platform', 'zamoskv']) writeBackup(tmpDir, db);

    const result = runPreflight({
      env: {},
      argv: ['--backup-dir', tmpDir, '--skip-docker', '--min-bytes', '1'],
      nowMs: Date.now(),
    });

    expect(result.ok).toBe(true);
    expect(result.backups.map((backup) => backup.status)).toEqual(['ok', 'ok', 'ok']);
    expect(result.docker.status).toBe('skipped');
    expect(formatReport(result)).toContain('[ok] zamoskv ok');
  });

  test('fails on missing expected latest backup', () => {
    writeBackup(tmpDir, 'residenze');

    const result = runPreflight({
      env: {},
      argv: ['--backup-dir', tmpDir, '--skip-docker', '--min-bytes', '1'],
      nowMs: Date.now(),
    });

    expect(result.ok).toBe(false);
    expect(result.backups.find((backup) => backup.database === 'platform')).toMatchObject({
      ok: false,
      status: 'missing',
    });
  });

  test('fails on non-gzip latest backup file', () => {
    fs.writeFileSync(path.join(tmpDir, 'zamoskv_latest.sql.gz'), 'plain sql dump');

    const result = runPreflight({
      env: {},
      argv: [
        '--backup-dir', tmpDir,
        '--databases', 'zamoskv',
        '--skip-docker',
        '--min-bytes', '1',
      ],
      nowMs: Date.now(),
    });

    expect(result.ok).toBe(false);
    expect(result.backups[0]).toMatchObject({
      database: 'zamoskv',
      status: 'invalid_gzip',
    });
  });

  test('fails stale backups against the configured max age', () => {
    const filePath = writeBackup(tmpDir, 'platform');
    const old = new Date('2026-05-01T00:00:00Z');
    fs.utimesSync(filePath, old, old);

    const result = runPreflight({
      env: {},
      argv: [
        '--backup-dir', tmpDir,
        '--databases', 'platform',
        '--skip-docker',
        '--min-bytes', '1',
        '--max-age-hours', '24',
      ],
      nowMs: new Date('2026-05-03T00:00:00Z').getTime(),
    });

    expect(result.ok).toBe(false);
    expect(result.backups[0].status).toBe('stale');
  });

  test('fails when docker check is not skipped and docker is unavailable', () => {
    writeBackup(tmpDir, 'residenze');
    const result = runPreflight({
      env: {},
      argv: ['--backup-dir', tmpDir, '--databases', 'residenze', '--min-bytes', '1'],
      nowMs: Date.now(),
      spawn: () => ({ status: 1, stderr: 'Cannot connect to Docker daemon' }),
    });

    expect(result.ok).toBe(false);
    expect(result.docker).toMatchObject({
      ok: false,
      status: 'unavailable',
    });
  });
});
