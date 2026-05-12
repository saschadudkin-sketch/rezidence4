'use strict';

const path = require('node:path');
const {
  TRAINING_PACK_SECTIONS,
  checkPilotTrainingPack,
  formatReport,
} = require('../../../scripts/pilot-training-pack-check.cjs');

const repoRoot = path.resolve(__dirname, '../../..');

describe('pilot-training-pack-check script', () => {
  test('current DH-61 training pack evidence is registered', () => {
    const result = checkPilotTrainingPack();

    expect(result.ok).toBe(true);
    expect(formatReport(result)).toContain('[ok] pilot operations training pack evidence is registered');
  });

  test('training pack section list covers DH-61 operating workflows', () => {
    expect(TRAINING_PACK_SECTIONS).toEqual(expect.arrayContaining([
      'First-Week Support',
      'Guard/Checkpoint Training',
      'Emergency Drill',
      'Resident Offboarding Drill',
      'PDn/DSAR Support',
      'Daily Evidence Capture',
      'Training Acceptance',
    ]));
  });

  test('reports missing script, evidence, section and marker failures', () => {
    const result = checkPilotTrainingPack({
      root: repoRoot,
      scripts: {},
      requiredScripts: ['missing:script'],
      evidence: ['missing/evidence.md'],
      sections: ['Missing Section'],
      markers: [['missing/evidence.md', 'marker']],
    });

    expect(result.ok).toBe(false);
    expect(result.checks).toEqual(expect.arrayContaining([
      {
        type: 'script',
        ref: 'missing:script',
        ok: false,
        message: 'missing root package script',
      },
      {
        type: 'evidence',
        ref: 'missing/evidence.md',
        ok: false,
        message: 'missing evidence path',
      },
      {
        type: 'training-section',
        ref: 'docs/runbooks/pilot-operations-training-pack.md#Missing Section',
        ok: false,
        message: 'missing training pack section',
      },
      {
        type: 'marker',
        ref: 'missing/evidence.md :: marker',
        ok: false,
        message: 'expected marker missing',
      },
    ]));
  });
});
