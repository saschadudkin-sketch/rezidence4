'use strict';

const { formatRequestRow } = require('../../services/requests/RequestFormatter');
const { ADMIN_ROLES, FINAL_ROLES, normalizeRole } = require('../lib/authz');

const TERMINAL_STATUSES = new Set(['completed', 'cancelled', 'rejected', 'expired']);
const PICKUP_STATUSES = new Set(['pending', 'scheduled', 'new', 'triaged', 'accepted', 'assigned']);
const START_STATUSES = new Set(['accepted', 'assigned', 'waiting_resident', 'waiting_parts']);
const WAITING_STATUSES = new Set(['waiting_resident', 'waiting_parts']);
const VALID_STATUSES = new Set([
  'pending', 'approved', 'accepted', 'arrived', 'cancelled', 'scheduled',
  'expired', 'completed', 'rejected', 'new', 'triaged', 'assigned',
  'in_progress', 'waiting_resident', 'waiting_parts', 'waiting_contractor',
  'resolved',
]);
const VALID_QUEUES = new Set(['active', 'mine', 'available', 'in_progress', 'waiting', 'resolved', 'all']);
const VALID_PRIORITIES = new Set(['low', 'normal', 'high', 'emergency']);
const VALID_WAITING_REASONS = new Set(['resident', 'parts']);
const VALID_TARGET_TYPES = new Set([
  'unit', 'home', 'access_zone', 'access_point', 'common_territory', 'road', 'service_area',
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_REQUEST_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_NOTE_LENGTH = 2000;

class TechnicianWorkspaceServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'TechnicianWorkspaceServiceError';
    this.status = status;
  }
}

function serviceError(status, message) {
  return new TechnicianWorkspaceServiceError(status, message);
}

function isTechnicianWorkspaceServiceError(err) {
  return err instanceof TechnicianWorkspaceServiceError;
}

function addParam(params, value) {
  params.push(value);
  return params.length;
}

function isAdminUser(user) {
  return ADMIN_ROLES.has(normalizeRole(user?.role));
}

function isTechnicianUser(user) {
  return normalizeRole(user?.role) === FINAL_ROLES.TECHNICIAN;
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

function canClaimRow(row) {
  return !row.assigned_to_uid
    && (!row.assigned_to_role || row.assigned_to_role === 'technician')
    && PICKUP_STATUSES.has(row.status);
}

function canStartRow(user, row) {
  return (isAdminUser(user) || row.assigned_to_uid === user?.uid)
    && row.assigned_to_role === 'technician'
    && START_STATUSES.has(row.status);
}

function canWaitRow(user, row) {
  return (isAdminUser(user) || row.assigned_to_uid === user?.uid)
    && row.assigned_to_role === 'technician'
    && row.status === 'in_progress';
}

function canResolveRow(user, row) {
  return (isAdminUser(user) || row.assigned_to_uid === user?.uid)
    && row.assigned_to_role === 'technician'
    && row.status === 'in_progress';
}

function assertReadRole(user) {
  if (!isTechnicianUser(user) && !isAdminUser(user)) throw serviceError(403, 'Forbidden');
}

function assertWorkRole(user) {
  if (!isTechnicianUser(user) && !isAdminUser(user)) throw serviceError(403, 'Forbidden');
}

function assertCanViewRequest(user, row) {
  assertReadRole(user);
  if (isAdminUser(user)) return;
  if (row.assigned_to_uid === user.uid && row.assigned_to_role === 'technician') return;
  if (canClaimRow(row)) return;
  throw serviceError(403, 'Forbidden');
}

function assertAssignedToActorOrAdmin(user, row) {
  assertWorkRole(user);
  if (isAdminUser(user)) return;
  if (row.assigned_to_uid === user.uid && row.assigned_to_role === 'technician') return;
  throw serviceError(403, 'Forbidden');
}

function formatTechnicianRequest(row) {
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
    workflow: {
      canClaim: Boolean(canClaimRow(row)),
      canStart: Boolean(row.assigned_to_role === 'technician' && (row.status === 'accepted' || row.status === 'assigned')),
      canResume: Boolean(row.assigned_to_role === 'technician' && WAITING_STATUSES.has(row.status)),
      canWait: Boolean(row.assigned_to_role === 'technician' && row.status === 'in_progress'),
      canResolve: Boolean(row.assigned_to_role === 'technician' && row.status === 'in_progress'),
    },
    counters: {
      residentUpdates: Number(row.resident_updates_count || 0),
      internalComments: Number(row.internal_comments_count || 0),
      slaEvents: Number(row.sla_events_count || 0),
      technicianEvents: Number(row.technician_events_count || 0),
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

function formatTechnicianEventRow(row) {
  return {
    id: row.id,
    requestId: row.request_id,
    technicianUid: row.technician_uid,
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

function addQueueScope(user, queue, sql, params) {
  if (isTechnicianUser(user)) {
    const uidIdx = addParam(params, user.uid);
    if (queue === 'available') {
      sql.push(`r.assigned_to_uid IS NULL`);
      sql.push(`(r.assigned_to_role IS NULL OR r.assigned_to_role = 'technician')`);
      return;
    }
    if (queue === 'active' || queue === 'all') {
      sql.push(`(
        (r.assigned_to_uid = $${uidIdx} AND r.assigned_to_role = 'technician')
        OR (
          r.assigned_to_uid IS NULL
          AND (r.assigned_to_role IS NULL OR r.assigned_to_role = 'technician')
        )
      )`);
      return;
    }
    sql.push(`r.assigned_to_uid = $${uidIdx}`);
    sql.push(`r.assigned_to_role = 'technician'`);
    return;
  }

  if (queue !== 'all') {
    sql.push(`(r.assigned_to_role = 'technician' OR r.assigned_to_uid IS NULL)`);
  }
}

function addQueueStatus(queue, explicitStatuses, sql, params) {
  if (explicitStatuses) {
    const idx = addParam(params, explicitStatuses);
    sql.push(`r.status = ANY($${idx}::text[])`);
    return;
  }

  if (queue === 'available') {
    const idx = addParam(params, [...PICKUP_STATUSES]);
    sql.push(`r.status = ANY($${idx}::text[])`);
    return;
  }
  if (queue === 'in_progress') {
    sql.push(`r.status = 'in_progress'`);
    return;
  }
  if (queue === 'waiting') {
    const idx = addParam(params, [...WAITING_STATUSES]);
    sql.push(`r.status = ANY($${idx}::text[])`);
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

function buildQueueFilters(user, filters, params) {
  assertReadRole(user);
  const queue = parseEnum(
    filters.queue || (isTechnicianUser(user) ? 'mine' : 'active'),
    VALID_QUEUES,
    'queue',
  );
  const statuses = parseStatuses(filters.status);
  const sql = ['r.deleted_at IS NULL'];

  addQueueScope(user, queue, sql, params);
  addQueueStatus(queue, statuses, sql, params);

  const assigneeUid = filters.assignee_uid || filters.assigneeUid || null;
  if (assigneeUid) {
    const idx = addParam(params, String(assigneeUid).trim());
    sql.push(`r.assigned_to_uid = $${idx}`);
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
      OR r.visitor_name ILIKE $${idx}
      OR r.visitor_phone ILIKE $${idx}
      OR r.car_plate ILIKE $${idx}
      OR r.comment ILIKE $${idx}
      OR r.resolution_note ILIKE $${idx}
    )`);
  }

  return sql;
}

async function listTechnicianQueue(queryable, { user, filters = {}, pagination }) {
  const params = [];
  const where = buildQueueFilters(user, filters, params).join(' AND ');
  const limitIdx = addParam(params, pagination.limit);
  const offsetIdx = addParam(params, pagination.offset);

  const { rows } = await queryable.query(
    `SELECT r.*,
            resident_ref.id AS resident_id,
            COUNT(*) OVER() AS total_count,
            COALESCE(ru.resident_updates_count, 0) AS resident_updates_count,
            COALESCE(iu.internal_comments_count, 0) AS internal_comments_count,
            COALESCE(se.sla_events_count, 0) AS sla_events_count,
            COALESCE(te.technician_events_count, 0) AS technician_events_count
       FROM requests r
       LEFT JOIN residents resident_ref ON resident_ref.external_uid = r.created_by_uid
       LEFT JOIN (
         SELECT request_id, COUNT(*) AS resident_updates_count
           FROM request_updates
          WHERE visibility = 'resident'
          GROUP BY request_id
       ) ru ON ru.request_id = r.id
       LEFT JOIN (
         SELECT request_id, COUNT(*) AS internal_comments_count
           FROM request_updates
          WHERE visibility = 'internal'
          GROUP BY request_id
       ) iu ON iu.request_id = r.id
       LEFT JOIN (
         SELECT request_id, COUNT(*) AS sla_events_count
           FROM request_sla_events
          GROUP BY request_id
       ) se ON se.request_id = r.id
       LEFT JOIN (
         SELECT request_id, COUNT(*) AS technician_events_count
           FROM request_technician_events
          GROUP BY request_id
       ) te ON te.request_id = r.id
      WHERE ${where}
      ORDER BY
        CASE WHEN r.priority = 'emergency' OR r.sla_profile = 'emergency' THEN 0 ELSE 1 END,
        CASE
          WHEN r.status = 'in_progress' THEN 0
          WHEN r.status IN ('accepted','assigned') THEN 1
          WHEN r.status IN ('waiting_resident','waiting_parts') THEN 2
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
    requests: rows.map(formatTechnicianRequest),
    total: rows.length ? Number(rows[0].total_count || 0) : 0,
  };
}

async function loadBaseRequest(queryable, requestId) {
  const id = validateRequestId(requestId);
  const { rows } = await queryable.query(
    `SELECT r.*, resident_ref.id AS resident_id
       FROM requests r
       LEFT JOIN residents resident_ref ON resident_ref.external_uid = r.created_by_uid
      WHERE r.id=$1 AND r.deleted_at IS NULL
      LIMIT 1`,
    [id],
  );
  if (!rows[0]) throw serviceError(404, 'Request not found');
  return rows[0];
}

async function loadTechnicianRequestDetail(queryable, { user, requestId }) {
  const row = await loadBaseRequest(queryable, requestId);
  assertCanViewRequest(user, row);

  const [attachments, updates, internalComments, slaEvents, technicianEvents] = await Promise.all([
    queryable.query(
      `SELECT id, request_id, uploaded_by_uid, file_url, file_kind, visibility, metadata, created_at
         FROM request_attachments
        WHERE request_id=$1
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
    queryable.query(
      `SELECT id, request_id, actor_uid, actor_name, actor_role, body, visibility,
              attachment_ids, created_at
         FROM request_updates
        WHERE request_id=$1 AND visibility='internal'
        ORDER BY created_at ASC, id ASC`,
      [row.id],
    ),
    queryable.query(
      `SELECT id, request_id, event_key, event_type, severity, due_at, detected_at, metadata, created_at
         FROM request_sla_events
        WHERE request_id=$1
        ORDER BY detected_at DESC, id DESC`,
      [row.id],
    ),
    queryable.query(
      `SELECT id, request_id, technician_uid, actor_uid, actor_name, actor_role, event_type,
              from_status, to_status, metadata, created_at
         FROM request_technician_events
        WHERE request_id=$1
        ORDER BY created_at DESC, id DESC`,
      [row.id],
    ),
  ]);

  return {
    request: formatTechnicianRequest(row),
    attachments: attachments.rows.map(formatAttachmentRow),
    residentUpdates: updates.rows.map(formatUpdateRow),
    internalComments: internalComments.rows.map(formatUpdateRow),
    slaEvents: slaEvents.rows.map(formatSlaEventRow),
    technicianEvents: technicianEvents.rows.map(formatTechnicianEventRow),
  };
}

async function insertTechnicianEvent(queryable, {
  requestId,
  technicianUid,
  user,
  eventType,
  fromStatus,
  toStatus,
  metadata = {},
}) {
  await queryable.query(
    `INSERT INTO request_technician_events
       (request_id, technician_uid, actor_uid, actor_name, actor_role,
        event_type, from_status, to_status, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      requestId,
      technicianUid || null,
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

async function claimRequest(queryable, { user, requestId }) {
  if (!isTechnicianUser(user)) throw serviceError(403, 'Only technicians can claim requests');
  const current = await loadBaseRequest(queryable, requestId);
  if (current.assigned_to_uid === user.uid && current.assigned_to_role === 'technician') {
    return formatTechnicianRequest(current);
  }
  if (!canClaimRow(current)) throw serviceError(409, 'Request cannot be claimed');

  const { rows } = await queryable.query(
    `UPDATE requests
        SET assigned_to_uid=$1,
            assigned_to_name=$2,
            assigned_to_role='technician',
            assigned_at=COALESCE(assigned_at, NOW()),
            status=CASE WHEN status IN ('pending','scheduled','new','triaged') THEN 'accepted' ELSE status END,
            updated_at=NOW()
      WHERE id=$3
        AND deleted_at IS NULL
        AND assigned_to_uid IS NULL
        AND (assigned_to_role IS NULL OR assigned_to_role='technician')
        AND status = ANY($4::text[])
      RETURNING *`,
    [user.uid, user.name || user.uid, current.id, [...PICKUP_STATUSES]],
  );
  if (!rows[0]) throw serviceError(409, 'Request changed since it was loaded');

  await insertTechnicianEvent(queryable, {
    requestId: rows[0].id,
    technicianUid: user.uid,
    user,
    eventType: 'claimed',
    fromStatus: current.status,
    toStatus: rows[0].status,
  });

  return formatTechnicianRequest(rows[0]);
}

async function startRequest(queryable, { user, requestId }) {
  const current = await loadBaseRequest(queryable, requestId);
  assertAssignedToActorOrAdmin(user, current);
  if (!canStartRow(user, current)) throw serviceError(409, 'Request cannot be started');
  const eventType = WAITING_STATUSES.has(current.status) ? 'resumed' : 'started';
  const actorConstraintUid = isAdminUser(user) ? null : user.uid;

  const { rows } = await queryable.query(
    `UPDATE requests
        SET status='in_progress',
            started_at=COALESCE(started_at, NOW()),
            first_response_at=COALESCE(first_response_at, NOW()),
            sla_state=CASE WHEN sla_state='on_track' THEN 'responded' ELSE sla_state END,
            updated_at=NOW()
      WHERE id=$1
        AND deleted_at IS NULL
        AND assigned_to_role='technician'
        AND status = ANY($2::text[])
        AND ($3::text IS NULL OR assigned_to_uid=$3)
      RETURNING *`,
    [current.id, [...START_STATUSES], actorConstraintUid],
  );
  if (!rows[0]) throw serviceError(409, 'Request changed since it was loaded');

  await insertTechnicianEvent(queryable, {
    requestId: rows[0].id,
    technicianUid: rows[0].assigned_to_uid,
    user,
    eventType,
    fromStatus: current.status,
    toStatus: rows[0].status,
  });

  return formatTechnicianRequest(rows[0]);
}

async function setWaitingStatus(queryable, { user, requestId, body = {} }) {
  const current = await loadBaseRequest(queryable, requestId);
  assertAssignedToActorOrAdmin(user, current);
  if (!canWaitRow(user, current)) throw serviceError(409, 'Request must be in progress');
  const actorConstraintUid = isAdminUser(user) ? null : user.uid;

  const reason = parseEnum(body.reason, VALID_WAITING_REASONS, 'reason');
  if (!reason) throw serviceError(400, "reason must be 'resident' or 'parts'");
  const nextStatus = reason === 'resident' ? 'waiting_resident' : 'waiting_parts';
  const note = normalizeNote(body.note || body.body || body.comment);

  const { rows } = await queryable.query(
    `UPDATE requests
        SET status=$1,
            updated_at=NOW()
      WHERE id=$2
        AND deleted_at IS NULL
        AND assigned_to_role='technician'
        AND status='in_progress'
        AND ($3::text IS NULL OR assigned_to_uid=$3)
      RETURNING *`,
    [nextStatus, current.id, actorConstraintUid],
  );
  if (!rows[0]) throw serviceError(409, 'Request changed since it was loaded');

  await insertInternalUpdate(queryable, {
    requestId: rows[0].id,
    user,
    body: note,
  });
  await insertTechnicianEvent(queryable, {
    requestId: rows[0].id,
    technicianUid: rows[0].assigned_to_uid,
    user,
    eventType: nextStatus,
    fromStatus: current.status,
    toStatus: rows[0].status,
    metadata: { reason, note_present: Boolean(note) },
  });

  return formatTechnicianRequest(rows[0]);
}

async function resolveRequest(queryable, { user, requestId, body = {} }) {
  const current = await loadBaseRequest(queryable, requestId);
  assertAssignedToActorOrAdmin(user, current);
  if (!canResolveRow(user, current)) throw serviceError(409, 'Request must be in progress');
  const actorConstraintUid = isAdminUser(user) ? null : user.uid;

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
        AND assigned_to_role='technician'
        AND status='in_progress'
        AND ($4::text IS NULL OR assigned_to_uid=$4)
      RETURNING *`,
    [resolutionNote, requiresFollowUp, current.id, actorConstraintUid],
  );
  if (!rows[0]) throw serviceError(409, 'Request changed since it was loaded');

  await insertInternalUpdate(queryable, {
    requestId: rows[0].id,
    user,
    body: resolutionNote,
    attachmentIds,
  });
  await insertTechnicianEvent(queryable, {
    requestId: rows[0].id,
    technicianUid: rows[0].assigned_to_uid,
    user,
    eventType: 'resolved',
    fromStatus: current.status,
    toStatus: rows[0].status,
    metadata: {
      requires_follow_up: requiresFollowUp,
      attachment_count: attachmentIds.length,
    },
  });

  return formatTechnicianRequest(rows[0]);
}

module.exports = {
  TechnicianWorkspaceServiceError,
  isTechnicianWorkspaceServiceError,
  listTechnicianQueue,
  loadTechnicianRequestDetail,
  claimRequest,
  startRequest,
  setWaitingStatus,
  resolveRequest,
};
