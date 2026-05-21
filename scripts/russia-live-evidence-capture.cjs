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
const MANIFEST_CAPTURE_HINTS = {
  'DH-55': {
    source_type: 'api',
    source_refs: [
      'POST /api/v1/residents/:id/transfer-ownership',
      'GET /api/v1/residents/offboarding-report?property_id=<property_id>',
    ],
    result_summary: 'Ownership transfer/offboarding evidence accepted for release review.',
  },
  'DH-56': {
    source_type: 'api',
    source_refs: [
      'POST /api/v1/privacy/data-subject-requests',
      'POST /api/v1/privacy/data-subject-requests/:id/complete',
      'GET /api/v1/privacy/readiness',
    ],
    result_summary: 'DSAR workflow, privacy readiness and no-biometrics guard accepted for release review.',
  },
  'DH-57': {
    source_type: 'api',
    source_refs: [
      'POST /api/v1/requests/emergency/provider-delivery-evidence',
      'GET /api/v1/requests/emergency/readiness',
    ],
    result_summary: 'Emergency provider delivery evidence accepted for release review.',
  },
  'DH-58': {
    source_type: 'api',
    source_refs: [
      'POST /api/v1/gis-oss/export-packages',
      'GET /api/v1/gis-oss/export-packages/:packageId/artifact?property_id=<property_id>',
    ],
    result_summary: 'GIS/OSS readiness export package accepted as non-authoritative release evidence.',
  },
  'DH-59': {
    source_type: 'api',
    source_refs: [
      'POST /api/v1/skud/field-rollout-evidence',
      'GET /api/v1/skud/provider-failures?property_id=<property_id>',
    ],
    result_summary: 'SKUD field rollout/provider failure evidence accepted for release review.',
  },
  'DH-60': {
    source_type: 'api',
    source_refs: [
      'POST /api/v1/audit/sensitive-actions/_report-evidence',
      'GET /api/v1/audit/sensitive-actions/_report-evidence?property_id=<property_id>',
    ],
    result_summary: 'Sensitive-action report evidence accepted for release review.',
  },
  'DH-61': {
    source_type: 'runbook',
    source_refs: [
      'docs/runbooks/pilot-operations-training-pack.md',
      'docs/runbooks/pilot-rollout.md',
    ],
    result_summary: 'Pilot operations training acceptance retained for release review.',
  },
};

function parseArgs(argv = []) {
  return {
    manifest: readOption(argv, '--manifest'),
    outputDir: readOption(argv, '--output-dir') || 'artifacts/russia-readiness',
    environment: readOption(argv, '--environment') || 'staging',
    propertySlug: readOption(argv, '--property-slug') || 'TODO',
    capturedBy: readOption(argv, '--captured-by') || 'TODO',
    initManifest: argv.includes('--init-manifest'),
    dh58Artifact: readOption(argv, '--dh58-artifact'),
    documentRegistryId: readOption(argv, '--document-registry-id'),
    artifactUrl: readOption(argv, '--artifact-url'),
    dh61TrainingDate: readOption(argv, '--dh61-training-date'),
    dh61AcceptedBy: readOption(argv, '--dh61-accepted-by'),
    dh61OpenWaivers: parseList(readOption(argv, '--dh61-open-waivers')),
    dh61Runbook: readOption(argv, '--dh61-runbook') || 'docs/runbooks/pilot-operations-training-pack.md',
    dh59ProviderConfigId: readOption(argv, '--dh59-provider-config-id'),
    dh59FieldRolloutEvidenceId: readOption(argv, '--dh59-field-rollout-evidence-id'),
    dh59DrillType: readOption(argv, '--dh59-drill-type'),
    dh60ReportEvidenceId: readOption(argv, '--dh60-report-evidence-id'),
    dh60ReviewReportId: readOption(argv, '--dh60-review-report-id'),
    dh60AntiAbuseSummaryId: readOption(argv, '--dh60-anti-abuse-summary-id'),
    dh57EmergencyRequestId: readOption(argv, '--dh57-emergency-request-id'),
    dh57ProviderDeliveryEvidenceId: readOption(argv, '--dh57-provider-delivery-evidence-id'),
    dh57NotificationProvider: readOption(argv, '--dh57-notification-provider'),
    dh56DsarRequestId: readOption(argv, '--dh56-dsar-request-id'),
    dh56PrivacyReadinessReportId: readOption(argv, '--dh56-privacy-readiness-report-id'),
    dh56NoBiometricsGuardChecked: readOption(argv, '--dh56-no-biometrics-guard-checked'),
    dh55OwnershipTransferId: readOption(argv, '--dh55-ownership-transfer-id'),
    dh55OffboardingReportId: readOption(argv, '--dh55-offboarding-report-id'),
    dh55NotificationCascadeEvidence: readOption(argv, '--dh55-notification-cascade-evidence'),
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

function parseList(value) {
  if (!value) return [];
  return String(value)
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasText(value) {
  return typeof value === 'string' && value.trim() && value.trim().toLowerCase() !== 'todo';
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

function validateDh58Artifact(artifact) {
  const failures = [];
  if (!isPlainObject(artifact)) return ['artifact must be a JSON object'];
  if (artifact.artifact_format_version !== 'gis_oss_package_artifact.v1') {
    failures.push('artifact_format_version must be gis_oss_package_artifact.v1');
  }
  if (!isPlainObject(artifact.export_package)) {
    failures.push('export_package object is required');
  } else {
    if (!hasText(artifact.export_package.id)) failures.push('export_package.id is required');
    if (!hasText(artifact.export_package.property_id)) failures.push('export_package.property_id is required');
    if (artifact.export_package.legally_authoritative !== false) {
      failures.push('export_package.legally_authoritative must be false');
    }
    if (artifact.export_package.certified_submission !== false) {
      failures.push('export_package.certified_submission must be false');
    }
  }
  if (!isPlainObject(artifact.legal_boundary)) {
    failures.push('legal_boundary object is required');
  } else {
    if (artifact.legal_boundary.legally_authoritative !== false) {
      failures.push('legal_boundary.legally_authoritative must be false');
    }
    if (artifact.legal_boundary.certified_submission !== false) {
      failures.push('legal_boundary.certified_submission must be false');
    }
  }
  if (!isPlainObject(artifact.payload) || artifact.payload.format_version !== 'gis_oss_readiness.v1') {
    failures.push('payload.format_version must be gis_oss_readiness.v1');
  }
  return failures;
}

function buildDh58ItemFromArtifact({ artifact, documentRegistryId, artifactUrl }) {
  const packageId = artifact.export_package.id;
  const propertyId = artifact.export_package.property_id;
  return {
    capture_hint: MANIFEST_CAPTURE_HINTS['DH-58'],
    source: {
      type: 'api',
      endpoint: artifactUrl || `/api/v1/gis-oss/export-packages/${packageId}/artifact?property_id=${propertyId}`,
    },
    result: {
      status: 'passed',
      summary: MANIFEST_CAPTURE_HINTS['DH-58'].result_summary,
    },
    evidence: {
      export_package_id: packageId,
      document_registry_id: documentRegistryId,
      legally_authoritative: false,
    },
  };
}

function isIsoDateOnly(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`));
}

function buildDh61ItemFromTraining({ trainingDate, acceptedBy, openWaivers, runbook }) {
  return {
    capture_hint: MANIFEST_CAPTURE_HINTS['DH-61'],
    source: {
      type: 'runbook',
      runbook,
    },
    result: {
      status: openWaivers.length ? 'accepted' : 'passed',
      summary: MANIFEST_CAPTURE_HINTS['DH-61'].result_summary,
    },
    evidence: {
      training_date: trainingDate,
      accepted_by: acceptedBy,
      open_waivers: openWaivers,
    },
  };
}

function buildSimpleApiManifestItem({ dh, endpoint, evidence, status = 'passed' }) {
  return {
    capture_hint: MANIFEST_CAPTURE_HINTS[dh],
    source: {
      type: 'api',
      endpoint,
    },
    result: {
      status,
      summary: MANIFEST_CAPTURE_HINTS[dh].result_summary,
    },
    evidence,
  };
}

function mergeManifestItemEvidence({
  args,
  manifest,
  manifestRelativePath,
  root,
  dh,
  required,
  buildItem,
}) {
  const failures = [];
  for (const [label, value] of required) {
    if (!hasText(value)) failures.push(`${dh}: ${label} is required`);
  }
  if (failures.length) {
    return {
      ok: false,
      write: args.write,
      outputDir: args.outputDir,
      generated: [],
      failures,
    };
  }

  const updatedManifest = {
    ...manifest,
    items: {
      ...(isPlainObject(manifest.items) ? manifest.items : {}),
      [dh]: buildItem(),
    },
  };

  return {
    ok: true,
    write: args.write,
    outputDir: args.outputDir,
    generated: [{
      type: 'manifest-update',
      dh,
      path: writeJsonIfRequested({
        root,
        relativePath: manifestRelativePath,
        value: updatedManifest,
        write: args.write,
      }),
      written: args.write,
    }],
    failures,
  };
}

function mergeDh59FieldRolloutEvidence({ args, manifest, manifestRelativePath, root }) {
  return mergeManifestItemEvidence({
    args,
    manifest,
    manifestRelativePath,
    root,
    dh: 'DH-59',
    required: [
      ['--dh59-provider-config-id', args.dh59ProviderConfigId],
      ['--dh59-field-rollout-evidence-id', args.dh59FieldRolloutEvidenceId],
      ['--dh59-drill-type', args.dh59DrillType],
    ],
    buildItem: () => buildSimpleApiManifestItem({
      dh: 'DH-59',
      endpoint: '/api/v1/skud/field-rollout-evidence',
      evidence: {
        provider_config_id: args.dh59ProviderConfigId,
        field_rollout_evidence_id: args.dh59FieldRolloutEvidenceId,
        drill_type: args.dh59DrillType,
      },
    }),
  });
}

function mergeDh60SensitiveReportEvidence({ args, manifest, manifestRelativePath, root }) {
  return mergeManifestItemEvidence({
    args,
    manifest,
    manifestRelativePath,
    root,
    dh: 'DH-60',
    required: [
      ['--dh60-report-evidence-id', args.dh60ReportEvidenceId],
      ['--dh60-review-report-id', args.dh60ReviewReportId],
      ['--dh60-anti-abuse-summary-id', args.dh60AntiAbuseSummaryId],
    ],
    buildItem: () => buildSimpleApiManifestItem({
      dh: 'DH-60',
      endpoint: '/api/v1/audit/sensitive-actions/_report-evidence',
      evidence: {
        report_evidence_id: args.dh60ReportEvidenceId,
        review_report_id: args.dh60ReviewReportId,
        anti_abuse_summary_id: args.dh60AntiAbuseSummaryId,
      },
    }),
  });
}

function mergeDh57ProviderDeliveryEvidence({ args, manifest, manifestRelativePath, root }) {
  return mergeManifestItemEvidence({
    args,
    manifest,
    manifestRelativePath,
    root,
    dh: 'DH-57',
    required: [
      ['--dh57-emergency-request-id', args.dh57EmergencyRequestId],
      ['--dh57-provider-delivery-evidence-id', args.dh57ProviderDeliveryEvidenceId],
      ['--dh57-notification-provider', args.dh57NotificationProvider],
    ],
    buildItem: () => buildSimpleApiManifestItem({
      dh: 'DH-57',
      endpoint: '/api/v1/requests/emergency/provider-delivery-evidence',
      evidence: {
        emergency_request_id: args.dh57EmergencyRequestId,
        provider_delivery_evidence_id: args.dh57ProviderDeliveryEvidenceId,
        notification_provider: args.dh57NotificationProvider,
      },
    }),
  });
}

function mergeDh56PrivacyEvidence({ args, manifest, manifestRelativePath, root }) {
  const failures = [];
  if (args.dh56NoBiometricsGuardChecked !== 'true') {
    failures.push('DH-56: --dh56-no-biometrics-guard-checked must be true');
  }
  if (failures.length) {
    return {
      ok: false,
      write: args.write,
      outputDir: args.outputDir,
      generated: [],
      failures,
    };
  }
  return mergeManifestItemEvidence({
    args,
    manifest,
    manifestRelativePath,
    root,
    dh: 'DH-56',
    required: [
      ['--dh56-dsar-request-id', args.dh56DsarRequestId],
      ['--dh56-privacy-readiness-report-id', args.dh56PrivacyReadinessReportId],
    ],
    buildItem: () => buildSimpleApiManifestItem({
      dh: 'DH-56',
      endpoint: `/api/v1/privacy/data-subject-requests/${encodeURIComponent(args.dh56DsarRequestId)}/complete`,
      evidence: {
        dsar_request_id: args.dh56DsarRequestId,
        privacy_readiness_report_id: args.dh56PrivacyReadinessReportId,
        no_biometrics_guard_checked: true,
      },
    }),
  });
}

function mergeDh55OwnershipEvidence({ args, manifest, manifestRelativePath, root }) {
  return mergeManifestItemEvidence({
    args,
    manifest,
    manifestRelativePath,
    root,
    dh: 'DH-55',
    required: [
      ['--dh55-ownership-transfer-id', args.dh55OwnershipTransferId],
      ['--dh55-offboarding-report-id', args.dh55OffboardingReportId],
      ['--dh55-notification-cascade-evidence', args.dh55NotificationCascadeEvidence],
    ],
    buildItem: () => buildSimpleApiManifestItem({
      dh: 'DH-55',
      endpoint: '/api/v1/residents/:residentId/transfer-ownership',
      evidence: {
        ownership_transfer_id: args.dh55OwnershipTransferId,
        offboarding_report_id: args.dh55OffboardingReportId,
        notification_cascade_evidence: args.dh55NotificationCascadeEvidence,
      },
    }),
  });
}

function mergeDh61TrainingEvidence({
  args,
  manifest,
  manifestRelativePath,
  root,
}) {
  const failures = [];
  if (!isIsoDateOnly(args.dh61TrainingDate)) {
    failures.push('DH-61: --dh61-training-date must be YYYY-MM-DD');
  }
  if (!hasText(args.dh61AcceptedBy)) {
    failures.push('DH-61: --dh61-accepted-by is required');
  }
  if (!hasText(args.dh61Runbook)) {
    failures.push('DH-61: --dh61-runbook is required');
  }
  if (failures.length) {
    return {
      ok: false,
      write: args.write,
      outputDir: args.outputDir,
      generated: [],
      failures,
    };
  }

  const updatedManifest = {
    ...manifest,
    items: {
      ...(isPlainObject(manifest.items) ? manifest.items : {}),
      'DH-61': buildDh61ItemFromTraining({
        trainingDate: args.dh61TrainingDate,
        acceptedBy: args.dh61AcceptedBy,
        openWaivers: args.dh61OpenWaivers,
        runbook: args.dh61Runbook,
      }),
    },
  };

  return {
    ok: true,
    write: args.write,
    outputDir: args.outputDir,
    generated: [{
      type: 'manifest-update',
      dh: 'DH-61',
      path: writeJsonIfRequested({
        root,
        relativePath: manifestRelativePath,
        value: updatedManifest,
        write: args.write,
      }),
      written: args.write,
    }],
    failures,
  };
}

function mergeDh58ArtifactEvidence({
  root,
  args,
  manifest,
  manifestRelativePath,
}) {
  const failures = [];
  const artifactPath = path.isAbsolute(args.dh58Artifact)
    ? args.dh58Artifact
    : path.join(root, args.dh58Artifact);
  let artifact;
  try {
    artifact = readJson(artifactPath);
  } catch (err) {
    return {
      ok: false,
      write: args.write,
      outputDir: args.outputDir,
      generated: [],
      failures: [`DH-58 artifact could not be read: ${err.message}`],
    };
  }

  failures.push(...validateDh58Artifact(artifact).map((failure) => `DH-58: ${failure}`));
  if (!hasText(args.documentRegistryId)) {
    failures.push('DH-58: --document-registry-id is required');
  }
  if (failures.length) {
    return {
      ok: false,
      write: args.write,
      outputDir: args.outputDir,
      generated: [],
      failures,
    };
  }

  const updatedManifest = {
    ...manifest,
    items: {
      ...(isPlainObject(manifest.items) ? manifest.items : {}),
      'DH-58': buildDh58ItemFromArtifact({
        artifact,
        documentRegistryId: args.documentRegistryId,
        artifactUrl: args.artifactUrl,
      }),
    },
  };

  return {
    ok: true,
    write: args.write,
    outputDir: args.outputDir,
    generated: [{
      type: 'manifest-update',
      dh: 'DH-58',
      path: writeJsonIfRequested({
        root,
        relativePath: manifestRelativePath,
        value: updatedManifest,
        write: args.write,
      }),
      written: args.write,
    }],
    failures,
  };
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
    capture_hint: MANIFEST_CAPTURE_HINTS[requirement.dh] || {
      source_type: 'api',
      source_refs: [],
      result_summary: 'Retained live/staging evidence accepted for release review.',
    },
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

  if (args.dh58Artifact) {
    if (failures.length) {
      return {
        ok: false,
        write: args.write,
        outputDir: args.outputDir,
        generated,
        failures,
      };
    }
    return mergeDh58ArtifactEvidence({
      root,
      args,
      manifest,
      manifestRelativePath,
    });
  }

  if (args.dh61TrainingDate || args.dh61AcceptedBy || args.dh61OpenWaivers.length) {
    if (failures.length) {
      return {
        ok: false,
        write: args.write,
        outputDir: args.outputDir,
        generated,
        failures,
      };
    }
    return mergeDh61TrainingEvidence({
      root,
      args,
      manifest,
      manifestRelativePath,
    });
  }

  if (args.dh59ProviderConfigId || args.dh59FieldRolloutEvidenceId || args.dh59DrillType) {
    if (failures.length) {
      return {
        ok: false,
        write: args.write,
        outputDir: args.outputDir,
        generated,
        failures,
      };
    }
    return mergeDh59FieldRolloutEvidence({
      root,
      args,
      manifest,
      manifestRelativePath,
    });
  }

  if (args.dh60ReportEvidenceId || args.dh60ReviewReportId || args.dh60AntiAbuseSummaryId) {
    if (failures.length) {
      return {
        ok: false,
        write: args.write,
        outputDir: args.outputDir,
        generated,
        failures,
      };
    }
    return mergeDh60SensitiveReportEvidence({
      root,
      args,
      manifest,
      manifestRelativePath,
    });
  }

  if (args.dh57EmergencyRequestId || args.dh57ProviderDeliveryEvidenceId || args.dh57NotificationProvider) {
    if (failures.length) {
      return {
        ok: false,
        write: args.write,
        outputDir: args.outputDir,
        generated,
        failures,
      };
    }
    return mergeDh57ProviderDeliveryEvidence({
      root,
      args,
      manifest,
      manifestRelativePath,
    });
  }

  if (args.dh56DsarRequestId || args.dh56PrivacyReadinessReportId || args.dh56NoBiometricsGuardChecked) {
    if (failures.length) {
      return {
        ok: false,
        write: args.write,
        outputDir: args.outputDir,
        generated,
        failures,
      };
    }
    return mergeDh56PrivacyEvidence({
      root,
      args,
      manifest,
      manifestRelativePath,
    });
  }

  if (args.dh55OwnershipTransferId || args.dh55OffboardingReportId || args.dh55NotificationCascadeEvidence) {
    if (failures.length) {
      return {
        ok: false,
        write: args.write,
        outputDir: args.outputDir,
        generated,
        failures,
      };
    }
    return mergeDh55OwnershipEvidence({
      root,
      args,
      manifest,
      manifestRelativePath,
    });
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
  buildDh58ItemFromArtifact,
  buildDh61ItemFromTraining,
  buildSimpleApiManifestItem,
  captureLiveEvidence,
  formatReport,
  parseArgs,
  validateDh58Artifact,
};
