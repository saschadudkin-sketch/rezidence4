'use strict';

const { resolveStaffIdByUid } = require('./accessActorResolver');
const {
  classifyAuditRow,
  isSensitiveAuditAction,
  listSensitiveAuditActions,
} = require('./auditEventCatalog');

const REVIEW_STATUSES = new Set(['pending', 'approved', 'needs_followup', 'dismissed']);

const AUDIT_SELECT = `
  l.id, l.property_id, l.actor_uid, l.actor_role, l.actor_type,
  l.action, l.resource_type, l.resource_id, l.entity_type, l.entity_id,
  l.changes, l.ip_address, l.created_at
`;

class AuditReviewServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'AuditReviewServiceError';
    this.status = status;
  }
}

function serviceError(status, message) {
  return new AuditReviewServiceError(status, message);
}

function isAuditReviewServiceError(err) {
  return err instanceof AuditReviewServiceError;
}

function reviewStatus(row) {
  return row.review_status || 'pending';
}

function mapReviewRow(row) {
  const action = classifyAuditRow(row);
  return {
    ...action,
    review: {
      id: row.review_id || null,
      status: reviewStatus(row),
      reviewer_staff_id: row.reviewer_staff_id || null,
      reviewed_at: row.reviewed_at || null,
      comment: row.review_comment || null,
    },
  };
}

async function listSensitiveActionReviews({ queryable, filters, pagination }) {
  const actions = listSensitiveAuditActions({ category: filters.category || null });
  const clauses = ['l.action = ANY($1::text[])'];
  const params = [actions];

  if (filters.property_id) {
    params.push(filters.property_id);
    clauses.push(`l.property_id = $${params.length}`);
  }
  if (filters.review_status) {
    params.push(filters.review_status);
    clauses.push(`COALESCE(r.review_status, 'pending') = $${params.length}`);
  }
  if (filters.actor_uid) {
    params.push(filters.actor_uid);
    clauses.push(`l.actor_uid = $${params.length}`);
  }
  if (filters.resource_type) {
    params.push(filters.resource_type);
    clauses.push(`l.resource_type = $${params.length}`);
  }
  if (filters.from) {
    params.push(filters.from);
    clauses.push(`l.created_at >= $${params.length}`);
  }
  if (filters.to) {
    params.push(filters.to);
    clauses.push(`l.created_at <= $${params.length}`);
  }

  params.push(pagination.limit);
  const limitIdx = params.length;
  params.push(pagination.offset);
  const offsetIdx = params.length;

  const { rows } = await queryable.query(
    `SELECT ${AUDIT_SELECT},
            r.id AS review_id,
            r.review_status,
            r.reviewer_staff_id,
            r.reviewed_at,
            r.comment AS review_comment
       FROM property_audit_log l
       LEFT JOIN sensitive_action_reviews r ON r.audit_log_id = l.id
      WHERE ${clauses.join(' AND ')}
      ORDER BY l.created_at DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params,
  );

  return rows.map(mapReviewRow);
}

async function attestSensitiveAction({ queryable, user, auditLogId, decision, comment = null }) {
  if (!REVIEW_STATUSES.has(decision) || decision === 'pending') {
    throw serviceError(400, 'decision must be approved, needs_followup, or dismissed');
  }
  if (comment !== null && typeof comment !== 'string') {
    throw serviceError(400, 'comment must be string or null');
  }

  const staffId = await resolveStaffIdByUid(queryable, user?.uid);
  if (!staffId) throw serviceError(403, 'Staff identity is not mapped to v1');

  const { rows: auditRows } = await queryable.query(
    `SELECT ${AUDIT_SELECT}
       FROM property_audit_log l
      WHERE l.id = $1`,
    [auditLogId],
  );
  if (!auditRows[0]) throw serviceError(404, 'Audit action not found');
  const classified = classifyAuditRow(auditRows[0]);
  if (!isSensitiveAuditAction(classified.action)) {
    throw serviceError(422, 'Audit action is not sensitive/reviewable');
  }

  const { rows } = await queryable.query(
    `INSERT INTO sensitive_action_reviews
       (audit_log_id, property_id, category, action, resource_type, resource_id,
        review_status, review_reason, reviewer_staff_id, reviewed_at, comment,
        classification_snapshot)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),$10,$11::jsonb)
     ON CONFLICT (audit_log_id)
     DO UPDATE SET
       review_status = EXCLUDED.review_status,
       review_reason = EXCLUDED.review_reason,
       reviewer_staff_id = EXCLUDED.reviewer_staff_id,
       reviewed_at = NOW(),
       comment = EXCLUDED.comment,
       classification_snapshot = EXCLUDED.classification_snapshot,
       updated_at = NOW()
     RETURNING id, audit_log_id, property_id, category, action, resource_type,
               resource_id, review_status, review_reason, reviewer_staff_id,
               reviewed_at, comment, classification_snapshot, created_at, updated_at`,
    [
      classified.id,
      classified.property_id || null,
      classified.category,
      classified.action,
      classified.resource_type,
      classified.resource_id || null,
      decision,
      classified.review_reason,
      staffId,
      comment ? comment.trim() : null,
      JSON.stringify({
        canonical_event_type: classified.canonical_event_type,
        category: classified.category,
        sensitivity: classified.sensitivity,
        review_reason: classified.review_reason,
      }),
    ],
  );

  return rows[0];
}

module.exports = {
  AuditReviewServiceError,
  REVIEW_STATUSES,
  attestSensitiveAction,
  isAuditReviewServiceError,
  listSensitiveActionReviews,
};
