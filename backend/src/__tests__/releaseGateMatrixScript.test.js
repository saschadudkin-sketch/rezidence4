'use strict';

const {
  RELEASE_GATES,
  checkMatrix,
  defaultRuntimeEvidenceForScript,
  formatReport,
  selectGates,
  validateRuntimeEvidencePayload,
} = require('../../../scripts/release-gate-matrix.cjs');

describe('release-gate-matrix script', () => {
  test('all configured release gate evidence and root scripts exist', () => {
    const result = checkMatrix({ requireRuntimeEvidence: false });

    expect(result.ok).toBe(true);
    expect(result.gates.length).toBeGreaterThanOrEqual(5);
    expect(result.gates.find((gate) => gate.id === 'pilot-to-production')).toBeDefined();
  });

  test('can scope checks to a single gate', () => {
    const selected = selectGates(RELEASE_GATES, 'pilot-to-production');
    expect(selected).toHaveLength(1);
    expect(selected[0].scripts).toContain('verify:strict');
    expect(selected[0].scripts).toContain('test:e2e:v1-packages');
    expect(selected[0].scripts).toContain('test:e2e:v1-service-execution');
    expect(selected[0].evidence).toContain('e2e/v1-packages-production.spec.js');
    expect(selected[0].evidence).toContain('e2e/v1-service-execution-production.spec.js');

    const result = checkMatrix({ gateId: 'pilot-to-production', requireRuntimeEvidence: false });
    expect(result.ok).toBe(true);
    expect(result.gates).toHaveLength(1);
    expect(formatReport(result)).toContain('[ok] pilot-to-production');
  });

  test('reports missing scripts and evidence paths', () => {
    const result = checkMatrix({
      root: process.cwd(),
      scripts: {},
      matrix: [
        {
          id: 'fake',
          title: 'Fake Gate',
          coverage: 'none',
          scripts: ['missing:script'],
          evidence: ['missing/file.js'],
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.gates[0].checks).toEqual([
      {
        type: 'script',
        ref: 'missing:script',
        ok: false,
        message: 'missing root package script',
      },
      {
        type: 'evidence',
        ref: 'missing/file.js',
        ok: false,
        message: 'missing evidence path',
      },
    ]);
  });

  test('runtime evidence mode fails closed when artifacts are missing', () => {
    const result = checkMatrix({
      root: process.cwd(),
      scripts: { 'blocking:script': 'node blocking.js' },
      requireRuntimeEvidence: true,
      matrix: [
        {
          id: 'fake',
          title: 'Fake Gate',
          coverage: 'none',
          scripts: ['blocking:script'],
          evidence: [],
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.gates[0].checks).toContainEqual(expect.objectContaining({
      type: 'runtime-evidence',
      ok: false,
      message: 'missing runtime evidence artifact',
    }));
  });

  test('validates runtime evidence freshness and successful exit status', () => {
    const payload = {
      schema_version: 1,
      script: 'security:scan',
      captured_at: new Date().toISOString(),
      ok: true,
    };

    expect(validateRuntimeEvidencePayload(payload, 'security:scan', 1)).toEqual([]);
    expect(defaultRuntimeEvidenceForScript('security:scan')).toBe('artifacts/release-gates/security-scan.json');
  });
});
