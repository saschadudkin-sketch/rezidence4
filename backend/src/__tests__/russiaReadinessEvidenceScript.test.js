'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  generateEvidence,
  formatReport,
} = require('../../../scripts/russia-readiness-evidence.cjs');
const {
  validateLiveEvidencePayload,
} = require('../../../scripts/russia-readiness-check.cjs');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function makeRuntimeEvidence(overrides = {}) {
  return {
    schema_version: 1,
    command: 'npm run verify:strict',
    captured_at: '2026-05-21T10:00:00.000Z',
    environment: 'staging',
    ok: true,
    exit_code: 0,
    ...overrides,
  };
}

describe('russia-readiness-evidence script', () => {
  test('generates valid staging command evidence from matching runtime artifacts', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'domhub-ru-evidence-'));
    writeJson(path.join(root, 'artifacts/release-gates/verify-strict.json'), makeRuntimeEvidence());
    writeJson(path.join(root, 'artifacts/release-gates/tenant-restore-drill.json'), makeRuntimeEvidence({
      command: 'npm run tenant:restore-drill',
      evidence: { exit_code: 0, total_rto_seconds: 18 },
    }));

    const result = generateEvidence({
      root,
      now: new Date('2026-05-21T11:00:00.000Z'),
      argv: [
        '--write',
        '--environment', 'staging',
        '--property-slug', 'zamoskvorechye',
        '--captured-by', 'release.owner@example.test',
        '--log-reference', 'ci://verify-strict/123',
        '--backup-reference', 's3://backups/staging/2026-05-21',
        '--restore-target', 'restore-drill-pg-123',
      ],
    });

    expect(result.ok).toBe(true);
    expect(formatReport(result)).toContain('[ok] evidence packet generation checks passed');
    const verify = JSON.parse(fs.readFileSync(
      path.join(root, 'artifacts/russia-readiness/staging-verify-strict.json'),
      'utf8',
    ));
    const restore = JSON.parse(fs.readFileSync(
      path.join(root, 'artifacts/russia-readiness/staging-restore-drill.json'),
      'utf8',
    ));

    expect(validateLiveEvidencePayload(verify, {
      filename: 'staging-verify-strict.json',
      evidenceKeys: ['property_slug', 'command', 'exit_code', 'log_reference'],
    })).toEqual([]);
    expect(validateLiveEvidencePayload(restore, {
      filename: 'staging-restore-drill.json',
      evidenceKeys: ['property_slug', 'command', 'exit_code', 'backup_reference', 'restore_target'],
    })).toEqual([]);
    expect(verify.evidence.property_slug).toBe('zamoskvorechye');
    expect(restore.evidence.backup_reference).toBe('s3://backups/staging/2026-05-21');
  });

  test('fails closed when source artifacts are local but target evidence is staging', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'domhub-ru-evidence-local-'));
    writeJson(path.join(root, 'artifacts/release-gates/verify-strict.json'), makeRuntimeEvidence({
      environment: 'local',
    }));
    writeJson(path.join(root, 'artifacts/release-gates/tenant-restore-drill.json'), makeRuntimeEvidence({
      command: 'npm run tenant:restore-drill',
      environment: 'local',
    }));

    const result = generateEvidence({
      root,
      argv: [
        '--environment', 'staging',
        '--property-slug', 'zamoskvorechye',
        '--captured-by', 'release.owner@example.test',
        '--log-reference', 'ci://verify-strict/123',
        '--backup-reference', 's3://backups/staging/2026-05-21',
        '--restore-target', 'restore-drill-pg-123',
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.stringContaining('source artifact environment must be staging, got local'),
    ]));
  });

  test('writes DH templates outside the strict live evidence root files', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'domhub-ru-evidence-templates-'));
    writeJson(path.join(root, 'artifacts/release-gates/verify-strict.json'), makeRuntimeEvidence());
    writeJson(path.join(root, 'artifacts/release-gates/tenant-restore-drill.json'), makeRuntimeEvidence({
      command: 'npm run tenant:restore-drill',
      evidence: { exit_code: 0 },
    }));

    const result = generateEvidence({
      root,
      now: new Date('2026-05-21T11:00:00.000Z'),
      argv: [
        '--write',
        '--templates',
        '--environment', 'staging',
        '--property-slug', 'zamoskvorechye',
        '--captured-by', 'release.owner@example.test',
        '--log-reference', 'ci://verify-strict/123',
        '--backup-reference', 's3://backups/staging/2026-05-21',
        '--restore-target', 'restore-drill-pg-123',
      ],
    });

    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(
      root,
      'artifacts/russia-readiness/templates/dh55-ownership-transfer.json',
    ))).toBe(true);
    expect(fs.existsSync(path.join(
      root,
      'artifacts/russia-readiness/dh55-ownership-transfer.json',
    ))).toBe(false);
  });

  test('can write DH templates before command evidence artifacts exist', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'domhub-ru-evidence-templates-only-'));

    const result = generateEvidence({
      root,
      now: new Date('2026-05-21T11:00:00.000Z'),
      argv: [
        '--write',
        '--templates-only',
        '--environment', 'staging',
        '--property-slug', 'zamoskvorechye',
        '--captured-by', 'release.owner@example.test',
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.generated.every((item) => item.type === 'dh-template')).toBe(true);
    expect(fs.existsSync(path.join(
      root,
      'artifacts/russia-readiness/templates/dh61-training-pack.json',
    ))).toBe(true);
  });
});
