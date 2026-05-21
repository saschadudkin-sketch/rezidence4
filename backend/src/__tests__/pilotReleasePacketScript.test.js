'use strict';

const {
  buildPlan,
  formatReport,
  runReleasePacket,
  validateOptions,
} = require('../../../scripts/pilot-release-packet.cjs');

const baseArgv = [
  '--environment', 'staging',
  '--property-slug', 'zamoskvorechye',
  '--captured-by', 'release.owner@example.test',
  '--log-reference', 'ci://verify-strict/123',
  '--backup-reference', 's3://backups/staging/2026-05-21',
  '--restore-target', 'restore-drill-pg-123',
];

describe('pilot-release-packet script', () => {
  test('builds release packet plan in strict go-live order', () => {
    const plan = buildPlan({
      environment: 'staging',
      propertySlug: 'zamoskvorechye',
      capturedBy: 'release.owner@example.test',
      logReference: 'ci://verify-strict/123',
      backupReference: 's3://backups/staging/2026-05-21',
      restoreTarget: 'restore-drill-pg-123',
      liveDir: 'artifacts/russia-readiness',
      templates: true,
    });

    expect(plan.map((step) => step.id)).toEqual([
      'verify-strict',
      'backup-restore-evidence',
      'russia-command-evidence',
      'russia-live-readiness',
    ]);
    expect(plan[0].args).toEqual(expect.arrayContaining(['--environment', 'staging']));
    expect(plan[1].args).toEqual(expect.arrayContaining(['--write', '--write-failed']));
    expect(plan[2].args).toEqual(expect.arrayContaining(['--templates']));
  });

  test('rejects local or incomplete release packet options', () => {
    expect(() => validateOptions({
      environment: 'local',
      propertySlug: 'zamoskvorechye',
      capturedBy: 'owner',
      logReference: 'log',
      backupReference: 'backup',
      restoreTarget: 'target',
    })).toThrow('--environment must be one of');

    expect(() => validateOptions({
      environment: 'staging',
      propertySlug: '',
      capturedBy: 'owner',
      logReference: '',
      backupReference: '',
      restoreTarget: '',
    })).toThrow('--property-slug is required');
  });

  test('runs steps sequentially and stops on first failure', () => {
    const calls = [];
    const runner = (args, env, step) => {
      calls.push({ args, env, step });
      return { exitCode: step.id === 'backup-restore-evidence' ? 1 : 0 };
    };

    const result = runReleasePacket({ argv: baseArgv, runner });

    expect(result.ok).toBe(false);
    expect(result.steps.map((step) => step.id)).toEqual([
      'verify-strict',
      'backup-restore-evidence',
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[0].env.RELEASE_GATE_ENVIRONMENT).toBe('staging');
    expect(formatReport(result)).toContain('[fail] backup-restore-evidence');
  });

  test('supports partial runs for already-collected evidence', () => {
    const calls = [];
    const runner = (args, env, step) => {
      calls.push(step.id);
      return { exitCode: 0 };
    };

    const result = runReleasePacket({
      argv: [
        ...baseArgv,
        '--skip-verify',
        '--skip-backup-restore',
      ],
      runner,
    });

    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      'russia-command-evidence',
      'russia-live-readiness',
    ]);
  });
});
