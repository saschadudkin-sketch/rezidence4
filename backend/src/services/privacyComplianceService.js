'use strict';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DATA_SUBJECT_REQUEST_TYPES = new Set(['export', 'delete', 'correct', 'restrict']);
const DATA_SUBJECT_REQUEST_STATUSES = new Set([
  'pending',
  'in_progress',
  'completed',
  'rejected',
  'cancelled',
]);
const COMPLIANCE_EVIDENCE_TYPES = new Set([
  'dsar_workflow',
  'retention_sweep',
  'data_localization',
  'ispdn_readiness',
  'no_biometrics_release_guard',
  'consent_history',
  'deletion_procedure',
]);
const COMPLIANCE_EVIDENCE_STATUSES = new Set(['draft', 'ready', 'reviewed', 'blocked']);

class PrivacyComplianceServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'PrivacyComplianceServiceError';
    this.status = status;
  }
}

function serviceError(status, message) {
  return new PrivacyComplianceServiceError(status, message);
}

function isPrivacyComplianceServiceError(err) {
  return err instanceof PrivacyComplianceServiceError;
}

function parseJsonObject(value) {
  if (typeof value === 'string') {
    try {
      return parseJsonObject(JSON.parse(value));
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

function normalizeEnum(value, allowed, fallback, field) {
  const normalized = value === undefined || value === null || value === ''
    ? fallback
    : String(value).trim();
  if (!normalized || !allowed.has(normalized)) {
    throw serviceError(400, `${field} must be one of: ${[...allowed].join(', ')}`);
  }
  return normalized;
}

function normalizeUuidOrNull(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim();
  if (!UUID_RE.test(normalized)) throw serviceError(400, `${field} must be UUID`);
  return normalized;
}

function normalizeStringOrNull(value, maxLen, field) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim();
  if (normalized.length > maxLen) throw serviceError(400, `${field} is too long`);
  return normalized || null;
}

function resolvePropertyId({ propertyId, user = {}, input = {} }) {
  const resolved = propertyId
    || input.property_id
    || input.propertyId
    || user.property_id
    || user.propertyId
    || null;
  if (!resolved) throw serviceError(400, 'property_id is required');
  if (!UUID_RE.test(String(resolved))) throw serviceError(400, 'property_id must be UUID');
  return String(resolved);
}

function subjectUidFor({ user = {}, input = {} }) {
  return normalizeStringOrNull(
    input.subject_uid || input.subjectUid || user.uid || null,
    120,
    'subject_uid',
  );
}

function mapDataSubjectRequestRow(row) {
  return {
    id: row.id,
    property_id: row.property_id,
    request_type: row.request_type,
    status: row.status,
    subject_uid: row.subject_uid || null,
    subject_resident_id: row.subject_resident_id || null,
    submitted_by_uid: row.submitted_by_uid || null,
    submitted_by_role: row.submitted_by_role || null,
    request_payload: parseJsonObject(row.request_payload),
    due_at: row.due_at || null,
    processed_by_uid: row.processed_by_uid || null,
    processed_at: row.processed_at || null,
    resolution_note: row.resolution_note || null,
    export_payload: parseJsonObject(row.export_payload),
    retention_decision: parseJsonObject(row.retention_decision),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

function mapComplianceEvidenceRow(row) {
  return {
    id: row.id,
    property_id: row.property_id,
    evidence_type: row.evidence_type,
    status: row.status,
    summary: row.summary || null,
    artifact_uri: row.artifact_uri || null,
    evidence: parseJsonObject(row.evidence),
    recorded_by_uid: row.recorded_by_uid || null,
    reviewed_at: row.reviewed_at || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

async function createDataSubjectRequest({
  queryable,
  user,
  propertyId = null,
  input = {},
}) {
  const requestType = normalizeEnum(
    input.type || input.request_type || input.requestType,
    DATA_SUBJECT_REQUEST_TYPES,
    null,
    'request_type',
  );
  const resolvedPropertyId = resolvePropertyId({ propertyId, user, input });
  const subjectUid = subjectUidFor({ user, input });
  const subjectResidentId = normalizeUuidOrNull(
    input.subject_resident_id || input.subjectResidentId,
    'subject_resident_id',
  );
  if (!subjectUid && !subjectResidentId) {
    throw serviceError(400, 'subject_uid or subject_resident_id is required');
  }

  const details = normalizeStringOrNull(input.details || input.reason || input.note, 2000, 'details');
  const requestedAction = normalizeStringOrNull(
    input.requested_action || input.requestedAction,
    200,
    'requested_action',
  );
  const payload = {
    details,
    requested_action: requestedAction,
    correction: parseJsonObject(input.correction),
    source: input.source || 'resident_ui',
  };

  const { rows } = await queryable.query(
    `INSERT INTO privacy_data_subject_requests
       (property_id, request_type, subject_uid, subject_resident_id,
        submitted_by_uid, submitted_by_role, request_payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
     RETURNING *`,
    [
      resolvedPropertyId,
      requestType,
      subjectUid,
      subjectResidentId,
      user?.uid || null,
      user?.role || null,
      JSON.stringify(payload),
    ],
  );
  return mapDataSubjectRequestRow(rows[0]);
}

async function listDataSubjectRequests({
  queryable,
  propertyId,
  user,
  filters = {},
  isAdmin = false,
  limit = 50,
}) {
  const clauses = ['property_id = $1'];
  const params = [propertyId];
  if (!isAdmin) {
    params.push(user?.uid || null);
    clauses.push(`(subject_uid = $${params.length} OR submitted_by_uid = $${params.length})`);
  }
  if (filters.status) {
    const status = normalizeEnum(filters.status, DATA_SUBJECT_REQUEST_STATUSES, null, 'status');
    params.push(status);
    clauses.push(`status = $${params.length}`);
  }
  if (filters.request_type || filters.type) {
    const type = normalizeEnum(
      filters.request_type || filters.type,
      DATA_SUBJECT_REQUEST_TYPES,
      null,
      'request_type',
    );
    params.push(type);
    clauses.push(`request_type = $${params.length}`);
  }
  params.push(Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 50)));
  const limitIdx = params.length;

  const { rows } = await queryable.query(
    `SELECT *
       FROM privacy_data_subject_requests
      WHERE ${clauses.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT $${limitIdx}`,
    params,
  );
  return rows.map(mapDataSubjectRequestRow);
}

async function completeDataSubjectRequest({
  queryable,
  requestId,
  user,
  input = {},
}) {
  const id = normalizeUuidOrNull(requestId, 'request_id');
  const status = normalizeEnum(
    input.status,
    DATA_SUBJECT_REQUEST_STATUSES,
    'completed',
    'status',
  );
  if (status === 'pending') throw serviceError(400, 'status must move forward from pending');

  const resolutionNote = normalizeStringOrNull(
    input.resolution_note || input.resolutionNote || input.note,
    2000,
    'resolution_note',
  );
  const exportPayload = parseJsonObject(input.export_payload || input.exportPayload);
  const retentionDecision = parseJsonObject(input.retention_decision || input.retentionDecision);

  const { rows } = await queryable.query(
    `UPDATE privacy_data_subject_requests
        SET status = $2,
            processed_by_uid = $3,
            processed_at = NOW(),
            resolution_note = $4,
            export_payload = $5::jsonb,
            retention_decision = $6::jsonb,
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [
      id,
      status,
      user?.uid || null,
      resolutionNote,
      JSON.stringify(exportPayload),
      JSON.stringify(retentionDecision),
    ],
  );
  if (!rows[0]) throw serviceError(404, 'data subject request not found');
  return mapDataSubjectRequestRow(rows[0]);
}

async function buildDataSubjectExport({
  queryable,
  user,
  propertyId,
  subjectResidentId = null,
}) {
  const residentId = normalizeUuidOrNull(subjectResidentId, 'subject_resident_id');
  const residentsParams = residentId
    ? [propertyId, residentId]
    : [propertyId, user?.uid || null];
  const residentsWhere = residentId
    ? 'property_id = $1 AND id = $2'
    : 'property_id = $1 AND external_uid = $2';

  const residents = await queryable.query(
    `SELECT id, external_uid, property_id, unit_id, full_name, phone, email,
            resident_type, is_active, consent_given_at, consent_version,
            created_at, updated_at
       FROM residents
      WHERE ${residentsWhere}`,
    residentsParams,
  );
  const subjectUid = residentId
    ? (residents.rows[0]?.external_uid || null)
    : (user?.uid || null);
  const users = subjectUid
    ? await queryable.query(
      `SELECT uid, name, phone, apartment, role, consent_accepted_at,
              consent_version, anonymized_at, deleted_at, updated_at
         FROM users
        WHERE uid = $1`,
      [subjectUid],
    )
    : { rows: [] };

  const residentIds = residents.rows.map((row) => row.id);
  let consentHistory = { rows: [] };
  let lifecycleEvents = { rows: [] };
  let dsarRequests = { rows: [] };
  if (residentIds.length) {
    consentHistory = await queryable.query(
      `SELECT resident_id, consent_version, decision, source, actor_uid,
              evidence, created_at
         FROM resident_consent_history
        WHERE resident_id = ANY($1::uuid[])
        ORDER BY created_at DESC`,
      [residentIds],
    );
    lifecycleEvents = await queryable.query(
      `SELECT resident_id, event_type, actor_uid, actor_role, metadata, created_at
         FROM resident_lifecycle_events
        WHERE resident_id = ANY($1::uuid[])
        ORDER BY created_at DESC`,
      [residentIds],
    );
  }
  if (subjectUid) {
    dsarRequests = await queryable.query(
      `SELECT id, request_type, status, request_payload, due_at,
              processed_at, resolution_note, retention_decision, created_at
         FROM privacy_data_subject_requests
        WHERE property_id = $1 AND subject_uid = $2
        ORDER BY created_at DESC`,
      [propertyId, subjectUid],
    );
  }

  return {
    generated_at: new Date().toISOString(),
    property_id: propertyId,
    subject_uid: subjectUid,
    no_biometrics_release_guard: true,
    users: users.rows,
    residents: residents.rows,
    consent_history: consentHistory.rows.map((row) => ({
      ...row,
      evidence: parseJsonObject(row.evidence),
    })),
    lifecycle_events: lifecycleEvents.rows.map((row) => ({
      ...row,
      metadata: parseJsonObject(row.metadata),
    })),
    data_subject_requests: dsarRequests.rows.map((row) => ({
      ...row,
      request_payload: parseJsonObject(row.request_payload),
      retention_decision: parseJsonObject(row.retention_decision),
    })),
  };
}

async function recordComplianceEvidence({
  queryable,
  user,
  propertyId,
  input = {},
}) {
  const evidenceType = normalizeEnum(
    input.evidence_type || input.evidenceType || input.type,
    COMPLIANCE_EVIDENCE_TYPES,
    null,
    'evidence_type',
  );
  const status = normalizeEnum(
    input.status,
    COMPLIANCE_EVIDENCE_STATUSES,
    'ready',
    'status',
  );
  const summary = normalizeStringOrNull(input.summary, 2000, 'summary');
  const artifactUri = normalizeStringOrNull(input.artifact_uri || input.artifactUri, 500, 'artifact_uri');
  const evidence = parseJsonObject(input.evidence);

  const { rows } = await queryable.query(
    `INSERT INTO privacy_compliance_evidence
       (property_id, evidence_type, status, summary, artifact_uri,
        evidence, recorded_by_uid, reviewed_at)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,
             CASE WHEN $3 = 'reviewed' THEN NOW() ELSE NULL END)
     RETURNING *`,
    [
      propertyId,
      evidenceType,
      status,
      summary,
      artifactUri,
      JSON.stringify(evidence),
      user?.uid || null,
    ],
  );
  return mapComplianceEvidenceRow(rows[0]);
}

async function listComplianceEvidence({
  queryable,
  propertyId,
  filters = {},
  limit = 50,
}) {
  const clauses = ['property_id = $1'];
  const params = [propertyId];
  if (filters.evidence_type || filters.type) {
    const type = normalizeEnum(
      filters.evidence_type || filters.type,
      COMPLIANCE_EVIDENCE_TYPES,
      null,
      'evidence_type',
    );
    params.push(type);
    clauses.push(`evidence_type = $${params.length}`);
  }
  if (filters.status) {
    const status = normalizeEnum(filters.status, COMPLIANCE_EVIDENCE_STATUSES, null, 'status');
    params.push(status);
    clauses.push(`status = $${params.length}`);
  }
  params.push(Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 50)));
  const limitIdx = params.length;

  const { rows } = await queryable.query(
    `SELECT *
       FROM privacy_compliance_evidence
      WHERE ${clauses.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT $${limitIdx}`,
    params,
  );
  return rows.map(mapComplianceEvidenceRow);
}

async function getPrivacyReadinessSummary({ queryable, propertyId }) {
  const [requestCounts, evidenceRows] = await Promise.all([
    queryable.query(
      `SELECT request_type, status, COUNT(*)::int AS count
         FROM privacy_data_subject_requests
        WHERE property_id = $1
        GROUP BY request_type, status
        ORDER BY request_type, status`,
      [propertyId],
    ),
    queryable.query(
      `SELECT DISTINCT ON (evidence_type) *
         FROM privacy_compliance_evidence
        WHERE property_id = $1
        ORDER BY evidence_type, created_at DESC`,
      [propertyId],
    ),
  ]);

  const latestEvidence = evidenceRows.rows.map(mapComplianceEvidenceRow);
  const evidenceByType = Object.fromEntries(
    latestEvidence.map((row) => [row.evidence_type, row]),
  );

  return {
    property_id: propertyId,
    data_subject_requests: requestCounts.rows,
    latest_evidence: evidenceByType,
    controls: {
      dsar_workflow: Boolean(evidenceByType.dsar_workflow),
      retention_sweep: Boolean(evidenceByType.retention_sweep),
      data_localization: Boolean(evidenceByType.data_localization),
      ispdn_readiness: Boolean(evidenceByType.ispdn_readiness),
      no_biometrics_release_guard: Boolean(evidenceByType.no_biometrics_release_guard),
    },
  };
}

module.exports = {
  COMPLIANCE_EVIDENCE_STATUSES,
  COMPLIANCE_EVIDENCE_TYPES,
  DATA_SUBJECT_REQUEST_STATUSES,
  DATA_SUBJECT_REQUEST_TYPES,
  PrivacyComplianceServiceError,
  buildDataSubjectExport,
  completeDataSubjectRequest,
  createDataSubjectRequest,
  getPrivacyReadinessSummary,
  isPrivacyComplianceServiceError,
  listComplianceEvidence,
  listDataSubjectRequests,
  recordComplianceEvidence,
  resolvePropertyId,
};
