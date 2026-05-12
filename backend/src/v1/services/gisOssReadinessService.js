'use strict';

const crypto = require('node:crypto');

const LEGAL_BOUNDARY_NOTICE =
  'DomHub prepares an export/readiness package for external GIS ZhKH / OSS work. '
  + 'This package is not a certified GIS ZhKH filing channel and is not legally significant electronic OSS voting.';

const PACKAGE_TYPES = Object.freeze([
  'gis_zhkh',
  'oss_readiness',
  'resident_notice',
  'protocol_archive',
]);

const PACKAGE_COLS = `
  id, property_id, package_type, title, status, period_start, period_end,
  document_ids, announcement_ids, protocol_files, operational_record_refs,
  export_payload, boundary_notice, legally_authoritative, certified_submission,
  generated_by_uid, generated_at, created_at, updated_at
`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class GisOssReadinessServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'GisOssReadinessServiceError';
    this.status = status;
  }
}

function serviceError(status, message) {
  return new GisOssReadinessServiceError(status, message);
}

function isGisOssReadinessServiceError(err) {
  return err instanceof GisOssReadinessServiceError;
}

function normalizeText(value, field, maxLength = 160) {
  if (typeof value !== 'string' || !value.trim()) throw serviceError(400, `${field} is required`);
  const trimmed = value.trim();
  if (trimmed.length > maxLength) throw serviceError(400, `${field} is too long`);
  return trimmed;
}

function normalizeEnum(value, allowed, field, fallback) {
  const raw = value === undefined || value === null || value === ''
    ? fallback
    : String(value).trim().toLowerCase();
  if (!allowed.includes(raw)) throw serviceError(400, `${field} must be one of: ${allowed.join(', ')}`);
  return raw;
}

function normalizeDate(value, field) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw serviceError(400, `${field} must be ISO date`);
  }
  return value.slice(0, 10);
}

function normalizeUuidList(value, field) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw serviceError(400, `${field} must be an array`);
  const seen = new Set();
  const result = [];
  for (const item of value) {
    if (typeof item !== 'string' || !UUID_RE.test(item)) {
      throw serviceError(400, `${field} must contain UUID values`);
    }
    if (!seen.has(item)) {
      seen.add(item);
      result.push(item);
    }
  }
  return result;
}

function normalizeJsonArray(value, field) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw serviceError(400, `${field} must be an array`);
  return value;
}

function normalizeProtocolFiles(value) {
  return normalizeJsonArray(value, 'protocol_files').map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw serviceError(400, `protocol_files[${index}] must be an object`);
    }
    const label = normalizeText(item.label || item.title || `protocol-${index + 1}`, `protocol_files[${index}].label`, 120);
    const fileUrl = normalizeText(item.file_url || item.fileUrl, `protocol_files[${index}].file_url`, 500);
    if (!fileUrl.startsWith('/uploads/')) {
      throw serviceError(400, `protocol_files[${index}].file_url must be a local /uploads/ URL`);
    }
    return {
      label,
      file_url: fileUrl,
      file_mime: typeof item.file_mime === 'string' ? item.file_mime : null,
      signed_at: typeof item.signed_at === 'string' ? item.signed_at : null,
    };
  });
}

function normalizeOperationalRefs(value) {
  return normalizeJsonArray(value, 'operational_record_refs').map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw serviceError(400, `operational_record_refs[${index}] must be an object`);
    }
    return {
      type: normalizeText(item.type, `operational_record_refs[${index}].type`, 80),
      id: normalizeText(String(item.id || item.ref_id || ''), `operational_record_refs[${index}].id`, 120),
      note: typeof item.note === 'string' ? item.note.trim() : null,
    };
  });
}

function sortForStableJson(value) {
  if (Array.isArray(value)) return value.map(sortForStableJson);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value)
    .sort()
    .reduce((acc, key) => {
      acc[key] = sortForStableJson(value[key]);
      return acc;
    }, {});
}

function stableJson(value, space = 0) {
  return JSON.stringify(sortForStableJson(value), null, space);
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function slugifyFilename(value, fallback = 'package') {
  const slug = String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || fallback;
}

function buildManifestFiles({
  documents,
  announcements,
  protocolFiles,
  operationalRefs,
  payloadJson,
}) {
  const files = [{
    path: 'payload.json',
    role: 'package_payload',
    content_type: 'application/json',
    byte_size: Buffer.byteLength(payloadJson, 'utf8'),
    sha256: sha256Hex(payloadJson),
  }];

  for (const doc of documents) {
    files.push({
      path: `materials/documents/${doc.id}.json`,
      role: 'document_metadata',
      source_url: doc.file_url || null,
      content_type: 'application/json',
      source_mime: doc.file_mime || null,
      byte_size: Buffer.byteLength(stableJson(doc), 'utf8'),
      sha256: sha256Hex(stableJson(doc)),
    });
  }

  for (const announcement of announcements) {
    files.push({
      path: `materials/announcements/${announcement.id}.json`,
      role: 'announcement_metadata',
      content_type: 'application/json',
      byte_size: Buffer.byteLength(stableJson(announcement), 'utf8'),
      sha256: sha256Hex(stableJson(announcement)),
    });
  }

  for (const [index, file] of protocolFiles.entries()) {
    files.push({
      path: `materials/protocol-files/${String(index + 1).padStart(2, '0')}-${slugifyFilename(file.label)}.json`,
      role: 'protocol_file_reference',
      source_url: file.file_url,
      content_type: 'application/json',
      source_mime: file.file_mime || null,
      byte_size: Buffer.byteLength(stableJson(file), 'utf8'),
      sha256: sha256Hex(stableJson(file)),
    });
  }

  for (const [index, ref] of operationalRefs.entries()) {
    files.push({
      path: `materials/operational-refs/${String(index + 1).padStart(2, '0')}-${slugifyFilename(ref.type)}-${slugifyFilename(ref.id)}.json`,
      role: 'operational_record_reference',
      content_type: 'application/json',
      byte_size: Buffer.byteLength(stableJson(ref), 'utf8'),
      sha256: sha256Hex(stableJson(ref)),
    });
  }

  return files;
}

function buildPackagingEvidence({
  propertyId,
  packageType,
  title,
  generatedAt,
  documents,
  announcements,
  protocolFiles,
  operationalRefs,
  basePayload,
}) {
  const payloadJson = stableJson(basePayload, 2);
  const artifactFilename = [
    'gis-oss',
    slugifyFilename(packageType),
    slugifyFilename(title),
    generatedAt.slice(0, 10),
    propertyId.slice(0, 8),
  ].join('-') + '.json';

  return {
    packaging: {
      format_version: 'gis_oss_artifact_manifest.v1',
      artifact_filename: artifactFilename,
      artifact_content_type: 'application/vnd.domhub.gis-oss-readiness+json',
      manifest: {
        payload_path: 'payload.json',
        package_payload_sha256: sha256Hex(payloadJson),
        material_counts: {
          documents: documents.length,
          announcements: announcements.length,
          protocol_files: protocolFiles.length,
          operational_record_refs: operationalRefs.length,
        },
        files: buildManifestFiles({
          documents,
          announcements,
          protocolFiles,
          operationalRefs,
          payloadJson,
        }),
      },
    },
    operational_evidence: {
      generated_at: generatedAt,
      source_validation: {
        documents_property_scoped: true,
        announcements_property_scoped: true,
        protocol_files_local_uploads_only: true,
      },
      immutable_storage: 'gis_oss_export_packages.export_payload',
      operator_review_required: true,
    },
  };
}

async function fetchDocuments(queryable, { propertyId, documentIds }) {
  if (!documentIds.length) return [];
  const { rows } = await queryable.query(
    `SELECT id, title, category, tag, body_md, file_url, file_mime,
            file_size_bytes, is_public, published_at, updated_at
       FROM documents_v2
      WHERE property_id = $1
        AND id = ANY($2::uuid[])
        AND deleted_at IS NULL`,
    [propertyId, documentIds],
  );
  if (rows.length !== documentIds.length) {
    throw serviceError(404, 'One or more documents were not found in this property');
  }
  return rows;
}

async function fetchAnnouncements(queryable, { propertyId, announcementIds }) {
  if (!announcementIds.length) return [];
  const { rows } = await queryable.query(
    `SELECT id, title, body_md, is_urgent, category, audience_type,
            starts_at, expires_at, published_at, updated_at
       FROM announcements_v2
      WHERE property_id = $1
        AND id = ANY($2::uuid[])
        AND deleted_at IS NULL`,
    [propertyId, announcementIds],
  );
  if (rows.length !== announcementIds.length) {
    throw serviceError(404, 'One or more announcements were not found in this property');
  }
  return rows;
}

function buildExportPayload({
  propertyId,
  packageType,
  title,
  periodStart,
  periodEnd,
  documents,
  announcements,
  protocolFiles,
  operationalRefs,
}) {
  const generatedAt = new Date().toISOString();
  const basePayload = {
    format_version: 'gis_oss_readiness.v1',
    generated_at: generatedAt,
    property_id: propertyId,
    package_type: packageType,
    title,
    period: {
      start: periodStart,
      end: periodEnd,
    },
    legal_boundary: {
      legally_authoritative: false,
      certified_submission: false,
      notice: LEGAL_BOUNDARY_NOTICE,
      out_of_scope: [
        'legally_significant_electronic_oss_voting',
        'certified_gis_zhkh_filing',
      ],
    },
    materials: {
      documents: documents.map((doc) => ({
        id: doc.id,
        title: doc.title,
        category: doc.category,
        tag: doc.tag || null,
        file_url: doc.file_url || null,
        file_mime: doc.file_mime || null,
        file_size_bytes: doc.file_size_bytes || null,
        is_public: doc.is_public === true,
        published_at: doc.published_at || null,
        updated_at: doc.updated_at || null,
      })),
      announcements: announcements.map((announcement) => ({
        id: announcement.id,
        title: announcement.title,
        is_urgent: announcement.is_urgent === true,
        category: announcement.category,
        audience_type: announcement.audience_type,
        starts_at: announcement.starts_at || null,
        expires_at: announcement.expires_at || null,
        published_at: announcement.published_at || null,
        updated_at: announcement.updated_at || null,
      })),
      protocol_files: protocolFiles,
      operational_record_refs: operationalRefs,
    },
    integration_path: {
      current_mode: 'readiness_package_only',
      certified_submission_supported: false,
      future_certified_requirements: [
        'operator_certificate_and_power_of_attorney',
        'gis_zhkh_provider_accreditation',
        'submission_receipt_registry',
        'oss_vote_registry_and_quorum_controls',
      ],
    },
  };
  const evidence = buildPackagingEvidence({
    propertyId,
    packageType,
    title,
    generatedAt,
    documents,
    announcements,
    protocolFiles,
    operationalRefs,
    basePayload,
  });
  return {
    ...basePayload,
    ...evidence,
  };
}

function buildGisOssExportArtifact(exportPackage) {
  const payload = exportPackage.export_payload || {};
  const artifact = {
    artifact_format_version: 'gis_oss_package_artifact.v1',
    generated_at: new Date().toISOString(),
    export_package: {
      id: exportPackage.id,
      property_id: exportPackage.property_id,
      package_type: exportPackage.package_type,
      title: exportPackage.title,
      status: exportPackage.status,
      period_start: exportPackage.period_start,
      period_end: exportPackage.period_end,
      legally_authoritative: false,
      certified_submission: false,
      generated_by_uid: exportPackage.generated_by_uid || null,
      generated_at: exportPackage.generated_at,
    },
    legal_boundary: payload.legal_boundary || {
      legally_authoritative: false,
      certified_submission: false,
      notice: exportPackage.boundary_notice || LEGAL_BOUNDARY_NOTICE,
      out_of_scope: [
        'legally_significant_electronic_oss_voting',
        'certified_gis_zhkh_filing',
      ],
    },
    manifest: payload.packaging?.manifest || null,
    operational_evidence: payload.operational_evidence || null,
    integration_path: payload.integration_path || {
      current_mode: 'readiness_package_only',
      certified_submission_supported: false,
    },
    payload,
  };
  const serialized = stableJson(artifact, 2);
  const filename = payload.packaging?.artifact_filename
    || `gis-oss-${slugifyFilename(exportPackage.package_type)}-${exportPackage.id}.json`;

  return {
    filename,
    content_type: payload.packaging?.artifact_content_type || 'application/vnd.domhub.gis-oss-readiness+json',
    sha256: sha256Hex(serialized),
    byte_size: Buffer.byteLength(serialized, 'utf8'),
    artifact,
    serialized,
  };
}

async function auditExport(queryable, {
  propertyId,
  user,
  packageId,
  action,
  changes,
  ipAddress = null,
}) {
  await queryable.query(
    `INSERT INTO property_audit_log
       (property_id, actor_uid, actor_role, actor_type, entity_type, entity_id,
        action, resource_type, resource_id, changes, ip_address)
     VALUES ($1,$2,$3,'staff','gis_oss_export_package',$4,
             $5,'gis_oss_export_package',$4,$6,$7)`,
    [
      propertyId,
      user?.uid || null,
      user?.role || null,
      packageId,
      action,
      JSON.stringify(changes),
      ipAddress,
    ],
  );
}

async function createGisOssExportPackage(queryable, {
  propertyId,
  input = {},
  user = null,
  ipAddress = null,
}) {
  const packageType = normalizeEnum(input.package_type || input.packageType, PACKAGE_TYPES, 'package_type', 'oss_readiness');
  const title = normalizeText(input.title, 'title');
  const periodStart = normalizeDate(input.period_start || input.periodStart, 'period_start');
  const periodEnd = normalizeDate(input.period_end || input.periodEnd, 'period_end');
  if (periodStart && periodEnd && periodEnd < periodStart) {
    throw serviceError(400, 'period_end must be greater than or equal to period_start');
  }
  const documentIds = normalizeUuidList(input.document_ids || input.documentIds, 'document_ids');
  const announcementIds = normalizeUuidList(input.announcement_ids || input.announcementIds, 'announcement_ids');
  const protocolFiles = normalizeProtocolFiles(input.protocol_files || input.protocolFiles);
  const operationalRefs = normalizeOperationalRefs(input.operational_record_refs || input.operationalRecordRefs);

  const documents = await fetchDocuments(queryable, { propertyId, documentIds });
  const announcements = await fetchAnnouncements(queryable, { propertyId, announcementIds });
  const payload = buildExportPayload({
    propertyId,
    packageType,
    title,
    periodStart,
    periodEnd,
    documents,
    announcements,
    protocolFiles,
    operationalRefs,
  });

  const { rows } = await queryable.query(
    `INSERT INTO gis_oss_export_packages
       (property_id, package_type, title, status, period_start, period_end,
        document_ids, announcement_ids, protocol_files, operational_record_refs,
        export_payload, boundary_notice, generated_by_uid)
     VALUES ($1,$2,$3,'generated',$4,$5,$6::uuid[],$7::uuid[],$8::jsonb,$9::jsonb,$10::jsonb,$11,$12)
     RETURNING ${PACKAGE_COLS}`,
    [
      propertyId,
      packageType,
      title,
      periodStart,
      periodEnd,
      documentIds,
      announcementIds,
      JSON.stringify(protocolFiles),
      JSON.stringify(operationalRefs),
      JSON.stringify(payload),
      LEGAL_BOUNDARY_NOTICE,
      user?.uid || null,
    ],
  );
  const created = rows[0];

  await auditExport(queryable, {
    propertyId,
    user,
    packageId: created.id,
    action: 'gis_oss.export_package.generated',
    changes: {
      package_type: packageType,
      document_count: documents.length,
      announcement_count: announcements.length,
      protocol_file_count: protocolFiles.length,
      operational_ref_count: operationalRefs.length,
      legally_authoritative: false,
      certified_submission: false,
    },
    ipAddress,
  });

  return {
    export_package: created,
    payload,
    boundary_notice: LEGAL_BOUNDARY_NOTICE,
  };
}

async function listGisOssExportPackages(queryable, { propertyId, packageType = null, limit = 50 } = {}) {
  const params = [propertyId];
  const filters = ['property_id = $1'];
  if (packageType) {
    params.push(normalizeEnum(packageType, PACKAGE_TYPES, 'package_type', 'oss_readiness'));
    filters.push(`package_type = $${params.length}`);
  }
  params.push(Math.max(1, Math.min(Number(limit) || 50, 200)));

  const { rows } = await queryable.query(
    `SELECT ${PACKAGE_COLS}
       FROM gis_oss_export_packages
      WHERE ${filters.join(' AND ')}
      ORDER BY generated_at DESC
      LIMIT $${params.length}`,
    params,
  );
  return rows;
}

async function getGisOssExportPackage(queryable, { propertyId, packageId }) {
  const { rows } = await queryable.query(
    `SELECT ${PACKAGE_COLS}
       FROM gis_oss_export_packages
      WHERE property_id = $1 AND id = $2
      LIMIT 1`,
    [propertyId, packageId],
  );
  if (!rows[0]) throw serviceError(404, 'GIS/OSS export package not found');
  return rows[0];
}

module.exports = {
  LEGAL_BOUNDARY_NOTICE,
  PACKAGE_TYPES,
  GisOssReadinessServiceError,
  createGisOssExportPackage,
  buildGisOssExportArtifact,
  getGisOssExportPackage,
  isGisOssReadinessServiceError,
  listGisOssExportPackages,
};
