'use strict';

const { resolveStaffIdByUid } = require('./accessActorResolver');

const EVIDENCE_TYPES = Object.freeze(['clip', 'snapshot', 'event_reference', 'camera_context', 'unavailable']);
const EVIDENCE_SOURCES = Object.freeze(['manual', 'provider', 'webhook', 'system']);
const EVIDENCE_STATUSES = Object.freeze(['linked', 'unavailable', 'expired', 'removed']);
const SENSITIVITY_LEVELS = Object.freeze(['restricted', 'sensitive']);

const VIDEO_EVIDENCE_COLS = `
  id, property_id, access_incident_id, visit_log_id, skud_integration_event_id,
  camera_device_id, provider_config_id, evidence_type, source, status, title,
  clip_url, snapshot_url, external_ref, video_provider_event_id,
  video_timestamp_from, video_timestamp_to, sensitivity, metadata,
  biometric_identity_matching, created_by_staff_id, created_at, updated_at
`;

const CAMERA_COLS = `
  d.id, d.property_id, d.provider_config_id, d.access_point_id, d.device_class,
  d.name, d.external_device_id, d.source_of_truth, d.fallback_rule, d.direction,
  d.status, d.metadata, d.last_seen_at, d.created_at, d.updated_at,
  pc.provider, pc.display_name AS provider_display_name, pc.health_status AS provider_health_status
`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class VideoEvidenceServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'VideoEvidenceServiceError';
    this.status = status;
  }
}

function serviceError(status, message) {
  return new VideoEvidenceServiceError(status, message);
}

function isVideoEvidenceServiceError(err) {
  return err instanceof VideoEvidenceServiceError;
}

function isValidUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

function requireUuid(value, field) {
  if (!isValidUuid(value)) throw serviceError(400, `${field} must be UUID`);
  return value;
}

function normalizeNullableUuid(value, field) {
  if (value === undefined || value === null || value === '') return null;
  return requireUuid(String(value), field);
}

function normalizeEnum(value, allowed, field, fallback = null) {
  const raw = value === undefined || value === null || value === ''
    ? fallback
    : String(value).trim().toLowerCase();
  if (!raw || !allowed.includes(raw)) {
    throw serviceError(400, `${field} must be one of: ${allowed.join(', ')}`);
  }
  return raw;
}

function normalizeNullableText(value, field, maxLen = 500) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw serviceError(400, `${field} must be string or null`);
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLen) throw serviceError(400, `${field} is too long`);
  return trimmed;
}

function normalizeTimestamp(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw serviceError(400, `${field} must be an ISO timestamp`);
  return date.toISOString();
}

function normalizeUrl(value, field) {
  const text = normalizeNullableText(value, field, 2048);
  if (!text) return null;
  if (text.startsWith('/') && !text.startsWith('//')) return text;
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('unsupported protocol');
    }
    return text;
  } catch {
    throw serviceError(400, `${field} must be http(s) URL or local absolute path`);
  }
}

function normalizeJsonObject(value, field) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw serviceError(400, `${field} must be object`);
  }
  return value;
}

function assertNoBiometricUse(input) {
  const metadata = normalizeJsonObject(input.metadata, 'metadata');
  const biometricFlag =
    input.biometric_identity_matching
    || input.biometricIdentityMatching
    || metadata.biometric_identity_matching
    || metadata.biometricIdentityMatching
    || metadata.face_recognition
    || metadata.faceRecognition;
  if (biometricFlag === true || biometricFlag === 'true') {
    throw serviceError(400, 'Video evidence cannot enable biometric identity matching');
  }
  return metadata;
}

function inferEvidenceType({ evidenceType, clipUrl, snapshotUrl, externalRef, videoProviderEventId, cameraDeviceId, status }) {
  if (evidenceType) return normalizeEnum(evidenceType, EVIDENCE_TYPES, 'evidence_type');
  if (status === 'unavailable') return 'unavailable';
  if (clipUrl) return 'clip';
  if (snapshotUrl) return 'snapshot';
  if (videoProviderEventId || externalRef) return 'event_reference';
  if (cameraDeviceId) return 'camera_context';
  return 'unavailable';
}

function hasReference(input) {
  return Boolean(
    input.clipUrl
    || input.snapshotUrl
    || input.externalRef
    || input.videoProviderEventId
    || input.cameraDeviceId
  );
}

async function requireStaffId(queryable, user) {
  const staffId = await resolveStaffIdByUid(queryable, user?.uid);
  if (!staffId) throw serviceError(403, 'Staff identity is not mapped to v1');
  return staffId;
}

async function ensureIncident(queryable, { propertyId, incidentId }) {
  if (!incidentId) return null;
  const { rows } = await queryable.query(
    `SELECT id, property_id, related_visit_log_id
       FROM access_incidents
      WHERE id = $1 AND property_id = $2
      LIMIT 1`,
    [incidentId, propertyId],
  );
  if (!rows[0]) throw serviceError(404, 'Access incident not found');
  return rows[0];
}

async function ensureVisitLog(queryable, { propertyId, visitLogId }) {
  if (!visitLogId) return null;
  const { rows } = await queryable.query(
    `SELECT id, property_id, access_point_id
       FROM visit_logs_v2
      WHERE id = $1 AND property_id = $2
      LIMIT 1`,
    [visitLogId, propertyId],
  );
  if (!rows[0]) throw serviceError(404, 'Visit log not found');
  return rows[0];
}

async function ensureSkudEvent(queryable, { propertyId, skudIntegrationEventId }) {
  if (!skudIntegrationEventId) return null;
  const { rows } = await queryable.query(
    `SELECT id, property_id, provider_config_id, access_point_id
       FROM skud_integration_events
      WHERE id = $1 AND property_id = $2
      LIMIT 1`,
    [skudIntegrationEventId, propertyId],
  );
  if (!rows[0]) throw serviceError(404, 'SKUD integration event not found');
  return rows[0];
}

async function ensureCameraDevice(queryable, { propertyId, cameraDeviceId }) {
  if (!cameraDeviceId) return null;
  const { rows } = await queryable.query(
    `SELECT id, property_id, provider_config_id, access_point_id, device_class,
            name, external_device_id, status
       FROM skud_hardware_devices
      WHERE id = $1 AND property_id = $2 AND device_class = 'camera'
      LIMIT 1`,
    [cameraDeviceId, propertyId],
  );
  if (!rows[0]) throw serviceError(404, 'Camera device not found');
  return rows[0];
}

async function writeAudit(queryable, {
  propertyId,
  user,
  staffId = null,
  action,
  evidenceId,
  changes,
  ipAddress = null,
}) {
  await queryable.query(
    `INSERT INTO property_audit_log
       (property_id, actor_uid, actor_role, actor_type, entity_type, entity_id,
        action, resource_type, resource_id, changes, ip_address)
     VALUES ($1,$2,$3,'staff','staff',$4,$5,'video_evidence_reference',$6,$7,$8)`,
    [
      propertyId,
      user?.uid || null,
      user?.role || null,
      staffId,
      action,
      evidenceId,
      changes ? JSON.stringify(changes) : null,
      ipAddress,
    ],
  );
}

async function listAccessPointCameras(queryable, { propertyId, accessPointId = null }) {
  requireUuid(propertyId, 'property_id');
  const params = [propertyId];
  const filters = [
    `d.property_id = $1`,
    `d.device_class = 'camera'`,
    `d.status <> 'disabled'`,
  ];
  if (accessPointId) {
    params.push(requireUuid(accessPointId, 'access_point_id'));
    filters.push(`d.access_point_id = $${params.length}`);
  }
  const { rows } = await queryable.query(
    `SELECT ${CAMERA_COLS}
       FROM skud_hardware_devices d
       LEFT JOIN skud_provider_configs pc
         ON pc.property_id = d.property_id AND pc.id = d.provider_config_id
      WHERE ${filters.join(' AND ')}
      ORDER BY d.access_point_id NULLS LAST, d.name ASC`,
    params,
  );
  return rows;
}

async function createVideoEvidenceReference(queryable, {
  propertyId,
  input,
  user,
  ipAddress = null,
}) {
  requireUuid(propertyId, 'property_id');
  const payload = input || {};
  const metadata = assertNoBiometricUse(payload);
  const accessIncidentId = normalizeNullableUuid(
    payload.access_incident_id || payload.accessIncidentId,
    'access_incident_id',
  );
  const explicitVisitLogId = normalizeNullableUuid(
    payload.visit_log_id || payload.visitLogId,
    'visit_log_id',
  );
  const skudIntegrationEventId = normalizeNullableUuid(
    payload.skud_integration_event_id || payload.skudIntegrationEventId,
    'skud_integration_event_id',
  );
  const cameraDeviceId = normalizeNullableUuid(
    payload.camera_device_id || payload.cameraDeviceId,
    'camera_device_id',
  );

  if (!accessIncidentId && !explicitVisitLogId && !skudIntegrationEventId) {
    throw serviceError(400, 'access_incident_id, visit_log_id or skud_integration_event_id is required');
  }

  const incident = await ensureIncident(queryable, { propertyId, incidentId: accessIncidentId });
  const visitLogId = explicitVisitLogId || incident?.related_visit_log_id || null;
  const [visitLog, skudEvent, camera] = await Promise.all([
    ensureVisitLog(queryable, { propertyId, visitLogId }),
    ensureSkudEvent(queryable, { propertyId, skudIntegrationEventId }),
    ensureCameraDevice(queryable, { propertyId, cameraDeviceId }),
  ]);

  const clipUrl = normalizeUrl(payload.clip_url || payload.clipUrl, 'clip_url');
  const snapshotUrl = normalizeUrl(payload.snapshot_url || payload.snapshotUrl, 'snapshot_url');
  const externalRef = normalizeNullableText(payload.external_ref || payload.externalRef, 'external_ref', 500);
  const videoProviderEventId = normalizeNullableText(
    payload.video_provider_event_id || payload.videoProviderEventId,
    'video_provider_event_id',
    200,
  );
  const status = normalizeEnum(payload.status, EVIDENCE_STATUSES, 'status', hasReference({
    clipUrl,
    snapshotUrl,
    externalRef,
    videoProviderEventId,
    cameraDeviceId,
  }) ? 'linked' : 'unavailable');
  const evidenceType = inferEvidenceType({
    evidenceType: payload.evidence_type || payload.evidenceType,
    clipUrl,
    snapshotUrl,
    externalRef,
    videoProviderEventId,
    cameraDeviceId,
    status,
  });

  const normalized = {
    propertyId,
    accessIncidentId,
    visitLogId,
    skudIntegrationEventId,
    cameraDeviceId,
    providerConfigId: normalizeNullableUuid(
      payload.provider_config_id || payload.providerConfigId || camera?.provider_config_id || skudEvent?.provider_config_id,
      'provider_config_id',
    ),
    evidenceType,
    source: normalizeEnum(payload.source, EVIDENCE_SOURCES, 'source', 'manual'),
    status,
    title: normalizeNullableText(payload.title, 'title', 160),
    clipUrl,
    snapshotUrl,
    externalRef,
    videoProviderEventId,
    videoTimestampFrom: normalizeTimestamp(payload.video_timestamp_from || payload.videoTimestampFrom, 'video_timestamp_from'),
    videoTimestampTo: normalizeTimestamp(payload.video_timestamp_to || payload.videoTimestampTo, 'video_timestamp_to'),
    sensitivity: normalizeEnum(payload.sensitivity, SENSITIVITY_LEVELS, 'sensitivity', 'restricted'),
    metadata,
  };

  if (normalized.videoTimestampFrom && normalized.videoTimestampTo
    && new Date(normalized.videoTimestampTo) < new Date(normalized.videoTimestampFrom)) {
    throw serviceError(400, 'video_timestamp_to must be after video_timestamp_from');
  }
  if (normalized.status !== 'unavailable' && !hasReference(normalized)) {
    throw serviceError(400, 'linked video evidence requires clip_url, snapshot_url, external_ref, video_provider_event_id or camera_device_id');
  }

  const staffId = await requireStaffId(queryable, user);
  const { rows } = await queryable.query(
    `INSERT INTO video_evidence_references
       (property_id, access_incident_id, visit_log_id, skud_integration_event_id,
        camera_device_id, provider_config_id, evidence_type, source, status, title,
        clip_url, snapshot_url, external_ref, video_provider_event_id,
        video_timestamp_from, video_timestamp_to, sensitivity, metadata,
        biometric_identity_matching, created_by_staff_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,FALSE,$19)
     RETURNING ${VIDEO_EVIDENCE_COLS}`,
    [
      normalized.propertyId,
      normalized.accessIncidentId,
      normalized.visitLogId,
      normalized.skudIntegrationEventId,
      normalized.cameraDeviceId,
      normalized.providerConfigId,
      normalized.evidenceType,
      normalized.source,
      normalized.status,
      normalized.title,
      normalized.clipUrl,
      normalized.snapshotUrl,
      normalized.externalRef,
      normalized.videoProviderEventId,
      normalized.videoTimestampFrom,
      normalized.videoTimestampTo,
      normalized.sensitivity,
      JSON.stringify(normalized.metadata),
      staffId,
    ],
  );
  const evidence = rows[0];

  await writeAudit(queryable, {
    propertyId,
    user,
    staffId,
    action: 'video.evidence.linked',
    evidenceId: evidence.id,
    changes: {
      access_incident_id: normalized.accessIncidentId,
      visit_log_id: normalized.visitLogId,
      skud_integration_event_id: normalized.skudIntegrationEventId,
      camera_device_id: normalized.cameraDeviceId,
      evidence_type: normalized.evidenceType,
      status: normalized.status,
      no_biometrics: true,
    },
    ipAddress,
  });

  return {
    evidence,
    incident,
    visit_log: visitLog,
    skud_event: skudEvent,
    camera,
  };
}

async function listIncidentVideoEvidence(queryable, { propertyId, incidentId }) {
  requireUuid(propertyId, 'property_id');
  requireUuid(incidentId, 'access_incident_id');
  await ensureIncident(queryable, { propertyId, incidentId });
  const { rows } = await queryable.query(
    `SELECT ${VIDEO_EVIDENCE_COLS}
       FROM video_evidence_references
      WHERE property_id = $1 AND access_incident_id = $2
      ORDER BY created_at DESC`,
    [propertyId, incidentId],
  );
  return rows;
}

async function getVideoEvidenceReference(queryable, {
  propertyId,
  evidenceId,
  user,
  ipAddress = null,
  recordView = true,
}) {
  requireUuid(propertyId, 'property_id');
  requireUuid(evidenceId, 'id');
  const { rows } = await queryable.query(
    `SELECT ${VIDEO_EVIDENCE_COLS}
       FROM video_evidence_references
      WHERE id = $1 AND property_id = $2
      LIMIT 1`,
    [evidenceId, propertyId],
  );
  if (!rows[0]) throw serviceError(404, 'Video evidence reference not found');

  if (recordView) {
    await writeAudit(queryable, {
      propertyId,
      user,
      action: 'video.evidence.viewed',
      evidenceId,
      changes: {
        access_incident_id: rows[0].access_incident_id,
        visit_log_id: rows[0].visit_log_id,
        sensitivity: rows[0].sensitivity,
      },
      ipAddress,
    });
  }

  return rows[0];
}

module.exports = {
  EVIDENCE_SOURCES,
  EVIDENCE_STATUSES,
  EVIDENCE_TYPES,
  SENSITIVITY_LEVELS,
  VIDEO_EVIDENCE_COLS,
  VideoEvidenceServiceError,
  createVideoEvidenceReference,
  getVideoEvidenceReference,
  isVideoEvidenceServiceError,
  listAccessPointCameras,
  listIncidentVideoEvidence,
};
