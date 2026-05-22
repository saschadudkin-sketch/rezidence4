#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  LIVE_EVIDENCE_REQUIREMENTS,
  validateLiveEvidencePayload,
} = require('./russia-readiness-check.cjs');
const { buildPayload } = require('./russia-live-evidence-capture.cjs');
const { repoRoot } = require('./e2e-env.cjs');

const DEFAULT_MANIFEST = 'artifacts/russia-readiness/live-evidence-manifest.json';
const DEFAULT_LIVE_DIR = 'artifacts/russia-readiness';

const HELPER_COMMANDS = {
  'DH-55': [
    'npm run russia:readiness:live-evidence -- --write --manifest artifacts/russia-readiness/live-evidence-manifest.json \\',
    '  --dh55-ownership-transfer-id <ownership-transfer-id> \\',
    '  --dh55-offboarding-report-id <offboarding-report-id> \\',
    '  --dh55-notification-cascade-evidence <notification-cascade-evidence-id-or-uri>',
  ].join('\n'),
  'DH-56': [
    'npm run russia:readiness:live-evidence -- --write --manifest artifacts/russia-readiness/live-evidence-manifest.json \\',
    '  --dh56-dsar-request-id <dsar-request-id> \\',
    '  --dh56-privacy-readiness-report-id <privacy-readiness-report-id> \\',
    '  --dh56-no-biometrics-guard-checked true',
  ].join('\n'),
  'DH-57': [
    'npm run russia:readiness:live-evidence -- --write --manifest artifacts/russia-readiness/live-evidence-manifest.json \\',
    '  --dh57-emergency-request-id <emergency-request-id> \\',
    '  --dh57-provider-delivery-evidence-id <provider-delivery-evidence-id> \\',
    '  --dh57-notification-provider <provider-name>',
  ].join('\n'),
  'DH-58': [
    'npm run russia:readiness:live-evidence -- --write --manifest artifacts/russia-readiness/live-evidence-manifest.json \\',
    '  --dh58-artifact artifacts/russia-readiness/dh58-gis-oss-artifact.json \\',
    '  --document-registry-id <document-registry-id>',
  ].join('\n'),
  'DH-59': [
    'npm run russia:readiness:live-evidence -- --write --manifest artifacts/russia-readiness/live-evidence-manifest.json \\',
    '  --dh59-provider-config-id <provider-config-id> \\',
    '  --dh59-field-rollout-evidence-id <field-rollout-evidence-id> \\',
    '  --dh59-drill-type <provider_failure|field_rollout|vendor_health_probe>',
  ].join('\n'),
  'DH-60': [
    'npm run russia:readiness:live-evidence -- --write --manifest artifacts/russia-readiness/live-evidence-manifest.json \\',
    '  --dh60-report-evidence-id <report-evidence-id> \\',
    '  --dh60-review-report-id <review-report-id> \\',
    '  --dh60-anti-abuse-summary-id <anti-abuse-summary-id>',
  ].join('\n'),
  'DH-61': [
    'npm run russia:readiness:live-evidence -- --write --manifest artifacts/russia-readiness/live-evidence-manifest.json \\',
    '  --dh61-training-date <YYYY-MM-DD> \\',
    '  --dh61-accepted-by <pilot-owner-or-release-owner> \\',
    '  --dh61-open-waivers <comma-separated-waiver-ids>',
  ].join('\n'),
};

function readOption(argv, name) {
  const inline = argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  if (index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--')) return argv[index + 1];
  return null;
}

function parseArgs(argv = []) {
  return {
    manifest: readOption(argv, '--manifest') || DEFAULT_MANIFEST,
    liveDir: readOption(argv, '--live-dir') || DEFAULT_LIVE_DIR,
    write: argv.includes('--write'),
    report: readOption(argv, '--report') || 'artifacts/russia-readiness/live-gap-report.md',
    json: argv.includes('--json'),
  };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readJsonIfExists(root, relativePath) {
  const absolutePath = path.isAbsolute(relativePath) ? relativePath : path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) return { exists: false, value: null, error: null };
  try {
    return {
      exists: true,
      value: JSON.parse(fs.readFileSync(absolutePath, 'utf8')),
      error: null,
    };
  } catch (err) {
    return { exists: true, value: null, error: err.message };
  }
}

function getManifestItem(manifest, dh) {
  if (!isPlainObject(manifest)) return null;
  return manifest.items?.[dh] || manifest.evidence?.[dh] || manifest[dh] || null;
}

function summarizeFailures(failures) {
  if (!failures.length) return [];
  return failures.map((failure) => failure.replace(/^evidence\./, ''));
}

function buildGapReport({
  root = repoRoot,
  argv = process.argv.slice(2),
  now = new Date(),
} = {}) {
  const args = parseArgs(argv);
  const manifestRead = readJsonIfExists(root, args.manifest);
  const manifest = manifestRead.value;
  const rows = [];

  for (const requirement of LIVE_EVIDENCE_REQUIREMENTS.filter((item) => item.dh)) {
    const rootEvidencePath = path.join(args.liveDir, requirement.filename).replace(/\\/g, '/');
    const rootEvidence = readJsonIfExists(root, rootEvidencePath);
    let rootFailures = [];
    if (rootEvidence.exists && rootEvidence.error) {
      rootFailures = [`invalid JSON: ${rootEvidence.error}`];
    } else if (rootEvidence.exists) {
      rootFailures = validateLiveEvidencePayload(rootEvidence.value, requirement);
    } else {
      rootFailures = ['missing root evidence file'];
    }

    const item = getManifestItem(manifest, requirement.dh);
    let manifestFailures = [];
    if (manifestRead.error) {
      manifestFailures = [`manifest invalid JSON: ${manifestRead.error}`];
    } else if (!manifestRead.exists) {
      manifestFailures = ['manifest missing'];
    } else if (!isPlainObject(item)) {
      manifestFailures = ['manifest item missing'];
    } else {
      const payload = buildPayload({ manifest, item, requirement, now });
      manifestFailures = validateLiveEvidencePayload(payload, requirement);
    }

    const ready = rootEvidence.exists && rootFailures.length === 0;
    const manifestReady = manifestFailures.length === 0;
    rows.push({
      dh: requirement.dh,
      file: requirement.filename,
      ready,
      manifestReady,
      rootEvidencePath,
      missing: summarizeFailures(ready ? [] : (manifestReady ? rootFailures : manifestFailures)),
      helperCommand: HELPER_COMMANDS[requirement.dh],
    });
  }

  const ok = rows.every((row) => row.ready);
  return {
    ok,
    generatedAt: now.toISOString(),
    manifest: args.manifest,
    liveDir: args.liveDir,
    rows,
  };
}

function formatMarkdown(report) {
  const lines = [
    '# Russia Readiness Live Evidence Gap Report',
    '',
    `Generated: ${report.generatedAt}`,
    `Manifest: \`${report.manifest}\``,
    `Live dir: \`${report.liveDir}\``,
    '',
    '| DH | Root file | Status | Missing / invalid fields |',
    '|---|---|---|---|',
  ];

  for (const row of report.rows) {
    const status = row.ready ? 'ready' : (row.manifestReady ? 'manifest ready, root missing/invalid' : 'blocked');
    const missing = row.missing.length ? row.missing.join('<br>') : '-';
    lines.push(`| ${row.dh} | \`${row.file}\` | ${status} | ${missing} |`);
  }

  lines.push('', '## Helper Commands', '');
  for (const row of report.rows.filter((item) => !item.ready)) {
    lines.push(`### ${row.dh}`, '', '```bash', row.helperCommand, '```', '');
  }

  lines.push(
    '## Final Gate',
    '',
    '```bash',
    'npm run russia:readiness -- --require-live --live-dir artifacts/russia-readiness',
    '```',
    '',
  );

  return `${lines.join('\n')}\n`;
}

function formatText(report) {
  const lines = ['[russia-readiness-live-gap]'];
  for (const row of report.rows) {
    if (row.ready) {
      lines.push(`[ok] ${row.dh} ${row.file}`);
      continue;
    }
    lines.push(`[gap] ${row.dh} ${row.file}: ${row.missing.join('; ')}`);
  }
  if (report.ok) {
    lines.push('[ok] all DH-55..DH-61 live evidence files are valid');
  } else {
    lines.push('[fail] DH-55..DH-61 live evidence is incomplete');
  }
  return lines.join('\n');
}

function writeReportIfRequested({ root = repoRoot, argv = process.argv.slice(2), report }) {
  const args = parseArgs(argv);
  if (!args.write) return null;
  const absolutePath = path.isAbsolute(args.report) ? args.report : path.join(root, args.report);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, formatMarkdown(report));
  return path.relative(root, absolutePath).replace(/\\/g, '/');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = buildGapReport({ argv: process.argv.slice(2) });
  const written = writeReportIfRequested({ argv: process.argv.slice(2), report });
  if (args.json) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ...report, written }, null, 2));
  } else {
    // eslint-disable-next-line no-console
    console.log(formatText(report));
    if (written) {
      // eslint-disable-next-line no-console
      console.log(`[write] ${written}`);
    }
  }
  process.exit(report.ok ? 0 : 1);
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`[russia-readiness-live-gap] ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  buildGapReport,
  formatMarkdown,
  formatText,
  parseArgs,
};
