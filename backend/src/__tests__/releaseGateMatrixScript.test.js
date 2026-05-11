'use strict';

const {
  RELEASE_GATES,
  checkMatrix,
  formatReport,
  selectGates,
} = require('../../../scripts/release-gate-matrix.cjs');

describe('release-gate-matrix script', () => {
  test('all configured release gate evidence and root scripts exist', () => {
    const result = checkMatrix();

    expect(result.ok).toBe(true);
    expect(result.gates.length).toBeGreaterThanOrEqual(5);
    expect(result.gates.find((gate) => gate.id === 'pilot-to-production')).toBeDefined();
  });

  test('can scope checks to a single gate', () => {
    const selected = selectGates(RELEASE_GATES, 'pilot-to-production');
    expect(selected).toHaveLength(1);
    expect(selected[0].scripts).toContain('verify:strict');

    const result = checkMatrix({ gateId: 'pilot-to-production' });
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
});
