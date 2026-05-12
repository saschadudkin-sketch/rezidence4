'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  LIVE_EVIDENCE_FILES,
  READINESS_GROUPS,
  checkRussiaReadiness,
  formatReport,
  validateLiveEvidencePayload,
} = require('../../../scripts/russia-readiness-check.cjs');

function makeLiveEvidence(overrides = {}) {
  return {
    schema_version: 1,
    dh: 'DH-55',
    environment: 'staging',
    captured_at: '2026-05-13T10:00:00.000Z',
    captured_by: 'release.owner@example.test',
    source: {
      type: 'api',
      endpoint: '/api/v1/residents/ownership-transfers/transfer-123',
    },
    result: {
      status: 'passed',
      summary: 'Ownership transfer drill accepted for release review.',
    },
    evidence: {
      property_slug: 'pilot-property',
      ownership_transfer_id: 'transfer-123',
      offboarding_report_id: 'offboarding-report-123',
      notification_cascade_evidence: 'notification-cascade-123',
    },
    pii_policy: 'no_personal_data_embedded',
    ...overrides,
  };
}

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

  test('strict live mode validates retained evidence payloads', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'domhub-russia-readiness-'));
    const liveDir = 'live-evidence';
    fs.mkdirSync(path.join(root, liveDir), { recursive: true });
    fs.writeFileSync(
      path.join(root, liveDir, 'dh55-ownership-transfer.json'),
      JSON.stringify(makeLiveEvidence(), null, 2),
    );

    const result = checkRussiaReadiness({
      root,
      scripts: {
        'russia:readiness': 'node scripts/russia-readiness-check.cjs',
      },
      requiredScripts: ['russia:readiness'],
      sharedEvidence: [],
      groups: [],
      requireLive: true,
      liveDir,
      liveEvidenceFiles: ['dh55-ownership-transfer.json'],
    });

    expect(result.ok).toBe(true);
    expect(result.checks).toEqual(expect.arrayContaining([{
      type: 'live-evidence',
      ref: 'live-evidence/dh55-ownership-transfer.json',
      ok: true,
      message: 'validated live pilot/staging evidence',
      group: null,
    }]));
  });

  test('strict live mode rejects local placeholders and incomplete payloads', () => {
    const failures = validateLiveEvidencePayload(makeLiveEvidence({
      environment: 'local',
      captured_by: 'TODO',
      source: { type: 'template' },
      evidence: {
        property_slug: 'example',
      },
      pii_policy: 'contains_personal_data',
    }), {
      filename: 'dh55-ownership-transfer.json',
      dh: 'DH-55',
      evidenceKeys: [
        'property_slug',
        'ownership_transfer_id',
        'offboarding_report_id',
        'notification_cascade_evidence',
      ],
    });

    expect(failures).toEqual(expect.arrayContaining([
      'environment must be one of staging, prod-candidate, pilot, production',
      'captured_by is required',
      'source must include one of command, endpoint, report_uri, runbook, artifact_url, request_id',
      'evidence.property_slug is required',
      'evidence.ownership_transfer_id is required',
      'pii_policy must be no_personal_data_embedded',
    ]));
  });
});
