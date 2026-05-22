'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildCommandRegistry,
  resolveScriptSelection,
  runReleaseGateRuntimeEvidence,
} = require('../../../scripts/release-gate-runtime-evidence.cjs');

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'release-gate-runtime-evidence-'));
}

function readJson(root, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

describe('release-gate-runtime-evidence script', () => {
  test('selects explicit scripts without duplicates', () => {
    expect(resolveScriptSelection({
      scripts: ['backend:test', 'backend:test', 'frontend:lint'],
      gate: null,
      all: false,
    })).toEqual(['backend:test', 'frontend:lint']);
  });

  test('writes runtime artifact for commands that do not own their artifact', () => {
    const root = makeTempRoot();
    const spawn = jest.fn(() => ({
      exitCode: 0,
      stdout: 'pilot readiness ok',
      stderr: '',
      signal: null,
      timedOut: false,
    }));

    const result = runReleaseGateRuntimeEvidence({
      root,
      argv: ['--script', 'pilot:readiness', '--artifact-dir', 'evidence', '--environment', 'test'],
      spawn,
      env: {},
    });

    expect(result.ok).toBe(true);
    expect(result.steps).toEqual([expect.objectContaining({
      script: 'pilot:readiness',
      ok: true,
      artifact: 'evidence/pilot-readiness.json',
    })]);
    expect(spawn).toHaveBeenCalledTimes(1);

    const artifact = readJson(root, 'evidence/pilot-readiness.json');
    expect(artifact).toEqual(expect.objectContaining({
      schema_version: 1,
      script: 'pilot:readiness',
      command: 'npm run pilot:readiness',
      environment: 'test',
      ok: true,
      exit_code: 0,
    }));
    expect(artifact.stdout_tail).toBe('pilot readiness ok');
  });

  test('does not leak e2e env into plain unit-check commands', () => {
    const root = makeTempRoot();
    const spawn = jest.fn(() => ({
      exitCode: 0,
      stdout: 'backend ok',
      stderr: '',
      signal: null,
      timedOut: false,
    }));

    runReleaseGateRuntimeEvidence({
      root,
      argv: ['--script', 'backend:test'],
      spawn,
      env: {
        DATABASE_URL: 'postgresql://e2e-db',
        REDIS_URL: 'redis://e2e-redis',
      },
    });

    const [, , options] = spawn.mock.calls[0];
    expect(options.env.DATABASE_URL).not.toBe('postgresql://e2e-db');
    expect(options.env.REDIS_URL).not.toBe('redis://e2e-redis');
  });

  test('stale-only skips scripts with fresh passing runtime evidence', () => {
    const root = makeTempRoot();
    const artifactDir = path.join(root, 'evidence');
    fs.mkdirSync(artifactDir, { recursive: true });
    fs.writeFileSync(path.join(artifactDir, 'pilot-readiness.json'), `${JSON.stringify({
      schema_version: 1,
      script: 'pilot:readiness',
      command: 'npm run pilot:readiness',
      captured_at: new Date().toISOString(),
      ok: true,
      exit_code: 0,
    })}\n`);

    const spawn = jest.fn();
    const result = runReleaseGateRuntimeEvidence({
      root,
      argv: ['--script', 'pilot:readiness', '--artifact-dir', 'evidence', '--stale-only'],
      spawn,
      env: {},
    });

    expect(result.ok).toBe(true);
    expect(spawn).not.toHaveBeenCalled();
    expect(result.steps).toEqual([expect.objectContaining({
      script: 'pilot:readiness',
      skipped: true,
      reason: 'fresh runtime evidence already exists',
    })]);
  });

  test('tenant provision command is dry-run and uses configured tenant db url', () => {
    const registry = buildCommandRegistry({
      environment: 'test',
      tenantProvisionSlug: 'dryrun-demo',
      tenantProvisionName: 'Dry Run Demo',
      backupReference: 'local-backups://demo',
      restoreTarget: 'local-restore',
    }, {
      ZAMOSKV_DB_URL: 'postgresql://demo',
    });

    const command = registry.get('tenant:provision');
    expect(command.args).toContain('--dry-run');
    expect(command.args).toContain('--db-url');
    expect(command.args).toContain('postgresql://demo');
    expect(command.label).toContain('dryrun-demo');
    expect(command.label).toContain('--db-url [redacted]');
    expect(command.label).not.toContain('postgresql://demo');
  });

  test('fails closed on unsupported scripts', () => {
    expect(() => runReleaseGateRuntimeEvidence({
      root: makeTempRoot(),
      argv: ['--script', 'security:scan'],
      spawn: jest.fn(),
      env: {},
    })).toThrow('unsupported release-gate script(s): security:scan');
  });
});
