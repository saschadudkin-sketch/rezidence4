'use strict';

const { resolveStaffIdByUid } = require('./accessActorResolver');
const {
  AUDIT_ACTION_CATALOG,
  classifyAuditRow,
  isSensitiveAuditAction,
  listSensitiveAuditActions,
} = require('./auditEventCatalog');

const REVIEW_STATUSES = new Set(['pending', 'approved', 'needs_followup', 'dismissed']);
const REVIEW_PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);
const ESCALATION_STATUSES = new Set(['none', 'overdue', 'escalated']);

const CATEGORY_SAMPLE_PRIORITIES = Object.freeze({
  manual_override: 'urgent',
  permission_change: 'urgent',
  provider_settings: 'urgent',
  export: 'urgent',
  data_import: 'high',
  video_evidence: 'high',
  access_grant: 'high',
  access_restriction: 'high',
  vehicle_decision: 'high',
  personal_data: 'high',
  contractor_access: 'normal',
  access_boundary: 'normal',
  hardware_boundary: 'normal',
  access_decision: 'normal',
  incident_review: 'normal',
});

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

function clampInteger(value, { fallback, min, max }) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function priorityForCatalogEntry(entry) {
  const byCategory = CATEGORY_SAMPLE_PRIORITIES[entry.category] || 'normal';
  if (entry.sensitivity === 'restricted' && byCategory === 'normal') return 'high';
  return byCategory;
}

function buildSensitiveCatalogRows(category = null) {
  return listSensitiveAuditActions({ category }).map((action) => {
    const entry = AUDIT_ACTION_CATALOG[action];
    return {
      action,
      category: entry.category,
      canonical_event_type: entry.canonical_event_type,
      sensitivity: entry.sensitivity,
      review_reason: entry.review_reason,
      priority: priorityForCatalogEntry(entry),
    };
  });
}

function catalogArrays(rows) {
  return {
    actions: rows.map((r) => r.action),
    categories: rows.map((r) => r.category),
    canonicalEventTypes: rows.map((r) => r.canonical_event_type),
    sensitivities: rows.map((r) => r.sensitivity),
    reviewReasons: rows.map((r) => r.review_reason),
    priorities: rows.map((r) => r.priority),
  };
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
      assignment: {
        assigned_reviewer_staff_id: row.assigned_reviewer_staff_id || null,
        assigned_by_staff_id: row.assigned_by_staff_id || null,
        assigned_at: row.assigned_at || null,
        due_at: row.due_at || null,
        priority: row.priority || 'normal',
        assignment_reason: row.assignment_reason || null,
        escalation_status: row.escalation_status || 'none',
        escalation_note: row.escalation_note || null,
        last_escalated_at: row.last_escalated_at || null,
        overdue: reviewStatus(row) === 'pending'
          && row.due_at
          && new Date(row.due_at).getTime() < Date.now(),
      },
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
  if (filters.assigned_reviewer_staff_id) {
    params.push(filters.assigned_reviewer_staff_id);
    clauses.push(`r.assigned_reviewer_staff_id = $${params.length}`);
  }
  if (filters.priority) {
    params.push(filters.priority);
    clauses.push(`COALESCE(r.priority, 'normal') = $${params.length}`);
  }
  if (filters.escalation_status) {
    params.push(filters.escalation_status);
    clauses.push(`COALESCE(r.escalation_status, 'none') = $${params.length}`);
  }
  if (filters.overdue === true) {
    clauses.push(`COALESCE(r.review_status, 'pending') = 'pending'`);
    clauses.push('r.due_at IS NOT NULL');
    clauses.push('r.due_at < NOW()');
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
            r.comment AS review_comment,
            r.assigned_reviewer_staff_id,
            r.assigned_by_staff_id,
            r.assigned_at,
            r.due_at,
            r.priority,
            r.assignment_reason,
            r.escalation_status,
            r.escalation_note,
            r.last_escalated_at
       FROM property_audit_log l
       LEFT JOIN sensitive_action_reviews r ON r.audit_log_id = l.id
      WHERE ${clauses.join(' AND ')}
      ORDER BY l.created_at DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params,
  );

  return rows.map(mapReviewRow);
}

async function summarizeSensitiveActionReviews({ queryable, filters = {} }) {
  const actions = listSensitiveAuditActions({ category: filters.category || null });
  const clauses = ['l.action = ANY($1::text[])'];
  const params = [actions];

  if (filters.property_id) {
    params.push(filters.property_id);
    clauses.push(`l.property_id = $${params.length}`);
  }

  const { rows } = await queryable.query(
    `SELECT COALESCE(r.review_status, 'pending') AS review_status,
            COALESCE(r.priority, 'normal') AS priority,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (
              WHERE COALESCE(r.review_status, 'pending') = 'pending'
                AND r.due_at IS NOT NULL
                AND r.due_at < NOW()
            )::int AS overdue
       FROM property_audit_log l
       LEFT JOIN sensitive_action_reviews r ON r.audit_log_id = l.id
      WHERE ${clauses.join(' AND ')}
      GROUP BY 1, 2
      ORDER BY review_status ASC, priority ASC`,
    params,
  );

  const totals = {
    total: 0,
    overdue: 0,
    by_status: {},
    by_priority: {},
  };
  for (const row of rows) {
    const total = Number(row.total || 0);
    const overdue = Number(row.overdue || 0);
    totals.total += total;
    totals.overdue += overdue;
    totals.by_status[row.review_status] = (totals.by_status[row.review_status] || 0) + total;
    totals.by_priority[row.priority] = (totals.by_priority[row.priority] || 0) + total;
  }

  return { rows, totals };
}

async function materializeSensitiveActionReviewSamples({
  queryable,
  filters = {},
  options = {},
}) {
  const catalogRows = buildSensitiveCatalogRows(filters.category || null);
  if (catalogRows.length === 0) return [];

  const arrays = catalogArrays(catalogRows);
  const windowHours = clampInteger(options.windowHours, { fallback: 168, min: 1, max: 24 * 90 });
  const samplePercent = clampInteger(options.samplePercent, { fallback: 10, min: 0, max: 100 });
  const dueHours = clampInteger(options.dueHours, { fallback: 72, min: 1, max: 24 * 30 });
  const limit = clampInteger(options.limit, { fallback: 100, min: 1, max: 500 });

  const params = [
    arrays.actions,
    arrays.categories,
    arrays.canonicalEventTypes,
    arrays.sensitivities,
    arrays.reviewReasons,
    arrays.priorities,
    String(windowHours),
    samplePercent,
    limit,
    String(dueHours),
  ];
  const clauses = [
    'r.audit_log_id IS NULL',
    "l.created_at >= NOW() - ($7 || ' hours')::interval",
    "(c.priority IN ('urgent','high') OR $8 >= 100 OR random() < ($8::numeric / 100.0))",
  ];

  if (filters.property_id) {
    params.push(filters.property_id);
    clauses.push(`l.property_id = $${params.length}`);
  }

  const { rows } = await queryable.query(
    `WITH catalog AS (
       SELECT *
         FROM unnest(
           $1::text[],
           $2::text[],
           $3::text[],
           $4::text[],
           $5::text[],
           $6::text[]
         ) AS c(action, category, canonical_event_type, sensitivity, review_reason, priority)
     ),
     candidates AS (
       SELECT l.id,
              l.property_id,
              l.action,
              COALESCE(l.resource_type, l.entity_type, 'audit') AS resource_type,
              l.resource_id,
              c.category,
              c.canonical_event_type,
              c.sensitivity,
              c.review_reason,
              c.priority,
              l.created_at
         FROM property_audit_log l
         JOIN catalog c ON c.action = l.action
         LEFT JOIN sensitive_action_reviews r ON r.audit_log_id = l.id
        WHERE ${clauses.join(' AND ')}
        ORDER BY CASE c.priority
                   WHEN 'urgent' THEN 0
                   WHEN 'high' THEN 1
                   WHEN 'normal' THEN 2
                   ELSE 3
                 END,
                 l.created_at DESC
        LIMIT $9
     )
     INSERT INTO sensitive_action_reviews
       (audit_log_id, property_id, category, action, resource_type, resource_id,
        review_status, review_reason, classification_snapshot,
        due_at, priority, assignment_reason, escalation_status)
     SELECT c.id,
            c.property_id,
            c.category,
            c.action,
            c.resource_type,
            c.resource_id,
            'pending',
            c.review_reason,
            jsonb_build_object(
              'canonical_event_type', c.canonical_event_type,
              'category', c.category,
              'sensitivity', c.sensitivity,
              'review_reason', c.review_reason,
              'sampled_by', 'dh60_rule',
              'sampled_at', NOW()
            ),
            NOW() + ($10 || ' hours')::interval,
            c.priority,
            'auto-sampled by DH-60 review rules',
            'none'
       FROM candidates c
      ON CONFLICT (audit_log_id) DO NOTHING
      RETURNING id, audit_log_id, property_id, category, action, resource_type,
                resource_id, review_status, review_reason, reviewer_staff_id,
                reviewed_at, comment, classification_snapshot,
                assigned_reviewer_staff_id, assigned_by_staff_id, assigned_at,
                due_at, priority, assignment_reason, escalation_status,
                escalation_note, last_escalated_at, created_at, updated_at`,
    params,
  );

  return rows;
}

async function escalateOverdueSensitiveActionReviews({
  queryable,
  filters = {},
  options = {},
}) {
  const limit = clampInteger(options.limit, { fallback: 100, min: 1, max: 500 });
  const escalateAfterHours = clampInteger(options.escalateAfterHours, {
    fallback: 24,
    min: 1,
    max: 24 * 30,
  });
  const params = [String(escalateAfterHours), limit];
  const clauses = [
    "r.review_status = 'pending'",
    'r.due_at IS NOT NULL',
    'r.due_at < NOW()',
    `(
      r.escalation_status = 'none'
      OR (
        r.escalation_status = 'overdue'
        AND COALESCE(r.last_escalated_at, r.due_at) < NOW() - ($1 || ' hours')::interval
      )
    )`,
  ];

  if (filters.property_id) {
    params.push(filters.property_id);
    clauses.push(`r.property_id = $${params.length}`);
  }

  const { rows } = await queryable.query(
    `WITH candidates AS (
       SELECT r.id
         FROM sensitive_action_reviews r
        WHERE ${clauses.join(' AND ')}
        ORDER BY CASE r.priority
                   WHEN 'urgent' THEN 0
                   WHEN 'high' THEN 1
                   WHEN 'normal' THEN 2
                   ELSE 3
                 END,
                 r.due_at ASC
        LIMIT $2
        FOR UPDATE SKIP LOCKED
     )
     UPDATE sensitive_action_reviews r
        SET escalation_status = CASE
              WHEN r.escalation_status = 'overdue' THEN 'escalated'
              ELSE 'overdue'
            END,
            escalation_note = CASE
              WHEN r.escalation_status = 'overdue'
                THEN 'pending after overdue escalation window'
              ELSE 'due_at breached'
            END,
            last_escalated_at = NOW(),
            updated_at = NOW()
       FROM candidates c
      WHERE r.id = c.id
      RETURNING r.id, r.audit_log_id, r.property_id, r.category, r.action,
                r.resource_type, r.resource_id, r.review_status, r.review_reason,
                r.reviewer_staff_id, r.reviewed_at, r.comment,
                r.classification_snapshot, r.assigned_reviewer_staff_id,
                r.assigned_by_staff_id, r.assigned_at, r.due_at, r.priority,
                r.assignment_reason, r.escalation_status, r.escalation_note,
                r.last_escalated_at, r.created_at, r.updated_at`,
    params,
  );
  return rows;
}

function riskFlags(row, minActions) {
  const flags = [];
  if (Number(row.total_actions || 0) >= minActions) flags.push('high_volume');
  if (Number(row.high_risk_actions || 0) > 0) flags.push('high_risk_category');
  if (Number(row.off_hours_actions || 0) > 0) flags.push('off_hours');
  if (Number(row.overdue_reviews || 0) > 0) flags.push('overdue_reviews');
  return flags;
}

function mapAntiAbuseRow(row, minActions) {
  const totalActions = Number(row.total_actions || 0);
  const highRiskActions = Number(row.high_risk_actions || 0);
  const pendingReviews = Number(row.pending_reviews || 0);
  const overdueReviews = Number(row.overdue_reviews || 0);
  const offHoursActions = Number(row.off_hours_actions || 0);
  const distinctResources = Number(row.distinct_resources || 0);
  return {
    actor_uid: row.actor_uid || null,
    actor_role: row.actor_role || null,
    category: row.category,
    total_actions: totalActions,
    high_risk_actions: highRiskActions,
    pending_reviews: pendingReviews,
    overdue_reviews: overdueReviews,
    off_hours_actions: offHoursActions,
    distinct_resources: distinctResources,
    first_seen_at: row.first_seen_at || null,
    last_seen_at: row.last_seen_at || null,
    flags: riskFlags(row, minActions),
    risk_score: totalActions + (highRiskActions * 2) + (offHoursActions * 2) + (overdueReviews * 3),
  };
}

async function getSensitiveActionAntiAbuseAnalytics({
  queryable,
  filters = {},
  options = {},
}) {
  const catalogRows = buildSensitiveCatalogRows(filters.category || null);
  if (catalogRows.length === 0) {
    return { findings: [], summary: { total_findings: 0, actors: 0, high_risk_actions: 0, overdue_reviews: 0 } };
  }

  const arrays = catalogArrays(catalogRows);
  const windowHours = clampInteger(options.windowHours, { fallback: 168, min: 1, max: 24 * 90 });
  const minActions = clampInteger(options.minActions, { fallback: 5, min: 1, max: 1000 });
  const limit = clampInteger(options.limit, { fallback: 50, min: 1, max: 500 });
  const params = [
    arrays.actions,
    arrays.categories,
    arrays.canonicalEventTypes,
    arrays.sensitivities,
    arrays.reviewReasons,
    arrays.priorities,
    String(windowHours),
    minActions,
    limit,
  ];
  const clauses = [
    "l.created_at >= NOW() - ($7 || ' hours')::interval",
  ];
  if (filters.property_id) {
    params.push(filters.property_id);
    clauses.push(`l.property_id = $${params.length}`);
  }

  const { rows } = await queryable.query(
    `WITH catalog AS (
       SELECT *
         FROM unnest(
           $1::text[],
           $2::text[],
           $3::text[],
           $4::text[],
           $5::text[],
           $6::text[]
         ) AS c(action, category, canonical_event_type, sensitivity, review_reason, priority)
     )
     SELECT l.actor_uid,
            l.actor_role,
            c.category,
            COUNT(*)::int AS total_actions,
            COUNT(*) FILTER (WHERE c.priority IN ('urgent','high'))::int AS high_risk_actions,
            COUNT(*) FILTER (WHERE COALESCE(r.review_status, 'pending') = 'pending')::int AS pending_reviews,
            COUNT(*) FILTER (
              WHERE COALESCE(r.review_status, 'pending') = 'pending'
                AND r.due_at IS NOT NULL
                AND r.due_at < NOW()
            )::int AS overdue_reviews,
            COUNT(*) FILTER (
              WHERE EXTRACT(HOUR FROM l.created_at) < 7
                 OR EXTRACT(HOUR FROM l.created_at) >= 23
            )::int AS off_hours_actions,
            COUNT(DISTINCT COALESCE(l.resource_id::text, l.entity_id::text, l.id::text))::int AS distinct_resources,
            MIN(l.created_at) AS first_seen_at,
            MAX(l.created_at) AS last_seen_at
       FROM property_audit_log l
       JOIN catalog c ON c.action = l.action
       LEFT JOIN sensitive_action_reviews r ON r.audit_log_id = l.id
      WHERE ${clauses.join(' AND ')}
      GROUP BY l.actor_uid, l.actor_role, c.category
      HAVING COUNT(*) >= $8
          OR COUNT(*) FILTER (
               WHERE EXTRACT(HOUR FROM l.created_at) < 7
                  OR EXTRACT(HOUR FROM l.created_at) >= 23
             ) > 0
          OR COUNT(*) FILTER (
               WHERE COALESCE(r.review_status, 'pending') = 'pending'
                 AND r.due_at IS NOT NULL
                 AND r.due_at < NOW()
             ) > 0
      ORDER BY overdue_reviews DESC,
               off_hours_actions DESC,
               high_risk_actions DESC,
               total_actions DESC
      LIMIT $9`,
    params,
  );

  const findings = rows.map((row) => mapAntiAbuseRow(row, minActions));
  return {
    findings,
    summary: {
      total_findings: findings.length,
      actors: new Set(findings.map((row) => row.actor_uid).filter(Boolean)).size,
      high_risk_actions: findings.reduce((sum, row) => sum + row.high_risk_actions, 0),
      overdue_reviews: findings.reduce((sum, row) => sum + row.overdue_reviews, 0),
    },
  };
}

function normalizeDueAt(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw serviceError(400, 'due_at must be an ISO timestamp or null');
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw serviceError(400, 'due_at must be an ISO timestamp or null');
  return new Date(parsed).toISOString();
}

function normalizeOptionalText(value, field, maxLength = 1000) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw serviceError(400, `${field} must be string or null`);
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) throw serviceError(400, `${field} is too long`);
  return trimmed;
}

async function loadReviewableAuditRow(queryable, auditLogId) {
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
  return classified;
}

async function loadActiveStaff(queryable, staffId) {
  const { rows } = await queryable.query(
    `SELECT id, property_id, role
       FROM staff_users
      WHERE id = $1
        AND is_active = true`,
    [staffId],
  );
  return rows[0] || null;
}

async function assignSensitiveActionReview({
  queryable,
  user,
  auditLogId,
  assignedReviewerStaffId = null,
  dueAt = null,
  priority = 'normal',
  reason = null,
}) {
  if (!REVIEW_PRIORITIES.has(priority)) {
    throw serviceError(400, `priority must be one of: ${[...REVIEW_PRIORITIES].join(', ')}`);
  }

  const assignerStaffId = await resolveStaffIdByUid(queryable, user?.uid);
  if (!assignerStaffId) throw serviceError(403, 'Staff identity is not mapped to v1');
  const targetStaffId = assignedReviewerStaffId || assignerStaffId;
  const targetStaff = await loadActiveStaff(queryable, targetStaffId);
  if (!targetStaff) throw serviceError(400, 'assigned reviewer does not exist or is inactive');

  const classified = await loadReviewableAuditRow(queryable, auditLogId);
  if (
    classified.property_id
    && targetStaff.property_id
    && String(classified.property_id) !== String(targetStaff.property_id)
  ) {
    throw serviceError(400, 'assigned reviewer must belong to the audited property');
  }

  const normalizedDueAt = normalizeDueAt(dueAt);
  const normalizedReason = normalizeOptionalText(reason, 'reason');
  const propertyId = classified.property_id || targetStaff.property_id || null;

  const { rows } = await queryable.query(
    `INSERT INTO sensitive_action_reviews
       (audit_log_id, property_id, category, action, resource_type, resource_id,
        review_status, review_reason, classification_snapshot,
        assigned_reviewer_staff_id, assigned_by_staff_id, assigned_at,
        due_at, priority, assignment_reason, escalation_status)
     VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8::jsonb,$9,$10,NOW(),$11,$12,$13,'none')
     ON CONFLICT (audit_log_id)
     DO UPDATE SET
       assigned_reviewer_staff_id = EXCLUDED.assigned_reviewer_staff_id,
       assigned_by_staff_id = EXCLUDED.assigned_by_staff_id,
       assigned_at = NOW(),
       due_at = EXCLUDED.due_at,
       priority = EXCLUDED.priority,
       assignment_reason = EXCLUDED.assignment_reason,
       escalation_status = CASE
         WHEN EXCLUDED.due_at IS NOT NULL AND EXCLUDED.due_at < NOW() THEN 'overdue'
         ELSE 'none'
       END,
       review_reason = EXCLUDED.review_reason,
       classification_snapshot = EXCLUDED.classification_snapshot,
       updated_at = NOW()
     WHERE sensitive_action_reviews.review_status = 'pending'
     RETURNING id, audit_log_id, property_id, category, action, resource_type,
               resource_id, review_status, review_reason, reviewer_staff_id,
               reviewed_at, comment, classification_snapshot,
               assigned_reviewer_staff_id, assigned_by_staff_id, assigned_at,
               due_at, priority, assignment_reason, escalation_status,
               escalation_note, last_escalated_at, created_at, updated_at`,
    [
      classified.id,
      propertyId,
      classified.category,
      classified.action,
      classified.resource_type,
      classified.resource_id || null,
      classified.review_reason,
      JSON.stringify({
        canonical_event_type: classified.canonical_event_type,
        category: classified.category,
        sensitivity: classified.sensitivity,
        review_reason: classified.review_reason,
      }),
      targetStaff.id,
      assignerStaffId,
      normalizedDueAt,
      priority,
      normalizedReason,
    ],
  );

  if (!rows[0]) throw serviceError(409, 'Review is already attested and cannot be reassigned');
  return rows[0];
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

  const classified = await loadReviewableAuditRow(queryable, auditLogId);

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
  ESCALATION_STATUSES,
  REVIEW_PRIORITIES,
  REVIEW_STATUSES,
  assignSensitiveActionReview,
  attestSensitiveAction,
  escalateOverdueSensitiveActionReviews,
  getSensitiveActionAntiAbuseAnalytics,
  isAuditReviewServiceError,
  listSensitiveActionReviews,
  materializeSensitiveActionReviewSamples,
  summarizeSensitiveActionReviews,
};
