'use strict';

const {
  PILOT_RUNBOOK_SECTIONS,
  checkPilotReadiness,
  formatReport,
} = require('../../../scripts/pilot-readiness-check.cjs');

describe('pilot-readiness-check script', () => {
  test('current pilot rollout evidence is registered', () => {
    const result = checkPilotReadiness();

    expect(result.ok).toBe(true);
    expect(formatReport(result)).toContain('[ok] pilot rollout readiness evidence is registered');
  });

  test('pilot rollout runbook section list covers required operational topics', () => {
    expect(PILOT_RUNBOOK_SECTIONS).toEqual(expect.arrayContaining([
      'Property launch',
      'Tenant provisioning and migrations',
      'Resident import and activation',
      'Guard/checkpoint training',
      'Degraded checkpoint mode',
      'Emergency dispatch',
      'First-week support',
      'Pilot operations training pack',
      'Incident escalation',
      'Data correction and offboarding',
      'Backup/restore and rollback',
      'Go/no-go decision',
    ]));
  });

  test('reports missing script and evidence failures', () => {
    const result = checkPilotReadiness({
      root: process.cwd(),
      scripts: {},
      evidence: ['missing/evidence.md'],
      requiredScripts: ['missing:script'],
      sections: [],
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
    ]));
  });
});
