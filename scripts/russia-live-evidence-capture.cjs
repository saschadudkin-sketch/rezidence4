#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  LIVE_EVIDENCE_REQUIREMENTS,
  validateLiveEvidencePayload,
} = require('./russia-readiness-check.cjs');
const { repoRoot } = require('./e2e-env.cjs');

const DH_REQUIREMENTS = LIVE_EVIDENCE_REQUIREMENTS.filter((requirement) => requirement.dh);

function parseArgs(argv = []) {
  return {
    manifest: readOption(argv, '--manifest'),
    outputDir: readOption(argv, '--output-dir') || 'artifacts/russia-readiness',
    environment: readOption(argv, '--environment') || 'staging',
    propertySlug: readOption(argv, '--property-slug') || 'TODO',
    capturedBy: readOption(argv, '--captured-by') || 'TODO',
    initManifest: argv.includes('--init-manifest'),
    force: argv.includes('--force'),
    write: argv.includes('--write'),
    json: argv.includes('--json'),
    dhs: parseDhList(readOption(argv, '--dh')),
  };
}

function readOption(argv, name) {
  const inline = argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  if (index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--')) return argv[index + 1];
  return null;
}

function parseDhList(value) {
  if (!value) return null;
  return String(value)
    .split(/[,\s]+/)
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function selectedRequirements(dhs) {
  if (!dhs) return DH_REQUIREMENTS;
  return DH_REQUIREMENTS.filter((requirement) => dhs.includes(requirement.dh));
}

function getManifestItem(manifest, dh) {
  return manifest.items?.[dh] || manifest.evidence?.[dh] || manifest[dh] || null;
}

function buildPayload({ manifest, item, requirement, now = new Date() }) {
  const evidence = {
    property_slug: manifest.property_slug,
    ...(isPlainObject(item.evidence) ? item.evidence : {}),
  };
  const payload = {
    schema_version: 1,
    dh: requirement.dh,
    environment: item.environment || manifest.environment,
    captured_at: item.captured_at || manifest.captured_at || now.toISOString(),
    captured_by: item.captured_by || manifest.captured_by,
    source: item.source,
    result: item.result,
    evidence,
    pii_policy: item.pii_policy || manifest.pii_policy || 'no_personal_data_embedded',
  };
  if (item.waiver) payload.waiver = item.waiver;
  return payload;
}

function writeJsonIfRequested({ root, relativePath, value, write }) {
  const absolutePath = path.join(root, relativePath);
  if (write) {
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`);
  }
  return relativePath.replace(/\\/g, '/');
}

function buildManifestItemTemplate(requirement) {
  const evidence = {};
  for (const key of requirement.evidenceKeys || []) {
    if (key === 'property_slug') continue;
    if (requirement.filename === 'dh58-gis-oss-package.json' && key === 'legally_authoritative') {
      evidence[key] = false;
    } else if (key === 'open_waivers') {
      evidence[key] = [];
    } else {
      evidence[key] = 'TODO';
    }
  }
  return {
    source: {
      type: 'TODO',
      endpoint: 'TODO',
      report_uri: 'TODO',
    },
    result: {
      status: 'TODO',
      summary: 'TODO',
    },
    evidence,
  };
}

function buildManifestTemplate({ args, requirements, now = new Date() }) {
  const items = {};
  for (const requirement of requirements) {
    items[requirement.dh] = buildManifestItemTemplate(requirement);
  }
  return {
    schema_version: 1,
    environment: args.environment,
    property_slug: args.propertySlug,
    captured_by: args.capturedBy,
    captured_at: now.toISOString(),
    pii_policy: 'no_personal_data_embedded',
    items,
  };
}

function captureLiveEvidence({
  root = repoRoot,
  argv = process.argv.slice(2),
  now = new Date(),
} = {}) {
  const args = parseArgs(argv);
  const failures = [];
  const generated = [];

  if (!args.manifest) {
    return {
      ok: false,
      write: args.write,
      outputDir: args.outputDir,
      generated,
      failures: ['--manifest is required'],
    };
  }

  const requirements = selectedRequirements(args.dhs);
  if (args.dhs && requirements.length !== args.dhs.length) {
    const known = new Set(DH_REQUIREMENTS.map((requirement) => requirement.dh));
    for (const dh of args.dhs.filter((item) => !known.has(item))) {
      failures.push(`${dh}: unknown DH id`);
    }
  }

  const manifestPath = path.isAbsolute(args.manifest)
    ? args.manifest
    : path.join(root, args.manifest);
  const manifestRelativePath = path.relative(root, manifestPath).replace(/\\/g, '/');

  if (args.initManifest) {
    if (failures.length) {
      return {
        ok: false,
        write: args.write,
        outputDir: args.outputDir,
        generated,
        failures,
      };
    }
    if (fs.existsSync(manifestPath) && !args.force) {
      return {
        ok: false,
        write: args.write,
        outputDir: args.outputDir,
        generated,
        failures: [`manifest already exists: ${manifestRelativePath}; pass --force to overwrite`],
      };
    }
    const manifestTemplate = buildManifestTemplate({ args, requirements, now });
    generated.push({
      type: 'manifest-template',
      path: writeJsonIfRequested({
        root,
        relativePath: manifestRelativePath,
        value: manifestTemplate,
        write: args.write,
      }),
      written: args.write,
    });
    return {
      ok: true,
      write: args.write,
      outputDir: args.outputDir,
      generated,
      failures,
    };
  }

  let manifest;
  try {
    manifest = readJson(manifestPath);
  } catch (err) {
    return {
      ok: false,
      write: args.write,
      outputDir: args.outputDir,
      generated,
      failures: [`manifest could not be read: ${err.message}`],
    };
  }
  if (!isPlainObject(manifest)) {
    return {
      ok: false,
      write: args.write,
      outputDir: args.outputDir,
      generated,
      failures: ['manifest must be a JSON object'],
    };
  }
  if (manifest.schema_version !== 1) {
    failures.push('manifest.schema_version must be 1');
  }

  const prepared = [];
  for (const requirement of requirements) {
    const item = getManifestItem(manifest, requirement.dh);
    if (!isPlainObject(item)) {
      failures.push(`${requirement.dh}: missing manifest item for ${requirement.filename}`);
      continue;
    }
    const payload = buildPayload({ manifest, item, requirement, now });
    const validationFailures = validateLiveEvidencePayload(payload, requirement);
    if (validationFailures.length) {
      failures.push(`${requirement.dh}: ${validationFailures.join('; ')}`);
      continue;
    }
    prepared.push({ requirement, payload });
  }

  if (failures.length) {
    return {
      ok: false,
      write: args.write,
      outputDir: args.outputDir,
      generated,
      failures,
    };
  }

  for (const { requirement, payload } of prepared) {
    generated.push({
      dh: requirement.dh,
      path: writeJsonIfRequested({
        root,
        relativePath: path.join(args.outputDir, requirement.filename),
        value: payload,
        write: args.write,
      }),
      written: args.write,
    });
  }

  return {
    ok: true,
    write: args.write,
    outputDir: args.outputDir,
    generated,
    failures,
  };
}

function formatReport(result) {
  const lines = ['[russia-live-evidence-capture]'];
  lines.push(result.write ? '[mode] write' : '[mode] dry-run');
  for (const item of result.generated) {
    const label = item.dh || item.type || 'evidence';
    lines.push(`[${item.written ? 'write' : 'dry'}] ${label} ${item.path}`);
  }
  for (const failure of result.failures) {
    lines.push(`[fail] ${failure}`);
  }
  if (result.ok && result.generated.every((item) => item.type === 'manifest-template')) {
    lines.push('[ok] manifest template initialized; replace TODO values before promotion');
  } else if (result.ok) {
    lines.push('[ok] live evidence payloads passed strict validation');
  }
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = captureLiveEvidence({ argv: process.argv.slice(2) });
  if (args.json) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result, null, 2));
  } else {
    // eslint-disable-next-line no-console
    console.log(formatReport(result));
  }
  process.exit(result.ok ? 0 : 1);
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`[russia-live-evidence-capture] ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  buildManifestTemplate,
  buildPayload,
  captureLiveEvidence,
  formatReport,
  parseArgs,
};
