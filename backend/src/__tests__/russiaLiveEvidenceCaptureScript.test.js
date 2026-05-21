'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  captureLiveEvidence,
  formatReport,
} = require('../../../scripts/russia-live-evidence-capture.cjs');
const {
  checkRussiaReadiness,
} = require('../../../scripts/russia-readiness-check.cjs');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function makeItem({ endpoint, evidence }) {
  return {
    source: {
      type: 'api',
      endpoint,
    },
    result: {
      status: 'passed',
      summary: 'Retained staging evidence accepted for release review.',
    },
    evidence,
  };
}

function makeManifest(overrides = {}) {
  return {
    schema_version: 1,
    environment: 'staging',
    property_slug: 'zamoskvorechye',
    captured_by: 'release.owner@example.test',
    captured_at: '2026-05-21T11:00:00.000Z',
    items: {
      'DH-55': makeItem({
        endpoint: '/api/v1/residents/ownership-transfers/transfer-123',
        evidence: {
          ownership_transfer_id: 'transfer-123',
          offboarding_report_id: 'offboarding-report-123',
          notification_cascade_evidence: 'notification-cascade-123',
        },
      }),
      'DH-56': makeItem({
        endpoint: '/api/v1/privacy/data-subject-requests/dsar-123',
        evidence: {
          dsar_request_id: 'dsar-123',
          privacy_readiness_report_id: 'privacy-readiness-123',
          no_biometrics_guard_checked: true,
        },
      }),
      'DH-57': makeItem({
        endpoint: '/api/v1/requests/emergency/provider-delivery-evidence/evidence-123',
        evidence: {
          emergency_request_id: 'emergency-123',
          provider_delivery_evidence_id: 'provider-delivery-123',
          notification_provider: 'smsru',
        },
      }),
      'DH-58': makeItem({
        endpoint: '/api/v1/gis-oss/export-packages/export-123/artifact',
        evidence: {
          export_package_id: 'export-123',
          document_registry_id: 'document-registry-123',
          legally_authoritative: false,
        },
      }),
      'DH-59': makeItem({
        endpoint: '/api/v1/skud/field-rollout-evidence/field-123',
        evidence: {
          provider_config_id: 'provider-config-123',
          field_rollout_evidence_id: 'field-rollout-123',
          drill_type: 'provider_failure',
        },
      }),
      'DH-60': makeItem({
        endpoint: '/api/v1/audit/sensitive-actions/_report-evidence/report-123',
        evidence: {
          report_evidence_id: 'report-evidence-123',
          review_report_id: 'review-report-123',
          anti_abuse_summary_id: 'anti-abuse-123',
        },
      }),
      'DH-61': makeItem({
        endpoint: '/docs/runbooks/pilot-operations-training-pack.md',
        evidence: {
          training_date: '2026-05-21',
          accepted_by: 'pilot-owner@example.test',
          open_waivers: [],
        },
      }),
    },
    ...overrides,
  };
}

function makeGisOssArtifact(overrides = {}) {
  return {
    artifact_format_version: 'gis_oss_package_artifact.v1',
    export_package: {
      id: 'export-package-123',
      property_id: 'property-123',
      package_type: 'oss_readiness',
      title: 'OSS readiness May',
      legally_authoritative: false,
      certified_submission: false,
    },
    legal_boundary: {
      legally_authoritative: false,
      certified_submission: false,
      notice: 'Readiness package only.',
    },
    manifest: {
      package_payload_sha256: 'a'.repeat(64),
      files: [],
    },
    payload: {
      format_version: 'gis_oss_readiness.v1',
    },
    ...overrides,
  };
}

describe('russia-live-evidence-capture script', () => {
  test('initializes a manifest template without writing strict live evidence', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'domhub-live-evidence-init-'));

    const result = captureLiveEvidence({
      root,
      now: new Date('2026-05-21T11:00:00.000Z'),
      argv: [
        '--write',
        '--init-manifest',
        '--manifest', 'artifacts/russia-readiness/live-evidence-manifest.json',
        '--environment', 'staging',
        '--property-slug', 'zamoskvorechye',
        '--captured-by', 'release.owner@example.test',
      ],
    });

    expect(result.ok).toBe(true);
    expect(formatReport(result)).toContain('[ok] manifest template initialized; replace TODO values before promotion');
    expect(result.generated).toEqual([{
      type: 'manifest-template',
      path: 'artifacts/russia-readiness/live-evidence-manifest.json',
      written: true,
    }]);
    expect(fs.existsSync(path.join(
      root,
      'artifacts/russia-readiness/dh55-ownership-transfer.json',
    ))).toBe(false);

    const manifest = JSON.parse(fs.readFileSync(
      path.join(root, 'artifacts/russia-readiness/live-evidence-manifest.json'),
      'utf8',
    ));
    expect(Object.keys(manifest.items)).toEqual([
      'DH-55',
      'DH-56',
      'DH-57',
      'DH-58',
      'DH-59',
      'DH-60',
      'DH-61',
    ]);
    expect(manifest.items['DH-58'].capture_hint).toMatchObject({
      source_type: 'api',
      result_summary: 'GIS/OSS readiness export package accepted as non-authoritative release evidence.',
    });
    expect(manifest.items['DH-58'].capture_hint.source_refs).toContain(
      'POST /api/v1/gis-oss/export-packages',
    );
    expect(manifest.items['DH-55'].evidence.ownership_transfer_id).toBe('TODO');
  });

  test('initialized manifest cannot be promoted before real evidence replaces placeholders', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'domhub-live-evidence-init-fail-'));
    captureLiveEvidence({
      root,
      now: new Date('2026-05-21T11:00:00.000Z'),
      argv: [
        '--write',
        '--init-manifest',
        '--manifest', 'artifacts/russia-readiness/live-evidence-manifest.json',
      ],
    });

    const result = captureLiveEvidence({
      root,
      argv: [
        '--write',
        '--manifest', 'artifacts/russia-readiness/live-evidence-manifest.json',
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.stringContaining('DH-55: captured_by is required'),
      expect.stringContaining('evidence.ownership_transfer_id is required'),
    ]));
    expect(fs.existsSync(path.join(
      root,
      'artifacts/russia-readiness/dh55-ownership-transfer.json',
    ))).toBe(false);
  });

  test('does not overwrite an existing manifest unless forced', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'domhub-live-evidence-init-existing-'));
    writeJson(path.join(root, 'manifest.json'), { schema_version: 1, sentinel: true });

    const result = captureLiveEvidence({
      root,
      argv: ['--write', '--init-manifest', '--manifest', 'manifest.json'],
    });

    expect(result.ok).toBe(false);
    expect(result.failures[0]).toContain('manifest already exists');
    expect(JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'))).toEqual({
      schema_version: 1,
      sentinel: true,
    });
  });

  test('updates DH-58 manifest item from a downloaded GIS/OSS artifact', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'domhub-live-evidence-dh58-'));
    writeJson(path.join(root, 'manifest.json'), makeManifest({
      items: {
        'DH-58': {
          source: { type: 'TODO', endpoint: 'TODO' },
          result: { status: 'TODO', summary: 'TODO' },
          evidence: {
            export_package_id: 'TODO',
            document_registry_id: 'TODO',
            legally_authoritative: false,
          },
        },
      },
    }));
    writeJson(path.join(root, 'gis-oss-artifact.json'), makeGisOssArtifact());

    const merge = captureLiveEvidence({
      root,
      argv: [
        '--write',
        '--manifest', 'manifest.json',
        '--dh58-artifact', 'gis-oss-artifact.json',
        '--document-registry-id', 'document-registry-123',
      ],
    });

    expect(merge.ok).toBe(true);
    expect(merge.generated).toEqual([{
      type: 'manifest-update',
      dh: 'DH-58',
      path: 'manifest.json',
      written: true,
    }]);

    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    expect(manifest.items['DH-58']).toMatchObject({
      source: {
        type: 'api',
        endpoint: '/api/v1/gis-oss/export-packages/export-package-123/artifact?property_id=property-123',
      },
      result: {
        status: 'passed',
      },
      evidence: {
        export_package_id: 'export-package-123',
        document_registry_id: 'document-registry-123',
        legally_authoritative: false,
      },
    });

    const validation = captureLiveEvidence({
      root,
      argv: ['--manifest', 'manifest.json', '--dh', 'DH-58'],
    });
    expect(validation.ok).toBe(true);
    expect(validation.generated[0]).toMatchObject({
      dh: 'DH-58',
      path: 'artifacts/russia-readiness/dh58-gis-oss-package.json',
      written: false,
    });
  });

  test('refuses DH-58 artifact merge without an external document registry id', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'domhub-live-evidence-dh58-fail-'));
    writeJson(path.join(root, 'manifest.json'), makeManifest());
    writeJson(path.join(root, 'gis-oss-artifact.json'), makeGisOssArtifact());

    const result = captureLiveEvidence({
      root,
      argv: [
        '--write',
        '--manifest', 'manifest.json',
        '--dh58-artifact', 'gis-oss-artifact.json',
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(['DH-58: --document-registry-id is required']);
  });

  test('writes strict DH-55 through DH-61 live evidence from a complete manifest', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'domhub-live-evidence-'));
    writeJson(path.join(root, 'manifest.json'), makeManifest());

    const result = captureLiveEvidence({
      root,
      argv: ['--write', '--manifest', 'manifest.json'],
    });

    expect(result.ok).toBe(true);
    expect(formatReport(result)).toContain('[ok] live evidence payloads passed strict validation');
    expect(result.generated.map((item) => item.path)).toEqual([
      'artifacts/russia-readiness/dh55-ownership-transfer.json',
      'artifacts/russia-readiness/dh56-privacy-compliance.json',
      'artifacts/russia-readiness/dh57-provider-delivery.json',
      'artifacts/russia-readiness/dh58-gis-oss-package.json',
      'artifacts/russia-readiness/dh59-field-rollout.json',
      'artifacts/russia-readiness/dh60-sensitive-report.json',
      'artifacts/russia-readiness/dh61-training-pack.json',
    ]);

    const gate = checkRussiaReadiness({
      root,
      scripts: { 'russia:readiness': 'node scripts/russia-readiness-check.cjs' },
      requiredScripts: ['russia:readiness'],
      sharedEvidence: [],
      groups: [],
      requireLive: true,
      liveEvidenceFiles: result.generated.map((item) => path.basename(item.path)),
    });
    expect(gate.ok).toBe(true);
  });

  test('fails closed and writes nothing when required live identifiers are missing', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'domhub-live-evidence-fail-'));
    const manifest = makeManifest();
    delete manifest.items['DH-58'].evidence.export_package_id;
    writeJson(path.join(root, 'manifest.json'), manifest);

    const result = captureLiveEvidence({
      root,
      argv: ['--write', '--manifest', 'manifest.json'],
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.stringContaining('DH-58: evidence.export_package_id is required'),
    ]));
    expect(fs.existsSync(path.join(
      root,
      'artifacts/russia-readiness/dh55-ownership-transfer.json',
    ))).toBe(false);
  });

  test('reports unreadable manifest as a structured failure', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'domhub-live-evidence-missing-'));

    const result = captureLiveEvidence({
      root,
      argv: ['--write', '--manifest', 'missing.json'],
    });

    expect(result).toMatchObject({
      ok: false,
      generated: [],
    });
    expect(result.failures[0]).toContain('manifest could not be read');
  });
});
