'use strict';

const { formatRequestRow } = require('../../services/requests/RequestFormatter');
const { ADMIN_ROLES, FINAL_ROLES, normalizeRole } = require('../lib/authz');

const TERMINAL_STATUSES = new Set(['completed', 'cancelled', 'rejected', 'expired']);
const ASSIGN_STATUSES = new Set([
  'pending', 'scheduled', 'new', 'triaged', 'accepted', 'assigned',
  'waiting_contractor', 'waiting_parts',
]);
const START_STATUSES = new Set(['accepted', 'assigned', 'waiting_parts']);
const WAITING_STATUSES = new Set(['waiting_parts']);
const VALID_STATUSES = new Set([
  'pending', 'approved', 'accepted', 'arrived', 'cancelled', 'scheduled',
  'expired', 'completed', 'rejected', 'new', 'triaged', 'assigned',
  'in_progress', 'waiting_resident', 'waiting_parts', 'waiting_contractor',
  'resolved',
]);
const VALID_QUEUES = new Set([
  'active', 'mine', 'in_progress', 'waiting', 'waiting_assignment', 'resolved', 'all',
]);
const VALID_PRIORITIES = new Set(['low', 'normal', 'high', 'emergency']);
const VALID_TARGET_TYPES = new Set([
  'unit', 'home', 'access_zone', 'access_point', 'common_territory', 'road', 'service_area',
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_REQUEST_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_NOTE_LENGTH = 2000;

class ContractorWorkspaceServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ContractorWorkspaceServiceError';
    this.status = status;
  }
}

function serviceError(status, message) {
  return new ContractorWorkspaceServiceError(status, message);
}

function isContractorWorkspaceServiceError(err) {
  return err instanceof ContractorWorkspaceServiceError;
}

function addParam(params, value) {
  params.push(value);
  return params.length;
}

function isAdminUser(user) {
  return ADMIN_ROLES.has(normalizeRole(user?.role));
}

function isConciergeUser(user) {
  return normalizeRole(user?.role) === FINAL_ROLES.CONCIERGE;
}

function isContractorUser(user) {
  return normalizeRole(user?.role) === FINAL_ROLES.CONTRACTOR;
}

function validateRequestId(id) {
  const value = String(id || '');
  if (!UUID_RE.test(value) && !SAFE_REQUEST_ID_RE.test(value)) {
    throw serviceError(400, 'Invalid request id');
  }
  return value;
}

function validateUuid(value, fieldName) {
  const normalized = String(value || '').trim();
  if (!UUID_RE.test(normalized)) throw serviceError(400, `${fieldName} must be UUID`);
  return normalized;
}

function normalizeCsv(value) {
  return String(value || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseStatuses(value) {
  if (value === undefined || value === null || value === '') return null;
  const statuses = normalizeCsv(value);
  if (!statuses.length || statuses.some((status) => !VALID_STATUSES.has(status))) {
    throw serviceError(400, 'Invalid status filter');
  }
  return statuses;
}

function parseEnum(value, validValues, fieldName) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim();
  if (!validValues.has(normalized)) throw serviceError(400, `Invalid ${fieldName}`);
  return normalized;
}

function normalizeNote(value, { required = false, fieldName = 'note' } = {}) {
  const text = String(value || '').trim();
  if (!text) {
    if (required) throw serviceError(400, `${fieldName} is required`);
    return null;
  }
  if (text.length > MAX_NOTE_LENGTH) {
    throw serviceError(400, `${fieldName} must be ${MAX_NOTE_LENGTH} characters or less`);
  }
  return text;
}

function normalizeAttachmentIds(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw serviceError(400, 'attachmentIds must be an array');
  const ids = value.map((id) => String(id || '').trim()).filter(Boolean);
  if (ids.length !== value.length || ids.some((id) => !UUID_RE.test(id))) {
    throw serviceError(400, 'attachmentIds must contain valid UUIDs');
  }
  return ids;
}

function normalizeRequiresFollowUp(value) {
  if (value === undefined || value === null) return false;
  if (typeof value !== 'boolean') throw serviceError(400, 'requiresFollowUp must be boolean');
  return value;
}

function isOverdue(row) {
  const now = Date.now();
  const firstResponseDue = row.first_response_due_at ? new Date(row.first_response_due_at).getTime() : null;
  const resolutionDue = row.resolution_due_at ? new Date(row.resolution_due_at).getTime() : null;
  return row.sla_state === 'escalated'
    || row.sla_state === 'emergency_escalated'
    || (firstResponseDue && !row.first_response_at && firstResponseDue < now)
    || (resolutionDue && !row.resolved_at && !row.completed_at && resolutionDue < now);
}

function dueAt(row) {
  if (row.first_response_due_at && !row.first_response_at) return row.first_response_due_at;
  if (row.resolution_due_at && !row.resolved_at && !row.completed_at) return row.resolution_due_at;
  return row.resolution_due_at || row.first_response_due_at || null;
}

function formatContractorProfile(row) {
  if (!row?.contractor_user_id && !row?.id) return null;
  return {
    id: row.contractor_user_id || row.id,
    uid: row.contractor_external_uid || row.external_uid || null,
    fullName: row.contractor_full_name || row.full_name || null,
    companyId: row.contractor_company_id,
    companyName: row.contractor_company_name || row.company_name || null,
    companyStatus: row.contractor_company_status || row.company_status || null,
    accessExpiresAt: row.contractor_access_expires_at || row.access_expires_at || null,
  };
}

function rowAssignedToContractor(row, contractor) {
  if (!row || row.assigned_to_role !== 'contractor' || !contractor) return false;
  if (row.assigned_contractor_user_id && String(row.assigned_contractor_user_id) === String(contractor.id)) {
    return true;
  }
  return !row.assigned_contractor_user_id
    && contractor.externalUid
    && row.assigned_to_uid === contractor.externalUid;
}

function canStartRow(user, row, contractor) {
  return (isAdminUser(user) || rowAssignedToContractor(row, contractor))
    && row.assigned_to_role === 'contractor'
    && START_STATUSES.has(row.status);
}

function canWaitRow(user, row, contractor) {
  return (isAdminUser(user) || rowAssignedToContractor(row, contractor))
    && row.assigned_to_role === 'contractor'
    && row.status === 'in_progress';
}

function canResolveRow(user, row, contractor) {
  return (isAdminUser(user) || rowAssignedToContractor(row, contractor))
    && row.assigned_to_role === 'contractor'
    && row.status === 'in_progress';
}

function assertReadRole(user) {
  if (!isContractorUser(user) && !isConciergeUser(user) && !isAdminUser(user)) {
    throw serviceError(403, 'Forbidden');
  }
}

function assertAssignRole(user) {
  if (!isConciergeUser(user) && !isAdminUser(user)) throw serviceError(403, 'Forbidden');
}

function assertWorkRole(user) {
  if (!isContractorUser(user) && !isAdminUser(user)) throw serviceError(403, 'Forbidden');
}

function assertCanViewRequest(user, row, contractor) {
  assertReadRole(user);
  if (isAdminUser(user) || isConciergeUser(user)) {
    if (row.assigned_to_role === 'contractor' || row.status === 'waiting_contractor') return;
    throw serviceError(403, 'Forbidden');
  }
  if (rowAssignedToContractor(row, contractor)) return;
  throw serviceError(403, 'Forbidden');
}

function assertAssignedToActorOrAdmin(user, row, contractor) {
  assertWorkRole(user);
  if (isAdminUser(user)) return;
  if (rowAssignedToContractor(row, contractor)) return;
  throw serviceError(403, 'Forbidden');
}

function formatContractorRequest(row, { contractor = null } = {}) {
  const assignedContractor = formatContractorProfile(row)
    || (contractor && rowAssignedToContractor(row, contractor) ? {
      id: contractor.id,
      uid: contractor.externalUid,
      fullName: contractor.fullName,
      companyId: contractor.companyId,
      companyName: contractor.companyName,
      companyStatus: contractor.companyStatus,
      accessExpiresAt: contractor.accessExpiresAt,
    } : null);

  return {
    ...formatRequestRow(row),
    dueAt: dueAt(row),
    isOverdue: Boolean(isOverdue(row)),
    resident: {
      id: row.resident_id || null,
      uid: row.created_by_uid || null,
      name: row.created_by_name || null,
      apt: row.created_by_apt || null,
    },
    contractor: assignedContractor,
    workflow: {
      canStart: Boolean(row.assigned_to_role === 'contractor' && (row.status === 'accepted' || row.status === 'assigned')),
      canResume: Boolean(row.assigned_to_role === 'contractor' && WAITING_STATUSES.has(row.status)),
      canWait: Boolean(row.assigned_to_role === 'contractor' && row.status === 'in_progress'),
      canResolve: Boolean(row.assigned_to_role === 'contractor' && row.status === 'in_progress'),
    },
    counters: {
      residentUpdates: Number(row.resident_updates_count || 0),
      contractorEvents: Number(row.contractor_events_count || 0),
    },
  };
}

function formatUpdateRow(row) {
  return {
    id: row.id,
    requestId: row.request_id,
    actorUid: row.actor_uid,
    actorName: row.actor_name,
    actorRole: row.actor_role,
    body: row.body,
    visibility: row.visibility,
    attachmentIds: row.attachment_ids || [],
    createdAt: row.created_at,
  };
}

function formatAttachmentRow(row) {
  return {
    id: row.id,
    requestId: row.request_id,
    uploadedByUid: row.uploaded_by_uid,
    fileUrl: row.file_url,
    fileKind: row.file_kind,
    visibility: row.visibility,
    metadata: row.metadata || {},
    createdAt: row.created_at,
  };
}

function formatSlaEventRow(row) {
  return {
    id: row.id,
    requestId: row.request_id,
    eventKey: row.event_key,
    eventType: row.event_type,
    severity: row.severity,
    dueAt: row.due_at,
    detectedAt: row.detected_at,
    metadata: row.metadata || {},
    createdAt: row.created_at,
  };
}

function formatContractorEventRow(row) {
  return {
    id: row.id,
    requestId: row.request_id,
    contractorUserId: row.contractor_user_id,
    contractorCompanyId: row.contractor_company_id,
    contractorUid: row.contractor_uid,
    actorUid: row.actor_uid,
    actorName: row.actor_name,
    actorRole: row.actor_role,
    eventType: row.event_type,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    metadata: row.metadata || {},
    createdAt: row.created_at,
  };
}

function normalizeContractorRow(row) {
  return {
    id: row.id,
    contractorUserId: row.id,
    companyId: row.contractor_company_id,
    contractorCompanyId: row.contractor_company_id,
    propertyId: row.property_id,
    fullName: row.full_name,
    externalUid: row.external_uid || null,
    accessExpiresAt: row.access_expires_at || null,
    companyName: row.company_name || null,
    companyStatus: row.company_status || null,
  };
}

function assertContractorOperable(row, { requireExternalUid = false } = {}) {
  if (!row) throw serviceError(404, 'Contractor user not found');
  if (row.company_status !== 'active') throw serviceError(409, 'Contractor company is not active');
  if (row.is_active === false) throw serviceError(409, 'Contractor user is inactive');
  if (row.access_expires_at && new Date(row.access_expires_at).getTime() <= Date.now()) {
    throw serviceError(409, 'Contractor access is expired');
  }
  if (requireExternalUid && !row.external_uid) {
    throw serviceError(409, 'Contractor user must have external_uid before assignment');
  }
}

async function loadContractorProfileForUser(queryable, user) {
  if (!isContractorUser(user)) return null;
  const { rows } = await queryable.query(
    `SELECT cu.id, cu.contractor_company_id, cu.property_id, cu.full_name,
            cu.external_uid, cu.access_expires_at, cu.is_active,
            cc.name AS company_name, cc.status AS company_status
       FROM contractor_users cu
       JOIN contractor_companies cc ON cc.id = cu.contractor_company_id
      WHERE cu.external_uid = $1
        AND cu.is_active = true
        AND (cu.access_expires_at IS NULL OR cu.access_expires_at > NOW())
      ORDER BY cu.created_at DESC
      LIMIT 2`,
    [user.uid],
  );
  if (rows.length > 1) throw serviceError(409, 'Ambiguous contractor profile');
  if (!rows[0]) throw serviceError(403, 'Contractor profile is inactive or expired');
  assertContractorOperable(rows[0]);
  return normalizeContractorRow(rows[0]);
}

async function loadAssignableContractor(queryable, contractorUserId) {
  const id = validateUuid(contractorUserId, 'contractorUserId');
  const { rows } = await queryable.query(
    `SELECT cu.id, cu.contractor_company_id, cu.property_id, cu.full_name,
            cu.external_uid, cu.access_expires_at, cu.is_active,
            cc.name AS company_name, cc.status AS company_status
       FROM contractor_users cu
       JOIN contractor_companies cc ON cc.id = cu.contractor_company_id
      WHERE cu.id = $1
      LIMIT 1`,
    [id],
  );
  assertContractorOperable(rows[0], { requireExternalUid: true });
  return normalizeContractorRow(rows[0]);
}

function addQueueScope(user, contractor, queue, sql, params) {
  if (isContractorUser(user)) {
    const idIdx = addParam(params, contractor.id);
    const uidIdx = addParam(params, contractor.externalUid || '');
    sql.push(`r.assigned_to_role = 'contractor'`);
    sql.push(`(
      r.assigned_contractor_user_id = $${idIdx}
      OR (
        r.assigned_contractor_user_id IS NULL
        AND r.assigned_to_uid = $${uidIdx}
      )
    )`);
    return;
  }

  if (queue !== 'all') {
    sql.push(`(r.assigned_to_role = 'contractor' OR r.status = 'waiting_contractor')`);
  }
}

function addQueueStatus(queue, explicitStatuses, sql, params) {
  if (explicitStatuses) {
    const idx = addParam(params, explicitStatuses);
    sql.push(`r.status = ANY($${idx}::text[])`);
    return;
  }

  if (queue === 'in_progress') {
    sql.push(`r.status = 'in_progress'`);
    return;
  }
  if (queue === 'waiting') {
    const idx = addParam(params, ['waiting_parts']);
    sql.push(`r.status = ANY($${idx}::text[])`);
    return;
  }
  if (queue === 'waiting_assignment') {
    sql.push(`r.status = 'waiting_contractor'`);
    return;
  }
  if (queue === 'resolved') {
    sql.push(`r.status = 'resolved'`);
    return;
  }
  if (queue !== 'all') {
    sql.push(`r.status NOT IN ('${[...TERMINAL_STATUSES].join("','")}')`);
  }
}

function buildQueueFilters(user, contractor, filters, params) {
  assertReadRole(user);
  const queue = parseEnum(
    filters.queue || (isContractorUser(user) ? 'mine' : 'active'),
    VALID_QUEUES,
    'queue',
  );
  const statuses = parseStatuses(filters.status);
  const sql = ['r.deleted_at IS NULL'];

  addQueueScope(user, contractor, queue, sql, params);
  addQueueStatus(queue, statuses, sql, params);

  const contractorUserId = filters.contractor_user_id || filters.contractorUserId || null;
  if (contractorUserId) {
    const idx = addParam(params, validateUuid(contractorUserId, 'contractor_user_id'));
    sql.push(`r.assigned_contractor_user_id = $${idx}`);
  }
  const contractorCompanyId = filters.contractor_company_id || filters.contractorCompanyId || null;
  if (contractorCompanyId) {
    const idx = addParam(params, validateUuid(contractorCompanyId, 'contractor_company_id'));
    sql.push(`r.assigned_contractor_company_id = $${idx}`);
  }
  const priority = parseEnum(filters.priority, VALID_PRIORITIES, 'priority');
  if (priority) {
    const idx = addParam(params, priority);
    sql.push(`r.priority = $${idx}`);
  }
  if (filters.category) {
    const idx = addParam(params, String(filters.category).trim());
    sql.push(`r.category = $${idx}`);
  }
  const targetType = parseEnum(filters.target_type || filters.targetType, VALID_TARGET_TYPES, 'target_type');
  if (targetType) {
    const idx = addParam(params, targetType);
    sql.push(`r.target_type = $${idx}`);
  }
  const targetId = filters.target_id || filters.targetId || filters.unit_id || filters.home_id
    || filters.access_zone_id || filters.access_point_id || null;
  if (targetId) {
    const idx = addParam(params, validateUuid(targetId, 'target_id'));
    sql.push(`r.target_id = $${idx}`);
  }
  if (filters.q) {
    const term = String(filters.q).trim();
    if (term.length < 2) throw serviceError(400, 'q must be at least 2 characters');
    const idx = addParam(params, `%${term}%`);
    sql.push(`(
      r.created_by_name ILIKE $${idx}
      OR r.comment ILIKE $${idx}
      OR r.resolution_note ILIKE $${idx}
      OR assigned_cu.full_name ILIKE $${idx}
      OR assigned_cc.name ILIKE $${idx}
    )`);
  }

  return sql;
}

async function listContractorQueue(queryable, { user, filters = {}, pagination }) {
  const contractor = await loadContractorProfileForUser(queryable, user);
  const params = [];
  const where = buildQueueFilters(user, contractor, filters, params).join(' AND ');
  const limitIdx = addParam(params, pagination.limit);
  const offsetIdx = addParam(params, pagination.offset);

  const { rows } = await queryable.query(
    `SELECT r.*,
            resident_ref.id AS resident_id,
            assigned_cu.id AS contractor_user_id,
            assigned_cu.full_name AS contractor_full_name,
            assigned_cu.external_uid AS contractor_external_uid,
            assigned_cu.access_expires_at AS contractor_access_expires_at,
            assigned_cc.id AS contractor_company_id,
            assigned_cc.name AS contractor_company_name,
            assigned_cc.status AS contractor_company_status,
            COUNT(*) OVER() AS total_count,
            COALESCE(ru.resident_updates_count, 0) AS resident_updates_count,
            COALESCE(ce.contractor_events_count, 0) AS contractor_events_count
       FROM requests r
       LEFT JOIN residents resident_ref ON resident_ref.external_uid = r.created_by_uid
       LEFT JOIN contractor_users assigned_cu ON assigned_cu.id = r.assigned_contractor_user_id
       LEFT JOIN contractor_companies assigned_cc
         ON assigned_cc.id = COALESCE(r.assigned_contractor_company_id, assigned_cu.contractor_company_id)
       LEFT JOIN (
         SELECT request_id, COUNT(*) AS resident_updates_count
           FROM request_updates
          WHERE visibility = 'resident'
          GROUP BY request_id
       ) ru ON ru.request_id = r.id
       LEFT JOIN (
         SELECT request_id, COUNT(*) AS contractor_events_count
           FROM request_contractor_events
          GROUP BY request_id
       ) ce ON ce.request_id = r.id
      WHERE ${where}
      ORDER BY
        CASE WHEN r.priority = 'emergency' OR r.sla_profile = 'emergency' THEN 0 ELSE 1 END,
        CASE
          WHEN r.status = 'in_progress' THEN 0
          WHEN r.status IN ('accepted','assigned') THEN 1
          WHEN r.status IN ('waiting_parts','waiting_contractor') THEN 2
          ELSE 3
        END,
        CASE
          WHEN r.first_response_at IS NULL THEN r.first_response_due_at
          WHEN r.resolved_at IS NULL AND r.completed_at IS NULL THEN r.resolution_due_at
          ELSE r.updated_at
        END ASC NULLS LAST,
        r.created_at DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params,
  );

  return {
    requests: rows.map((row) => formatContractorRequest(row, { contractor })),
    total: rows.length ? Number(rows[0].total_count || 0) : 0,
  };
}

async function loadBaseRequest(queryable, requestId) {
  const id = validateRequestId(requestId);
  const { rows } = await queryable.query(
    `SELECT r.*,
            resident_ref.id AS resident_id,
            assigned_cu.id AS contractor_user_id,
            assigned_cu.full_name AS contractor_full_name,
            assigned_cu.external_uid AS contractor_external_uid,
            assigned_cu.access_expires_at AS contractor_access_expires_at,
            assigned_cc.id AS contractor_company_id,
            assigned_cc.name AS contractor_company_name,
            assigned_cc.status AS contractor_company_status
       FROM requests r
       LEFT JOIN residents resident_ref ON resident_ref.external_uid = r.created_by_uid
       LEFT JOIN contractor_users assigned_cu ON assigned_cu.id = r.assigned_contractor_user_id
       LEFT JOIN contractor_companies assigned_cc
         ON assigned_cc.id = COALESCE(r.assigned_contractor_company_id, assigned_cu.contractor_company_id)
      WHERE r.id=$1 AND r.deleted_at IS NULL
      LIMIT 1`,
    [id],
  );
  if (!rows[0]) throw serviceError(404, 'Request not found');
  return rows[0];
}

async function loadContractorRequestDetail(queryable, { user, requestId }) {
  const contractor = await loadContractorProfileForUser(queryable, user);
  const row = await loadBaseRequest(queryable, requestId);
  assertCanViewRequest(user, row, contractor);
  const limited = isContractorUser(user);

  const [attachments, updates, internalComments, slaEvents, contractorEvents] = await Promise.all([
    queryable.query(
      `SELECT id, request_id, uploaded_by_uid, file_url, file_kind, visibility, metadata, created_at
         FROM request_attachments
        WHERE request_id=$1 ${limited ? "AND visibility='resident'" : ''}
        ORDER BY created_at ASC, id ASC`,
      [row.id],
    ),
    queryable.query(
      `SELECT id, request_id, actor_uid, actor_name, actor_role, body, visibility,
              attachment_ids, created_at
         FROM request_updates
        WHERE request_id=$1 AND visibility='resident'
        ORDER BY created_at ASC, id ASC`,
      [row.id],
    ),
    limited
      ? Promise.resolve({ rows: [] })
      : queryable.query(
        `SELECT id, request_id, actor_uid, actor_name, actor_role, body, visibility,
                attachment_ids, created_at
           FROM request_updates
          WHERE request_id=$1 AND visibility='internal'
          ORDER BY created_at ASC, id ASC`,
        [row.id],
      ),
    limited
      ? Promise.resolve({ rows: [] })
      : queryable.query(
        `SELECT id, request_id, event_key, event_type, severity, due_at, detected_at, metadata, created_at
           FROM request_sla_events
          WHERE request_id=$1
          ORDER BY detected_at DESC, id DESC`,
        [row.id],
      ),
    queryable.query(
      `SELECT id, request_id, contractor_user_id, contractor_company_id, contractor_uid,
              actor_uid, actor_name, actor_role, event_type, from_status, to_status,
              metadata, created_at
         FROM request_contractor_events
        WHERE request_id=$1
        ORDER BY created_at DESC, id DESC`,
      [row.id],
    ),
  ]);

  return {
    request: formatContractorRequest({
      ...row,
      resident_updates_count: updates.rows.length,
      contractor_events_count: contractorEvents.rows.length,
    }, { contractor }),
    attachments: attachments.rows.map(formatAttachmentRow),
    residentUpdates: updates.rows.map(formatUpdateRow),
    internalComments: internalComments.rows.map(formatUpdateRow),
    slaEvents: slaEvents.rows.map(formatSlaEventRow),
    contractorEvents: contractorEvents.rows.map(formatContractorEventRow),
  };
}

async function insertContractorEvent(queryable, {
  requestId,
  contractor,
  user,
  eventType,
  fromStatus,
  toStatus,
  metadata = {},
}) {
  await queryable.query(
    `INSERT INTO request_contractor_events
       (request_id, contractor_user_id, contractor_company_id, contractor_uid,
        actor_uid, actor_name, actor_role, event_type, from_status, to_status, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      requestId,
      contractor?.id || null,
      contractor?.companyId || contractor?.contractorCompanyId || null,
      contractor?.externalUid || contractor?.uid || null,
      user.uid,
      user.name || null,
      user.role || null,
      eventType,
      fromStatus || null,
      toStatus,
      metadata,
    ],
  );
}

async function insertInternalUpdate(queryable, { requestId, user, body, attachmentIds = [] }) {
  if (!body) return null;
  const { rows } = await queryable.query(
    `INSERT INTO request_updates
       (request_id, actor_uid, actor_name, actor_role, body, visibility, attachment_ids)
     VALUES ($1,$2,$3,$4,$5,'internal',$6::uuid[])
     RETURNING id, request_id, actor_uid, actor_name, actor_role, body, visibility,
               attachment_ids, created_at`,
    [requestId, user.uid, user.name || null, user.role || null, body, attachmentIds],
  );
  return rows[0] ? formatUpdateRow(rows[0]) : null;
}

async function assignContractor(queryable, { user, requestId, body = {} }) {
  assertAssignRole(user);
  const current = await loadBaseRequest(queryable, requestId);
  if (!ASSIGN_STATUSES.has(current.status)) throw serviceError(409, 'Request cannot be assigned to contractor');
  if (current.assigned_to_role && current.assigned_to_role !== 'contractor' && current.status !== 'waiting_contractor') {
    throw serviceError(409, 'Request is assigned to another role');
  }

  const contractor = await loadAssignableContractor(
    queryable,
    body.contractorUserId || body.contractor_user_id,
  );
  const note = normalizeNote(body.note || body.body || body.comment);

  if (current.assigned_contractor_user_id
    && String(current.assigned_contractor_user_id) === String(contractor.id)
    && current.assigned_to_role === 'contractor') {
    return formatContractorRequest(current, { contractor });
  }

  const { rows } = await queryable.query(
    `UPDATE requests
        SET assigned_to_uid=$1,
            assigned_to_name=$2,
            assigned_to_role='contractor',
            assigned_contractor_user_id=$3,
            assigned_contractor_company_id=$4,
            assigned_at=NOW(),
            status=CASE
              WHEN status IN ('pending','scheduled','new','triaged','waiting_contractor','waiting_parts')
                THEN 'assigned'
              ELSE status
            END,
            updated_at=NOW()
      WHERE id=$5
        AND deleted_at IS NULL
        AND status = ANY($6::text[])
      RETURNING *`,
    [
      contractor.externalUid,
      contractor.fullName || contractor.externalUid,
      contractor.id,
      contractor.companyId,
      current.id,
      [...ASSIGN_STATUSES],
    ],
  );
  if (!rows[0]) throw serviceError(409, 'Request changed since it was loaded');

  await insertInternalUpdate(queryable, { requestId: rows[0].id, user, body: note });
  await insertContractorEvent(queryable, {
    requestId: rows[0].id,
    contractor,
    user,
    eventType: 'assigned',
    fromStatus: current.status,
    toStatus: rows[0].status,
    metadata: {
      contractor_company_id: contractor.companyId,
      note_present: Boolean(note),
    },
  });

  return formatContractorRequest(rows[0], { contractor });
}

async function startRequest(queryable, { user, requestId }) {
  const contractor = await loadContractorProfileForUser(queryable, user);
  const current = await loadBaseRequest(queryable, requestId);
  assertAssignedToActorOrAdmin(user, current, contractor);
  if (!canStartRow(user, current, contractor)) throw serviceError(409, 'Request cannot be started');
  const eventType = WAITING_STATUSES.has(current.status) ? 'resumed' : 'started';
  const actorContractorId = isAdminUser(user) ? null : contractor.id;
  const actorContractorUid = isAdminUser(user) ? null : contractor.externalUid;

  const { rows } = await queryable.query(
    `UPDATE requests
        SET status='in_progress',
            assigned_contractor_user_id=COALESCE(assigned_contractor_user_id, $4::uuid),
            assigned_contractor_company_id=COALESCE(assigned_contractor_company_id, $5::uuid),
            started_at=COALESCE(started_at, NOW()),
            first_response_at=COALESCE(first_response_at, NOW()),
            sla_state=CASE WHEN sla_state='on_track' THEN 'responded' ELSE sla_state END,
            updated_at=NOW()
      WHERE id=$1
        AND deleted_at IS NULL
        AND assigned_to_role='contractor'
        AND status = ANY($2::text[])
        AND (
          $3::uuid IS NULL
          OR assigned_contractor_user_id=$3
          OR (assigned_contractor_user_id IS NULL AND assigned_to_uid=$6)
        )
      RETURNING *`,
    [
      current.id,
      [...START_STATUSES],
      actorContractorId,
      actorContractorId,
      isAdminUser(user) ? null : contractor.companyId,
      actorContractorUid,
    ],
  );
  if (!rows[0]) throw serviceError(409, 'Request changed since it was loaded');

  await insertContractorEvent(queryable, {
    requestId: rows[0].id,
    contractor: contractor || {
      id: rows[0].assigned_contractor_user_id,
      companyId: rows[0].assigned_contractor_company_id,
      externalUid: rows[0].assigned_to_uid,
    },
    user,
    eventType,
    fromStatus: current.status,
    toStatus: rows[0].status,
  });

  return formatContractorRequest(rows[0], { contractor });
}

async function setWaitingStatus(queryable, { user, requestId, body = {} }) {
  const contractor = await loadContractorProfileForUser(queryable, user);
  const current = await loadBaseRequest(queryable, requestId);
  assertAssignedToActorOrAdmin(user, current, contractor);
  if (!canWaitRow(user, current, contractor)) throw serviceError(409, 'Request must be in progress');
  const actorContractorId = isAdminUser(user) ? null : contractor.id;
  const reason = parseEnum(body.reason || 'parts', new Set(['parts']), 'reason');
  const note = normalizeNote(body.note || body.body || body.comment);

  const { rows } = await queryable.query(
    `UPDATE requests
        SET status='waiting_parts',
            updated_at=NOW()
      WHERE id=$1
        AND deleted_at IS NULL
        AND assigned_to_role='contractor'
        AND status='in_progress'
        AND ($2::uuid IS NULL OR assigned_contractor_user_id=$2)
      RETURNING *`,
    [current.id, actorContractorId],
  );
  if (!rows[0]) throw serviceError(409, 'Request changed since it was loaded');

  await insertInternalUpdate(queryable, { requestId: rows[0].id, user, body: note });
  await insertContractorEvent(queryable, {
    requestId: rows[0].id,
    contractor: contractor || {
      id: rows[0].assigned_contractor_user_id,
      companyId: rows[0].assigned_contractor_company_id,
      externalUid: rows[0].assigned_to_uid,
    },
    user,
    eventType: 'waiting_parts',
    fromStatus: current.status,
    toStatus: rows[0].status,
    metadata: { reason, note_present: Boolean(note) },
  });

  return formatContractorRequest(rows[0], { contractor });
}

async function resolveRequest(queryable, { user, requestId, body = {} }) {
  const contractor = await loadContractorProfileForUser(queryable, user);
  const current = await loadBaseRequest(queryable, requestId);
  assertAssignedToActorOrAdmin(user, current, contractor);
  if (!canResolveRow(user, current, contractor)) throw serviceError(409, 'Request must be in progress');
  const actorContractorId = isAdminUser(user) ? null : contractor.id;

  const resolutionNote = normalizeNote(
    body.resolutionNote || body.resolution_note || body.note || body.body,
    { required: true, fieldName: 'resolutionNote' },
  );
  const requiresFollowUp = normalizeRequiresFollowUp(
    body.requiresFollowUp ?? body.requires_follow_up,
  );
  const attachmentIds = normalizeAttachmentIds(body.attachmentIds || body.attachment_ids);

  const { rows } = await queryable.query(
    `UPDATE requests
        SET status='resolved',
            resolved_at=COALESCE(resolved_at, NOW()),
            resolution_note=$1,
            requires_follow_up=$2,
            sla_state='resolved',
            updated_at=NOW()
      WHERE id=$3
        AND deleted_at IS NULL
        AND assigned_to_role='contractor'
        AND status='in_progress'
        AND ($4::uuid IS NULL OR assigned_contractor_user_id=$4)
      RETURNING *`,
    [resolutionNote, requiresFollowUp, current.id, actorContractorId],
  );
  if (!rows[0]) throw serviceError(409, 'Request changed since it was loaded');

  await insertInternalUpdate(queryable, {
    requestId: rows[0].id,
    user,
    body: resolutionNote,
    attachmentIds,
  });
  await insertContractorEvent(queryable, {
    requestId: rows[0].id,
    contractor: contractor || {
      id: rows[0].assigned_contractor_user_id,
      companyId: rows[0].assigned_contractor_company_id,
      externalUid: rows[0].assigned_to_uid,
    },
    user,
    eventType: 'resolved',
    fromStatus: current.status,
    toStatus: rows[0].status,
    metadata: {
      requires_follow_up: requiresFollowUp,
      attachment_count: attachmentIds.length,
    },
  });

  return formatContractorRequest(rows[0], { contractor });
}

module.exports = {
  ContractorWorkspaceServiceError,
  isContractorWorkspaceServiceError,
  listContractorQueue,
  loadContractorRequestDetail,
  assignContractor,
  startRequest,
  setWaitingStatus,
  resolveRequest,
};
