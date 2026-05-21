#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  LIVE_EVIDENCE_REQUIREMENTS,
  validateLiveEvidencePayload,
} = require('./russia-readiness-check.cjs');
const { repoRoot } = require('./e2e-env.cjs');

const ALLOWED_ENVIRONMENTS = ['staging', 'prod-candidate', 'pilot', 'production'];
const COMMAND_EVIDENCE = [
  {
    output: 'staging-verify-strict.json',
    sourceArtifact: 'verify-strict.json',
    defaultCommand: 'npm run verify:strict',
    sourceType: 'command',
    extraRequired: ['log-reference'],
    buildEvidence({ payload, propertySlug, args, sourceRef }) {
      return {
        property_slug: propertySlug,
        command: payload.command || this.defaultCommand,
        exit_code: Number(payload.exit_code),
        log_reference: readOption(args, '--log-reference') || sourceRef,
      };
    },
  },
  {
    output: 'staging-restore-drill.json',
    sourceArtifact: 'tenant-restore-drill.json',
    defaultCommand: 'npm run tenant:restore-drill',
    sourceType: 'command',
    extraRequired: ['backup-reference', 'restore-target'],
    buildEvidence({ payload, propertySlug, args }) {
      return {
        property_slug: propertySlug,
        command: payload.command || this.defaultCommand,
        exit_code: Number(payload.exit_code ?? payload.evidence?.exit_code),
        backup_reference: readOption(args, '--backup-reference'),
        restore_target: readOption(args, '--restore-target'),
      };
    },
  },
];

function parseArgs(argv = []) {
  return {
    outputDir: readOption(argv, '--output-dir') || 'artifacts/russia-readiness',
    releaseGateDir: readOption(argv, '--release-gate-dir') || 'artifacts/release-gates',
    environment: readOption(argv, '--environment'),
    propertySlug: readOption(argv, '--property-slug'),
    capturedBy: readOption(argv, '--captured-by'),
    write: argv.includes('--write'),
    templates: argv.includes('--templates'),
    templatesOnly: argv.includes('--templates-only'),
    json: argv.includes('--json'),
    argv,
  };
}

function readOption(argv, name) {
  const inline = argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  if (index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--')) return argv[index + 1];
  return null;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function assertRequiredOptions(args) {
  const failures = [];
  if (!ALLOWED_ENVIRONMENTS.includes(args.environment)) {
    failures.push(`--environment must be one of ${ALLOWED_ENVIRONMENTS.join(', ')}`);
  }
  if (!args.propertySlug) failures.push('--property-slug is required');
  if (!args.capturedBy) failures.push('--captured-by is required');
  if (!args.templatesOnly) {
    for (const config of COMMAND_EVIDENCE) {
      for (const option of config.extraRequired || []) {
        if (!readOption(args.argv, `--${option}`)) failures.push(`--${option} is required`);
      }
    }
  }
  if (failures.length) throw new Error(failures.join('; '));
}

function validateSourceArtifact(payload, sourcePath, targetEnvironment) {
  const failures = [];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return ['source artifact must be a JSON object'];
  }
  if (payload.schema_version !== 1) failures.push('source artifact schema_version must be 1');
  const exitCode = payload.exit_code ?? payload.evidence?.exit_code;
  if (payload.ok !== true && exitCode !== 0) {
    failures.push('source artifact must show ok=true or exit_code=0');
  }
  if (!payload.captured_at || Number.isNaN(Date.parse(payload.captured_at))) {
    failures.push('source artifact captured_at must be an ISO timestamp');
  }
  if (payload.environment && payload.environment !== targetEnvironment) {
    failures.push(`source artifact environment must be ${targetEnvironment}, got ${payload.environment}`);
  }
  if (failures.length) failures.unshift(`${sourcePath} is not passing runtime evidence`);
  return failures;
}

function buildCommandPayload({ config, sourcePayload, sourceRef, args, now = new Date() }) {
  const requirement = LIVE_EVIDENCE_REQUIREMENTS.find((item) => item.filename === config.output);
  const payload = {
    schema_version: 1,
    environment: args.environment,
    captured_at: now.toISOString(),
    captured_by: args.capturedBy,
    source: {
      type: config.sourceType,
      command: sourcePayload.command || config.defaultCommand,
      artifact_url: sourceRef,
    },
    result: {
      status: 'passed',
      summary: `${config.defaultCommand} passed for ${args.environment} release evidence.`,
    },
    evidence: config.buildEvidence({
      payload: sourcePayload,
      propertySlug: args.propertySlug,
      args: args.argv,
      sourceRef,
    }),
    pii_policy: 'no_personal_data_embedded',
  };
  const validationFailures = validateLiveEvidencePayload(payload, requirement);
  return { payload, validationFailures };
}

function buildDhTemplate({ requirement, args, now = new Date() }) {
  const evidence = { property_slug: args.propertySlug || '<property-slug>' };
  for (const key of requirement.evidenceKeys || []) {
    if (key === 'property_slug') continue;
    if (requirement.filename === 'dh58-gis-oss-package.json' && key === 'legally_authoritative') {
      evidence[key] = false;
    } else if (key === 'open_waivers') {
      evidence[key] = [];
    } else if (key === 'training_date') {
      evidence[key] = now.toISOString().slice(0, 10);
    } else {
      evidence[key] = `<${key}>`;
    }
  }
  return {
    schema_version: 1,
    dh: requirement.dh,
    environment: args.environment || '<staging|prod-candidate|pilot|production>',
    captured_at: now.toISOString(),
    captured_by: args.capturedBy || '<release-owner>',
    source: {
      type: 'runbook',
      runbook: 'docs/runbooks/russia-readiness-evidence-capture.md',
    },
    result: {
      status: 'passed',
      summary: '<replace with retained live/staging evidence summary>',
    },
    evidence,
    pii_policy: 'no_personal_data_embedded',
  };
}

function writeJsonIfRequested({ root, relativePath, value, write }) {
  const absolutePath = path.join(root, relativePath);
  if (write) {
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`);
  }
  return relativePath.replace(/\\/g, '/');
}

function generateEvidence({
  root = repoRoot,
  argv = process.argv.slice(2),
  now = new Date(),
} = {}) {
  const args = parseArgs(argv);
  assertRequiredOptions(args);
  const generated = [];
  const failures = [];

  if (!args.templatesOnly) for (const config of COMMAND_EVIDENCE) {
    const sourceRelative = path.join(args.releaseGateDir, config.sourceArtifact).replace(/\\/g, '/');
    const sourceAbsolute = path.join(root, sourceRelative);
    if (!fs.existsSync(sourceAbsolute)) {
      failures.push(`${sourceRelative} is missing`);
      continue;
    }

    const sourcePayload = readJson(sourceAbsolute);
    const sourceFailures = validateSourceArtifact(sourcePayload, sourceRelative, args.environment);
    if (sourceFailures.length) {
      failures.push(...sourceFailures);
      continue;
    }

    const { payload, validationFailures } = buildCommandPayload({
      config,
      sourcePayload,
      sourceRef: sourceRelative,
      args,
      now,
    });
    if (validationFailures.length) {
      failures.push(`${config.output}: ${validationFailures.join('; ')}`);
      continue;
    }

    generated.push({
      type: 'command-evidence',
      path: writeJsonIfRequested({
        root,
        relativePath: path.join(args.outputDir, config.output),
        value: payload,
        write: args.write,
      }),
      written: args.write,
    });
  }

  if (args.templates || args.templatesOnly) {
    for (const requirement of LIVE_EVIDENCE_REQUIREMENTS.filter((item) => item.dh)) {
      generated.push({
        type: 'dh-template',
        path: writeJsonIfRequested({
          root,
          relativePath: path.join(args.outputDir, 'templates', requirement.filename),
          value: buildDhTemplate({ requirement, args, now }),
          write: args.write,
        }),
        written: args.write,
      });
    }
  }

  return {
    ok: failures.length === 0,
    write: args.write,
    outputDir: args.outputDir,
    generated,
    failures,
  };
}

function formatReport(result) {
  const lines = ['[russia-readiness-evidence]'];
  lines.push(result.write ? '[mode] write' : '[mode] dry-run');
  for (const item of result.generated) {
    lines.push(`[${item.written ? 'write' : 'dry'}] ${item.type} ${item.path}`);
  }
  for (const failure of result.failures) {
    lines.push(`[fail] ${failure}`);
  }
  if (result.ok) lines.push('[ok] evidence packet generation checks passed');
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = generateEvidence({ argv: process.argv.slice(2) });
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
    console.error(`[russia-readiness-evidence] ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  buildCommandPayload,
  buildDhTemplate,
  generateEvidence,
  formatReport,
  parseArgs,
};
