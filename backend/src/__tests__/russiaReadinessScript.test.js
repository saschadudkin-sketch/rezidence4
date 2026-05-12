'use strict';

const {
  LIVE_EVIDENCE_FILES,
  READINESS_GROUPS,
  checkRussiaReadiness,
  formatReport,
} = require('../../../scripts/russia-readiness-check.cjs');

describe('russia-readiness-check script', () => {
  test('current Russia readiness baseline evidence is registered', () => {
    const result = checkRussiaReadiness();

    expect(result.ok).toBe(true);
    expect(formatReport(result)).toContain('[ok] Russia readiness baseline evidence is registered');
  });

  test('readiness groups cover the critical DH-55 through DH-60 evidence set', () => {
    expect(READINESS_GROUPS.map((group) => group.id)).toEqual([
      'DH-55',
      'DH-56',
      'DH-57',
      'DH-58',
      'DH-59',
      'DH-60',
      'DH-61',
    ]);
  });

  test('reports missing script and evidence failures', () => {
    const result = checkRussiaReadiness({
      root: process.cwd(),
      scripts: {},
      requiredScripts: ['missing:script'],
      sharedEvidence: ['missing/shared.md'],
      groups: [{
        id: 'DH-X',
        title: 'Missing',
        evidence: ['missing/evidence.js'],
        markers: [['missing/evidence.js', 'marker']],
      }],
    });

    expect(result.ok).toBe(false);
    expect(result.checks).toEqual(expect.arrayContaining([
      {
        type: 'script',
        ref: 'missing:script',
        ok: false,
        message: 'missing root package script',
        group: null,
      },
      {
        type: 'shared-evidence',
        ref: 'missing/shared.md',
        ok: false,
        message: 'missing shared evidence',
        group: null,
      },
      {
        type: 'evidence',
        ref: 'missing/evidence.js',
        ok: false,
        message: 'missing evidence path',
        group: 'DH-X',
      },
      {
        type: 'marker',
        ref: 'missing/evidence.js :: marker',
        ok: false,
        message: 'expected marker missing',
        group: 'DH-X',
      },
    ]));
  });

  test('strict live mode requires retained pilot and staging evidence artifacts', () => {
    const result = checkRussiaReadiness({
      scripts: {
        'russia:readiness': 'node scripts/russia-readiness-check.cjs',
      },
      requiredScripts: ['russia:readiness'],
      sharedEvidence: [],
      groups: [],
      requireLive: true,
      liveDir: 'missing-live-evidence',
      liveEvidenceFiles: LIVE_EVIDENCE_FILES.slice(0, 2),
    });

    expect(result.ok).toBe(false);
    expect(result.checks).toEqual(expect.arrayContaining([
      {
        type: 'live-evidence',
        ref: 'missing-live-evidence/dh55-ownership-transfer.json',
        ok: false,
        message: 'missing live pilot/staging evidence',
        group: null,
      },
    ]));
  });
});
