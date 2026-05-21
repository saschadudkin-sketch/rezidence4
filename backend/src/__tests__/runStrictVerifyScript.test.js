'use strict';

const {
  buildArtifact,
  commandForArtifact,
  parseArgs,
} = require('../../../scripts/run-strict-verify.cjs');

describe('run-strict-verify script', () => {
  test('parses explicit release evidence environment', () => {
    expect(parseArgs(['--environment', 'staging'])).toEqual({
      environment: 'staging',
    });
    expect(parseArgs(['--environment=prod-candidate'])).toEqual({
      environment: 'prod-candidate',
    });
  });

  test('rejects unknown release evidence environment', () => {
    expect(() => parseArgs(['--environment', 'devbox'])).toThrow(
      '--environment must be one of',
    );
  });

  test('builds strict runtime artifact with provided environment and command', () => {
    const artifact = buildArtifact({
      ok: true,
      timedOut: false,
      exitCode: 0,
      phases: [{ id: 'verify', ok: true }],
    }, {
      command: commandForArtifact(['--environment', 'staging']),
      environment: 'staging',
    });

    expect(artifact).toMatchObject({
      schema_version: 1,
      command: 'npm run verify:strict -- --environment staging',
      environment: 'staging',
      ok: true,
      timed_out: false,
      exit_code: 0,
      phases: [{ id: 'verify', ok: true }],
    });
    expect(Date.parse(artifact.captured_at)).not.toBeNaN();
  });
});
