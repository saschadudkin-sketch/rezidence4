'use strict';

const { isStaff } = require('../../constants');
const { RequestsService } = require('../RequestsService');
const { formatRequestRow } = require('./RequestFormatter');
const { ServiceError } = require('./RequestErrors');

const ASSIGNABLE_ROLES = new Set([
  'security',
  'concierge',
  'technician',
  'contractor',
  'property_admin',
  'management_company_admin',
  'platform_admin',
  'admin',
]);
const MANAGER_ROLES = new Set([
  'admin',
  'concierge',
  'security',
  'property_admin',
  'management_company_admin',
  'platform_admin',
]);
const TERMINAL_STATUSES = new Set(['completed', 'cancelled', 'rejected', 'expired']);

function assertCanManageRequests(user) {
  if (!MANAGER_ROLES.has(user?.role)) {
    throw new ServiceError('Forbidden', 403);
  }
}

function normalizeAssignee(body = {}) {
  const assigneeUid = String(body.assigneeUid || body.assignee_uid || '').trim();
  if (!assigneeUid) throw new ServiceError('assigneeUid is required', 400);

  const assigneeRole = String(body.assigneeRole || body.assignee_role || '').trim();
  if (!ASSIGNABLE_ROLES.has(assigneeRole)) {
    throw new ServiceError('Invalid assigneeRole', 400);
  }

  const assigneeName = String(body.assigneeName || body.assignee_name || assigneeUid).trim();
  return { assigneeUid, assigneeName, assigneeRole };
}

function formatSlaEventRow(row) {
  return {
    id: row.id,
    requestId: row.request_id,
    eventKey: row.event_key,
    eventType: row.event_type,
    severity: row.severity,
    dueAt: row.due_at,
    detectedAt: row.detected_at || row.created_at,
    metadata: row.metadata || {},
  };
}

function toSlaEventInput(row) {
  const emergency = row.priority === 'emergency' || row.sla_profile === 'emergency';
  return {
    requestId: row.id,
    requestType: row.type,
    category: row.category,
    priority: row.priority || 'normal',
    slaProfile: row.sla_profile || 'standard',
    eventKey: `${row.id}:${row.event_type}`,
    eventType: row.event_type,
    severity: emergency ? 'emergency' : 'breach',
    reason: row.event_type === 'first_response_overdue'
      ? 'first_response_due_at breached'
      : 'resolution_due_at breached',
    dueAt: row.due_at,
  };
}

class RequestSlaService {
  static async assignRequest(user, requestId, body, queryDb) {
    assertCanManageRequests(user);
    await RequestsService.getOne(user, requestId, queryDb);
    const assignee = normalizeAssignee(body);

    const { rows } = await queryDb.query(
      `UPDATE requests
          SET assigned_to_uid=$1,
              assigned_to_name=$2,
              assigned_to_role=$3,
              assigned_at=NOW(),
              status=CASE WHEN status IN ('pending','scheduled') THEN 'accepted' ELSE status END,
              updated_at=NOW()
        WHERE id=$4 AND deleted_at IS NULL
        RETURNING *`,
      [assignee.assigneeUid, assignee.assigneeName, assignee.assigneeRole, requestId],
    );
    if (!rows.length) throw new ServiceError('Not found', 404);
    return formatRequestRow(rows[0]);
  }

  static async markFirstResponse(user, requestId, queryDb) {
    assertCanManageRequests(user);
    await RequestsService.getOne(user, requestId, queryDb);

    const { rows } = await queryDb.query(
      `UPDATE requests
          SET first_response_at=COALESCE(first_response_at, NOW()),
              sla_state=CASE WHEN sla_state='on_track' THEN 'responded' ELSE sla_state END,
              updated_at=NOW()
        WHERE id=$1 AND deleted_at IS NULL
        RETURNING *`,
      [requestId],
    );
    if (!rows.length) throw new ServiceError('Not found', 404);
    return formatRequestRow(rows[0]);
  }

  static async findOverdueCandidates(queryDb, { limit = 50 } = {}) {
    const safeLimit = Math.min(200, Math.max(1, Number.parseInt(limit, 10) || 50));
    const { rows } = await queryDb.query(
      `SELECT *
         FROM (
           SELECT r.id, r.type, r.category, r.priority, r.sla_profile,
                  r.created_by_uid, r.first_response_due_at AS due_at,
                  'first_response_overdue'::text AS event_type
             FROM requests r
            WHERE r.deleted_at IS NULL
              AND r.status <> ALL($2::text[])
              AND r.first_response_due_at IS NOT NULL
              AND r.first_response_at IS NULL
              AND r.first_response_due_at < NOW()
           UNION ALL
           SELECT r.id, r.type, r.category, r.priority, r.sla_profile,
                  r.created_by_uid, r.resolution_due_at AS due_at,
                  'resolution_overdue'::text AS event_type
             FROM requests r
            WHERE r.deleted_at IS NULL
              AND r.status <> ALL($2::text[])
              AND r.resolution_due_at IS NOT NULL
              AND r.resolved_at IS NULL
              AND r.completed_at IS NULL
              AND r.resolution_due_at < NOW()
         ) due
        WHERE NOT EXISTS (
          SELECT 1
            FROM request_sla_events e
           WHERE e.request_id = due.id
             AND e.event_key = due.id || ':' || due.event_type
        )
        ORDER BY CASE WHEN due.priority='emergency' OR due.sla_profile='emergency' THEN 0 ELSE 1 END,
                 due.due_at ASC
        LIMIT $1`,
      [safeLimit, [...TERMINAL_STATUSES]],
    );
    return rows.map(toSlaEventInput);
  }

  static async escalateOverdueRequests(queryDb, { limit = 50 } = {}) {
    const candidates = await RequestSlaService.findOverdueCandidates(queryDb, { limit });
    const events = [];

    for (const candidate of candidates) {
      const { rows: inserted } = await queryDb.query(
        `INSERT INTO request_sla_events
           (request_id, event_key, event_type, severity, due_at, detected_at, metadata)
         VALUES ($1,$2,$3,$4,$5,NOW(),$6)
         ON CONFLICT (request_id, event_key) DO NOTHING
         RETURNING id, request_id, event_key, event_type, severity, due_at, detected_at, metadata, created_at`,
        [
          candidate.requestId,
          candidate.eventKey,
          candidate.eventType,
          candidate.severity,
          candidate.dueAt,
          {
            request_type: candidate.requestType,
            category: candidate.category,
            priority: candidate.priority,
            sla_profile: candidate.slaProfile,
            reason: candidate.reason,
          },
        ],
      );
      if (!inserted.length) continue;

      await queryDb.query(
        `UPDATE requests
            SET sla_state=CASE
                  WHEN priority='emergency' OR sla_profile='emergency' THEN 'emergency_escalated'
                  ELSE 'escalated'
                END,
                escalation_level=escalation_level + 1,
                escalated_at=COALESCE(escalated_at, NOW()),
                escalation_reason=$2,
                last_sla_check_at=NOW(),
                updated_at=NOW()
          WHERE id=$1`,
        [candidate.requestId, candidate.eventType],
      );

      events.push({
        ...formatSlaEventRow(inserted[0]),
        requestType: candidate.requestType,
        category: candidate.category,
        priority: candidate.priority,
        slaProfile: candidate.slaProfile,
      });
    }

    return events;
  }
}

module.exports = {
  RequestSlaService,
  normalizeAssignee,
};
