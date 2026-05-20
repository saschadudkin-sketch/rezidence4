'use strict';

const { formatRequestRow } = require('../../services/requests/RequestFormatter');

const TERMINAL_STATUSES = new Set(['completed', 'cancelled', 'rejected', 'expired']);
const VALID_STATUSES = new Set([
  'pending', 'approved', 'accepted', 'arrived', 'cancelled', 'scheduled',
  'expired', 'completed', 'rejected', 'new', 'triaged', 'assigned',
  'in_progress', 'waiting_resident', 'waiting_parts', 'waiting_contractor',
  'resolved',
]);
const VALID_QUEUES = new Set(['active', 'unassigned', 'assigned', 'mine', 'overdue', 'emergency', 'all']);
const VALID_PRIORITIES = new Set(['low', 'normal', 'high', 'emergency']);
const VALID_SLA_PROFILES = new Set(['standard', 'urgent', 'emergency']);
const VALID_TARGET_TYPES = new Set([
  'unit', 'home', 'access_zone', 'access_point', 'common_territory', 'road', 'service_area',
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_REQUEST_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_INTERNAL_COMMENT_LENGTH = 2000;

class StaffWorkspaceServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'StaffWorkspaceServiceError';
    this.status = status;
  }
}

function serviceError(status, message) {
  return new StaffWorkspaceServiceError(status, message);
}

function isStaffWorkspaceServiceError(err) {
  return err instanceof StaffWorkspaceServiceError;
}

function isValidUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

function validateRequestId(id) {
  const value = String(id || '');
  if (!UUID_RE.test(value) && !SAFE_REQUEST_ID_RE.test(value)) {
    throw serviceError(400, 'Invalid request id');
  }
  return value;
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

function parseUuidFilter(value, fieldName) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim();
  if (!isValidUuid(normalized)) throw serviceError(400, `${fieldName} must be UUID`);
  return normalized;
}

function addParam(params, value) {
  params.push(value);
  return params.length;
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

function formatWorkspaceRequest(row) {
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
    counters: {
      residentUpdates: Number(row.resident_updates_count || 0),
      internalComments: Number(row.internal_comments_count || 0),
      slaEvents: Number(row.sla_events_count || 0),
    },
  };
}

function buildInboxFilters(user, filters, params, opts = {}) {
  const sql = ['r.deleted_at IS NULL'];
  const queue = parseEnum(filters.queue || 'active', VALID_QUEUES, 'queue');
  const statuses = parseStatuses(filters.status);
  const priority = parseEnum(filters.priority, VALID_PRIORITIES, 'priority');
  const slaProfile = parseEnum(filters.sla_profile || filters.slaProfile, VALID_SLA_PROFILES, 'sla_profile');
  const targetType = parseEnum(filters.target_type || filters.targetType, VALID_TARGET_TYPES, 'target_type');
  const targetId = parseUuidFilter(
    filters.target_id || filters.targetId || filters.unit_id || filters.home_id
      || filters.access_zone_id || filters.access_point_id,
    'target_id',
  );

  if (opts.propertyId) {
    const idx = addParam(params, opts.propertyId);
    sql.push(`resident_ref.property_id = $${idx}`);
  }

  if (statuses) {
    const idx = addParam(params, statuses);
    sql.push(`r.status = ANY($${idx}::text[])`);
  } else if (queue !== 'all') {
    sql.push(`r.status NOT IN ('${[...TERMINAL_STATUSES].join("','")}')`);
  }

  if (queue === 'unassigned') sql.push('r.assigned_to_uid IS NULL');
  if (queue === 'assigned') sql.push('r.assigned_to_uid IS NOT NULL');
  if (queue === 'mine') {
    const idx = addParam(params, user.uid);
    sql.push(`r.assigned_to_uid = $${idx}`);
  }
  if (queue === 'overdue') {
    sql.push(`(
      r.sla_state IN ('escalated','emergency_escalated')
      OR (r.first_response_due_at IS NOT NULL AND r.first_response_at IS NULL AND r.first_response_due_at < NOW())
      OR (r.resolution_due_at IS NOT NULL AND r.resolved_at IS NULL AND r.completed_at IS NULL AND r.resolution_due_at < NOW())
    )`);
  }
  if (queue === 'emergency') {
    sql.push(`(r.priority = 'emergency' OR r.sla_profile = 'emergency')`);
  }

  const assigneeUid = filters.assignee_uid || filters.assigneeUid || null;
  if (assigneeUid) {
    const idx = addParam(params, String(assigneeUid).trim());
    sql.push(`r.assigned_to_uid = $${idx}`);
  }
  if (priority) {
    const idx = addParam(params, priority);
    sql.push(`r.priority = $${idx}`);
  }
  if (slaProfile) {
    const idx = addParam(params, slaProfile);
    sql.push(`r.sla_profile = $${idx}`);
  }
  if (filters.category) {
    const idx = addParam(params, String(filters.category).trim());
    sql.push(`r.category = $${idx}`);
  }
  if (targetType) {
    const idx = addParam(params, targetType);
    sql.push(`r.target_type = $${idx}`);
  }
  if (targetId) {
    const idx = addParam(params, targetId);
    sql.push(`r.target_id = $${idx}`);
  }
  if (filters.access_point_id) {
    const idx = addParam(params, String(filters.access_point_id).trim());
    sql.push(`r.target_type = 'access_point' AND r.target_id = $${idx}`);
  }
  if (filters.access_zone_id) {
    const idx = addParam(params, String(filters.access_zone_id).trim());
    sql.push(`r.target_type = 'access_zone' AND r.target_id = $${idx}`);
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
    )`);
  }

  return sql;
}

async function listInbox(queryable, { user, filters = {}, pagination, propertyId = null }) {
  const params = [];
  const where = buildInboxFilters(user, filters, params, { propertyId }).join(' AND ');
  const limitIdx = addParam(params, pagination.limit);
  const offsetIdx = addParam(params, pagination.offset);

  const { rows } = await queryable.query(
    `SELECT r.*,
            COUNT(*) OVER() AS total_count,
            COALESCE(ru.resident_updates_count, 0) AS resident_updates_count,
            COALESCE(iu.internal_comments_count, 0) AS internal_comments_count,
            COALESCE(se.sla_events_count, 0) AS sla_events_count
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
      WHERE ${where}
      ORDER BY
        CASE WHEN r.priority = 'emergency' OR r.sla_profile = 'emergency' THEN 0 ELSE 1 END,
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
    requests: rows.map(formatWorkspaceRequest),
    total: rows.length ? Number(rows[0].total_count || 0) : 0,
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

async function loadRequestDetail(queryable, requestId, opts = {}) {
  const id = validateRequestId(requestId);
  const params = [id];
  const propertyPredicate = opts.propertyId ? ` AND resident_ref.property_id = $2` : '';
  if (opts.propertyId) params.push(opts.propertyId);
  const { rows } = await queryable.query(
    `SELECT r.*, resident_ref.id AS resident_id
       FROM requests r
       LEFT JOIN residents resident_ref
         ON resident_ref.external_uid = r.created_by_uid
      WHERE r.id=$1 AND r.deleted_at IS NULL
        ${propertyPredicate}
      LIMIT 1`,
    params,
  );
  if (!rows[0]) throw serviceError(404, 'Request not found');
  const childScopeSql = opts.propertyId
    ? `AND EXISTS (
         SELECT 1
           FROM requests scoped_r
           LEFT JOIN residents scoped_resident_ref
             ON scoped_resident_ref.external_uid = scoped_r.created_by_uid
          WHERE scoped_r.id = $1
            AND scoped_resident_ref.property_id = $2
       )`
    : '';

  const [attachments, updates, internalComments, slaEvents] = await Promise.all([
    queryable.query(
      `SELECT id, request_id, uploaded_by_uid, file_url, file_kind, visibility, metadata, created_at
         FROM request_attachments
        WHERE request_id=$1
          ${childScopeSql}
        ORDER BY created_at ASC, id ASC`,
      opts.propertyId ? [id, opts.propertyId] : [id],
    ),
    queryable.query(
      `SELECT id, request_id, actor_uid, actor_name, actor_role, body, visibility,
              attachment_ids, created_at
         FROM request_updates
        WHERE request_id=$1 AND visibility='resident'
          ${childScopeSql}
        ORDER BY created_at ASC, id ASC`,
      opts.propertyId ? [id, opts.propertyId] : [id],
    ),
    queryable.query(
      `SELECT id, request_id, actor_uid, actor_name, actor_role, body, visibility,
              attachment_ids, created_at
         FROM request_updates
        WHERE request_id=$1 AND visibility='internal'
          ${childScopeSql}
        ORDER BY created_at ASC, id ASC`,
      opts.propertyId ? [id, opts.propertyId] : [id],
    ),
    queryable.query(
      `SELECT id, request_id, event_key, event_type, severity, due_at, detected_at, metadata, created_at
         FROM request_sla_events
        WHERE request_id=$1
          ${childScopeSql}
        ORDER BY detected_at DESC, id DESC`,
      opts.propertyId ? [id, opts.propertyId] : [id],
    ),
  ]);

  return {
    request: formatWorkspaceRequest(rows[0]),
    attachments: attachments.rows.map(formatAttachmentRow),
    residentUpdates: updates.rows.map(formatUpdateRow),
    internalComments: internalComments.rows.map(formatUpdateRow),
    slaEvents: slaEvents.rows.map(formatSlaEventRow),
  };
}

function normalizeInternalComment(body = {}) {
  const text = String(body.body || body.comment || '').trim();
  if (!text) throw serviceError(400, 'body is required');
  if (text.length > MAX_INTERNAL_COMMENT_LENGTH) {
    throw serviceError(400, `body must be ${MAX_INTERNAL_COMMENT_LENGTH} characters or less`);
  }
  return text;
}

async function createInternalComment(queryable, { user, requestId, body, propertyId = null }) {
  const id = validateRequestId(requestId);
  await loadRequestDetail(queryable, id, { propertyId });
  const text = normalizeInternalComment(body);
  const { rows } = await queryable.query(
    `INSERT INTO request_updates
       (request_id, actor_uid, actor_name, actor_role, body, visibility)
     VALUES ($1,$2,$3,$4,$5,'internal')
     RETURNING id, request_id, actor_uid, actor_name, actor_role, body, visibility,
               attachment_ids, created_at`,
    [id, user.uid, user.name || null, user.role || null, text],
  );
  return formatUpdateRow(rows[0]);
}

function formatResident(row, canViewPhone) {
  return {
    id: row.id,
    externalUid: row.external_uid,
    propertyId: row.property_id,
    fullName: row.full_name,
    phone: canViewPhone ? row.phone : null,
    email: row.email,
    role: row.role,
    residentType: row.resident_type,
    isActive: row.is_active,
    unit: {
      id: row.unit_id,
      number: row.unit_number,
      type: row.unit_type,
      floor: row.floor,
      buildingId: row.building_id,
      buildingName: row.building_name,
      buildingCode: row.building_code,
      entranceId: row.entrance_id,
      entranceName: row.entrance_name,
      entranceCode: row.entrance_code,
    },
  };
}

async function getResidentQuickView(queryable, { residentId, canViewPhone, propertyId = null }) {
  if (!isValidUuid(residentId)) throw serviceError(400, 'resident_id must be UUID');
  const params = [residentId];
  const propertyPredicate = propertyId ? ` AND r.property_id = $2` : '';
  if (propertyId) params.push(propertyId);

  const { rows } = await queryable.query(
    `SELECT r.*, u.unit_number, u.unit_type, u.floor, u.building_id, u.entrance_id,
            b.name AS building_name, b.code AS building_code,
            e.name AS entrance_name, e.code AS entrance_code
       FROM residents r
       JOIN units u
         ON u.id = r.unit_id
        AND u.property_id = r.property_id
       LEFT JOIN buildings b
         ON b.id = u.building_id
        AND b.property_id = u.property_id
       LEFT JOIN entrances e
         ON e.id = u.entrance_id
        AND e.building_id = u.building_id
      WHERE r.id=$1
        ${propertyPredicate}
      LIMIT 1`,
    params,
  );
  if (!rows[0]) throw serviceError(404, 'Resident not found');
  const resident = rows[0];

  const [vehicles, requestCounts, recentRequests] = await Promise.all([
    queryable.query(
      `SELECT id, property_id, plate_number, vehicle_type, color, brand, model,
              is_whitelisted, is_blacklisted
         FROM vehicles
        WHERE owner_resident_id=$1
          ${propertyId ? 'AND property_id = $2' : ''}
        ORDER BY is_blacklisted DESC, is_whitelisted DESC, plate_number ASC`,
      propertyId ? [residentId, propertyId] : [residentId],
    ),
    resident.external_uid
      ? queryable.query(
        `SELECT status, COUNT(*)::int AS count
           FROM requests
          WHERE created_by_uid=$1 AND deleted_at IS NULL
            ${propertyId ? `AND EXISTS (
              SELECT 1
                FROM residents scoped_resident
               WHERE scoped_resident.external_uid = requests.created_by_uid
                 AND scoped_resident.property_id = $2
            )` : ''}
          GROUP BY status`,
        propertyId ? [resident.external_uid, propertyId] : [resident.external_uid],
      )
      : Promise.resolve({ rows: [] }),
    resident.external_uid
      ? queryable.query(
        `SELECT *
           FROM requests
          WHERE created_by_uid=$1 AND deleted_at IS NULL
            ${propertyId ? `AND EXISTS (
              SELECT 1
                FROM residents scoped_resident
               WHERE scoped_resident.external_uid = requests.created_by_uid
                 AND scoped_resident.property_id = $2
            )` : ''}
          ORDER BY created_at DESC
          LIMIT 5`,
        propertyId ? [resident.external_uid, propertyId] : [resident.external_uid],
      )
      : Promise.resolve({ rows: [] }),
  ]);

  return {
    resident: formatResident(resident, canViewPhone),
    vehicles: vehicles.rows,
    requestCounts: requestCounts.rows.reduce((acc, row) => {
      acc[row.status] = Number(row.count || 0);
      return acc;
    }, {}),
    recentRequests: recentRequests.rows.map(formatWorkspaceRequest),
  };
}

module.exports = {
  StaffWorkspaceServiceError,
  isStaffWorkspaceServiceError,
  listInbox,
  loadRequestDetail,
  createInternalComment,
  getResidentQuickView,
};
