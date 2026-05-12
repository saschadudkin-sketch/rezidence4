'use strict';

const { isStaff } = require('../../constants');
const { ServiceError } = require('./RequestErrors');

const TERMINAL_REQUEST_STATUSES = new Set(['completed', 'cancelled', 'rejected', 'expired']);
const EMERGENCY_TYPES = new Set([
  'water',
  'heating',
  'electricity',
  'fire_smoke',
  'access_control',
  'security',
  'territory',
  'contractor',
  'other',
]);
const SEVERITIES = new Set(['P0', 'P1', 'P2']);
const ESCALATION_TARGETS = new Set([
  'security',
  'concierge',
  'technician',
  'contractor',
  'property_admin',
  'management_company_admin',
]);
const DISPATCH_ACTIONS = new Set(['acknowledge', 'dispatch', 'escalate', 'resolve', 'cancel']);
const DRILL_STATUSES = new Set(['planned', 'running', 'passed', 'failed', 'cancelled']);
const PROVIDER_DELIVERY_CHANNELS = new Set([
  'web_push',
  'sms',
  'telegram',
  'email',
  'phone',
  'webhook',
  'external_dispatch',
  'contractor_company',
  'internal_roster',
]);
const PROVIDER_DELIVERY_STATUSES = new Set([
  'sent',
  'delivered',
  'acknowledged',
  'failed',
  'timed_out',
  'not_required',
]);
const MANAGER_ROLES = new Set([
  'admin',
  'security',
  'concierge',
  'technician',
  'property_admin',
  'management_company_admin',
  'platform_admin',
]);

function assertCanManageEmergency(user) {
  if (!MANAGER_ROLES.has(user?.role) && !isStaff(user?.role)) {
    throw new ServiceError('Forbidden', 403);
  }
}

function formatEmergencyProfileRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    propertyId: row.property_id || null,
    requestId: row.request_id,
    emergencyType: row.emergency_type,
    severity: row.severity,
    dispatchStatus: row.dispatch_status,
    escalationTarget: row.escalation_target,
    firstResponseDueAt: row.first_response_due_at || null,
    resolutionDueAt: row.resolution_due_at || null,
    acknowledgedAt: row.acknowledged_at || null,
    acknowledgedByUid: row.acknowledged_by_uid || null,
    dispatchedAt: row.dispatched_at || null,
    dispatchedByUid: row.dispatched_by_uid || null,
    escalatedAt: row.escalated_at || null,
    escalatedByUid: row.escalated_by_uid || null,
    resolvedAt: row.resolved_at || null,
    notificationStatus: row.notification_status || 'pending',
    metadata: row.metadata || {},
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
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

function toInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeBoundedInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  const safe = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(max, Math.max(min, safe));
}

function normalizePropertyId(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || null;
}

function formatOnCallRosterRow(row) {
  return {
    id: row.id,
    propertyId: row.property_id || null,
    escalationTarget: row.escalation_target,
    displayName: row.display_name,
    provider: row.provider,
    contactRef: row.contact_ref || null,
    status: row.status,
    startsAt: row.starts_at || null,
    endsAt: row.ends_at || null,
    priority: toInt(row.priority),
    metadata: parseJsonObject(row.metadata),
    updatedAt: row.updated_at || null,
  };
}

function formatProviderEvidenceRow(row) {
  return {
    channel: row.channel || 'unknown',
    status: row.status || 'unknown',
    total: toInt(row.total),
    failed: toInt(row.failed),
    lastEventAt: row.last_event_at || null,
  };
}

function formatProviderDeliveryEvidenceRow(row) {
  return {
    id: row.id,
    propertyId: row.property_id || null,
    requestId: row.request_id || null,
    drillId: row.drill_id || null,
    provider: row.provider,
    channel: row.channel,
    scenarioType: row.scenario_type,
    status: row.status,
    latencyMs: row.latency_ms === null || row.latency_ms === undefined ? null : toInt(row.latency_ms),
    externalDeliveryId: row.external_delivery_id || null,
    observedAt: row.observed_at || null,
    recordedByUid: row.recorded_by_uid || null,
    payload: parseJsonObject(row.payload),
    createdAt: row.created_at || null,
  };
}

function formatDrillRow(row) {
  return {
    id: row.id,
    propertyId: row.property_id || null,
    scenarioType: row.scenario_type,
    severity: row.severity,
    escalationTarget: row.escalation_target,
    requestId: row.request_id || null,
    status: row.status,
    startedAt: row.started_at || null,
    completedAt: row.completed_at || null,
    createdByUid: row.created_by_uid || null,
    summary: row.summary || null,
    findings: parseJsonObject(row.findings),
    notificationEvidence: parseJsonObject(row.notification_evidence),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function normalizeEnum(value, allowed, fallback, field) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) return fallback;
  if (!allowed.has(normalized)) {
    throw new ServiceError(`${field} must be one of: ${[...allowed].join(', ')}`, 400);
  }
  return normalized;
}

function normalizeNullableInt(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new ServiceError(`${field} must be a non-negative integer`, 400);
  }
  return parsed;
}

function deriveEmergencyType(code) {
  const text = String(code || '').toLowerCase();
  if (text.includes('water')) return 'water';
  if (text.includes('heating')) return 'heating';
  if (text.includes('electric')) return 'electricity';
  if (text.includes('fire') || text.includes('smoke')) return 'fire_smoke';
  if (text.includes('access') || text.includes('barrier') || text.includes('gate')) return 'access_control';
  if (text.includes('security')) return 'security';
  if (text.includes('contractor')) return 'contractor';
  if (text.includes('territory') || text.includes('road')) return 'territory';
  return 'other';
}

function defaultSeverity(emergencyType) {
  if (emergencyType === 'fire_smoke' || emergencyType === 'security') return 'P0';
  if (emergencyType === 'contractor' || emergencyType === 'territory') return 'P2';
  return 'P1';
}

function defaultEscalationTarget(emergencyType) {
  if (emergencyType === 'fire_smoke' || emergencyType === 'security' || emergencyType === 'access_control') {
    return 'security';
  }
  if (emergencyType === 'contractor') return 'contractor';
  if (emergencyType === 'territory') return 'concierge';
  return 'technician';
}

function buildEmergencyProfileInput({ request, categoryProfile, body = {}, propertyId = null }) {
  if (!categoryProfile?.isEmergency) return null;

  const emergencyType = normalizeEnum(
    body.emergencyType || body.emergency_type || categoryProfile.metadata?.emergency_type,
    EMERGENCY_TYPES,
    deriveEmergencyType(categoryProfile.code || request.category),
    'emergencyType',
  );
  const severity = normalizeEnum(
    body.severity || categoryProfile.metadata?.severity,
    SEVERITIES,
    defaultSeverity(emergencyType),
    'severity',
  );
  const escalationTarget = normalizeEnum(
    body.escalationTarget || body.escalation_target || categoryProfile.metadata?.escalation_target,
    ESCALATION_TARGETS,
    defaultEscalationTarget(emergencyType),
    'escalationTarget',
  );

  return {
    propertyId,
    requestId: request.id,
    emergencyType,
    severity,
    escalationTarget,
    firstResponseDueAt: request.first_response_due_at || null,
    resolutionDueAt: request.resolution_due_at || null,
    metadata: {
      category: categoryProfile.code || request.category,
      category_name: categoryProfile.name || null,
      created_by_uid: request.created_by_uid || null,
      created_by_role: request.created_by_role || null,
      first_response_minutes: categoryProfile.firstResponseMinutes ?? null,
      resolution_minutes: categoryProfile.resolutionMinutes ?? null,
    },
  };
}

async function createEmergencyProfileForRequest(queryDb, args) {
  const input = buildEmergencyProfileInput(args);
  if (!input) return null;

  const { rows } = await queryDb.query(
    `INSERT INTO emergency_request_profiles
       (property_id, request_id, emergency_type, severity, escalation_target,
        first_response_due_at, resolution_due_at, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (request_id)
     DO UPDATE SET
       emergency_type=EXCLUDED.emergency_type,
       severity=EXCLUDED.severity,
       escalation_target=EXCLUDED.escalation_target,
       first_response_due_at=EXCLUDED.first_response_due_at,
       resolution_due_at=EXCLUDED.resolution_due_at,
       metadata=emergency_request_profiles.metadata || EXCLUDED.metadata,
       updated_at=NOW()
     RETURNING *`,
    [
      input.propertyId,
      input.requestId,
      input.emergencyType,
      input.severity,
      input.escalationTarget,
      input.firstResponseDueAt,
      input.resolutionDueAt,
      input.metadata,
    ],
  );
  return formatEmergencyProfileRow(rows[0]);
}

function parseLimit(value) {
  return Math.min(100, Math.max(1, Number.parseInt(value, 10) || 50));
}

async function listEmergencyQueue(user, queryDb, filters = {}) {
  assertCanManageEmergency(user);
  const params = [];
  const where = ['r.deleted_at IS NULL'];
  const propertyId = normalizePropertyId(filters.property_id || filters.propertyId || user?.property_id || user?.propertyId);

  const status = typeof filters.status === 'string' ? filters.status.trim() : '';
  if (status) {
    params.push(status);
    where.push(`p.dispatch_status = $${params.length}`);
  } else {
    params.push([...TERMINAL_REQUEST_STATUSES]);
    where.push(`r.status <> ALL($${params.length}::text[])`);
    where.push("p.dispatch_status NOT IN ('resolved','cancelled')");
  }

  const severity = typeof filters.severity === 'string' ? filters.severity.trim() : '';
  if (severity) {
    if (!SEVERITIES.has(severity)) throw new ServiceError('Invalid severity', 400);
    params.push(severity);
    where.push(`p.severity = $${params.length}`);
  }

  if (propertyId) {
    params.push(propertyId);
    where.push(`p.property_id::text = $${params.length}`);
  }

  params.push(parseLimit(filters.limit));
  const limitParam = `$${params.length}`;
  const { rows } = await queryDb.query(
    `SELECT p.*,
            r.type AS request_type,
            r.category AS request_category,
            r.status AS request_status,
            r.created_by_uid,
            r.created_by_name,
            r.created_by_role,
            r.comment
       FROM emergency_request_profiles p
       JOIN requests r ON r.id = p.request_id
      WHERE ${where.join(' AND ')}
      ORDER BY CASE p.severity WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 ELSE 2 END,
               p.first_response_due_at ASC NULLS LAST,
               p.created_at ASC
      LIMIT ${limitParam}`,
    params,
  );

  return {
    data: rows.map((row) => ({
      ...formatEmergencyProfileRow(row),
      request: {
        type: row.request_type,
        category: row.request_category,
        status: row.request_status,
        createdByUid: row.created_by_uid,
        createdByName: row.created_by_name,
        createdByRole: row.created_by_role,
        comment: row.comment || '',
      },
    })),
  };
}

async function listEmergencyReadiness(user, queryDb, filters = {}) {
  assertCanManageEmergency(user);
  const propertyId = normalizePropertyId(filters.property_id || filters.propertyId || user?.property_id || user?.propertyId);
  const windowHours = normalizeBoundedInt(filters.window_hours || filters.windowHours, 168, 1, 720);
  const limit = normalizeBoundedInt(filters.limit, 25, 1, 100);
  const generatedAt = new Date().toISOString();

  const propertyParams = [propertyId];
  const propertyWhere = '($1::text IS NULL OR p.property_id::text = $1::text)';
  const rosterWhere = '($1::text IS NULL OR property_id::text = $1::text)';
  const drillWhere = '($1::text IS NULL OR property_id::text = $1::text)';

  const [summaryResult, queueResult, rosterResult, notificationResult, drillResult, deliveryEvidenceResult] = await Promise.all([
    queryDb.query(
      `SELECT
          COUNT(*) FILTER (WHERE p.dispatch_status NOT IN ('resolved','cancelled'))::int AS active_emergencies,
          COUNT(*) FILTER (
            WHERE p.severity = 'P0'
              AND p.dispatch_status NOT IN ('resolved','cancelled')
          )::int AS p0_active,
          COUNT(*) FILTER (
            WHERE p.dispatch_status NOT IN ('resolved','cancelled')
              AND p.acknowledged_at IS NULL
              AND p.first_response_due_at < NOW()
          )::int AS first_response_overdue,
          COUNT(*) FILTER (
            WHERE p.dispatch_status NOT IN ('resolved','cancelled')
              AND p.resolved_at IS NULL
              AND p.resolution_due_at < NOW()
          )::int AS resolution_overdue,
          COUNT(*) FILTER (WHERE p.notification_status = 'failed')::int AS notification_failed,
          COUNT(*) FILTER (WHERE p.notification_status = 'sent')::int AS notification_sent
         FROM emergency_request_profiles p
        WHERE ${propertyWhere}`,
      propertyParams,
    ),
    queryDb.query(
      `SELECT p.*,
              r.type AS request_type,
              r.category AS request_category,
              r.status AS request_status,
              r.created_by_uid,
              r.created_by_name,
              r.created_by_role,
              r.comment
         FROM emergency_request_profiles p
         JOIN requests r ON r.id = p.request_id
        WHERE ${propertyWhere}
          AND r.deleted_at IS NULL
          AND p.dispatch_status NOT IN ('resolved','cancelled')
        ORDER BY CASE p.severity WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 ELSE 2 END,
                 p.first_response_due_at ASC NULLS LAST,
                 p.created_at ASC
        LIMIT $2`,
      [propertyId, limit],
    ),
    queryDb.query(
      `SELECT id, property_id, escalation_target, display_name, provider,
              contact_ref, status, starts_at, ends_at, priority, metadata,
              created_at, updated_at
         FROM emergency_on_call_rosters
        WHERE ${rosterWhere}
          AND status = 'active'
          AND (starts_at IS NULL OR starts_at <= NOW())
          AND (ends_at IS NULL OR ends_at >= NOW())
        ORDER BY priority ASC, escalation_target ASC, display_name ASC
        LIMIT $2`,
      [propertyId, limit],
    ),
    queryDb.query(
      `SELECT channel,
              status,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
              MAX(created_at) AS last_event_at
         FROM notification_log
        WHERE event_type = 'request.emergency_created'
          AND created_at >= NOW() - ($1::int * INTERVAL '1 hour')
        GROUP BY channel, status
        ORDER BY MAX(created_at) DESC NULLS LAST, channel ASC, status ASC`,
      [windowHours],
    ),
    queryDb.query(
      `SELECT id, property_id, scenario_type, severity, escalation_target,
              request_id, status, started_at, completed_at, created_by_uid,
              summary, findings, notification_evidence, created_at, updated_at
         FROM emergency_dispatch_drills
        WHERE ${drillWhere}
        ORDER BY COALESCE(started_at, created_at) DESC
        LIMIT $2`,
      [propertyId, limit],
    ),
    queryDb.query(
      `SELECT id, property_id, request_id, drill_id, provider, channel,
              scenario_type, status, latency_ms, external_delivery_id,
              observed_at, recorded_by_uid, payload, created_at
         FROM emergency_provider_delivery_evidence
        WHERE ${rosterWhere}
          AND observed_at >= NOW() - ($2::int * INTERVAL '1 hour')
        ORDER BY observed_at DESC, created_at DESC
        LIMIT $3`,
      [propertyId, windowHours, limit],
    ),
  ]);

  const summaryRow = summaryResult.rows[0] || {};
  const providerEvidence = notificationResult.rows.map(formatProviderEvidenceRow);
  const drills = drillResult.rows.map(formatDrillRow);
  const liveProviderDeliveryEvidence = deliveryEvidenceResult.rows.map(formatProviderDeliveryEvidenceRow);
  const queue = queueResult.rows.map((row) => ({
    ...formatEmergencyProfileRow(row),
    request: {
      type: row.request_type,
      category: row.request_category,
      status: row.request_status,
      createdByUid: row.created_by_uid,
      createdByName: row.created_by_name,
      createdByRole: row.created_by_role,
      comment: row.comment || '',
    },
  }));

  return {
    property_id: propertyId,
    generated_at: generatedAt,
    window_hours: windowHours,
    summary: {
      active_emergencies: toInt(summaryRow.active_emergencies),
      p0_active: toInt(summaryRow.p0_active),
      first_response_overdue: toInt(summaryRow.first_response_overdue),
      resolution_overdue: toInt(summaryRow.resolution_overdue),
      notification_sent: toInt(summaryRow.notification_sent),
      notification_failed: toInt(summaryRow.notification_failed),
      active_on_call_rows: rosterResult.rows.length,
      drill_records: drills.length,
      provider_delivery_evidence_rows: liveProviderDeliveryEvidence.length,
    },
    queue,
    on_call_roster: rosterResult.rows.map(formatOnCallRosterRow),
    provider_notification_evidence: providerEvidence,
    drill_records: drills,
    live_provider_delivery_evidence: liveProviderDeliveryEvidence,
    evidence: {
      source_tables: [
        'emergency_request_profiles',
        'requests',
        'emergency_on_call_rosters',
        'notification_log',
        'emergency_dispatch_drills',
        'emergency_provider_delivery_evidence',
      ],
      notification_event_type: 'request.emergency_created',
      returned_queue_rows: queue.length,
      returned_roster_rows: rosterResult.rows.length,
      returned_notification_rows: providerEvidence.length,
      returned_drill_rows: drills.length,
      returned_provider_delivery_rows: liveProviderDeliveryEvidence.length,
      generated_at: generatedAt,
    },
  };
}

function normalizeDispatchAction(body = {}) {
  const action = String(body.action || '').trim();
  if (!DISPATCH_ACTIONS.has(action)) {
    throw new ServiceError(`action must be one of: ${[...DISPATCH_ACTIONS].join(', ')}`, 400);
  }
  return action;
}

async function recordEmergencyDispatchAction(user, requestId, body, queryDb) {
  assertCanManageEmergency(user);
  const action = normalizeDispatchAction(body);
  const escalationTarget = normalizeEnum(
    body.escalationTarget || body.escalation_target,
    ESCALATION_TARGETS,
    null,
    'escalationTarget',
  );
  const actorUid = user?.uid || null;

  const statusByAction = {
    acknowledge: 'acknowledged',
    dispatch: 'dispatched',
    escalate: 'escalated',
    resolve: 'resolved',
    cancel: 'cancelled',
  };
  const profileFields = [
    'dispatch_status=$1',
    'updated_at=NOW()',
  ];
  const profileValues = [statusByAction[action]];

  if (action === 'acknowledge') {
    profileFields.push('acknowledged_at=COALESCE(acknowledged_at, NOW())');
    profileFields.push(`acknowledged_by_uid=COALESCE(acknowledged_by_uid, $${profileValues.length + 1})`);
    profileValues.push(actorUid);
  }
  if (action === 'dispatch') {
    profileFields.push('dispatched_at=COALESCE(dispatched_at, NOW())');
    profileFields.push(`dispatched_by_uid=COALESCE(dispatched_by_uid, $${profileValues.length + 1})`);
    profileValues.push(actorUid);
    if (escalationTarget) {
      profileFields.push(`escalation_target=$${profileValues.length + 1}`);
      profileValues.push(escalationTarget);
    }
  }
  if (action === 'escalate') {
    profileFields.push('escalated_at=COALESCE(escalated_at, NOW())');
    profileFields.push(`escalated_by_uid=COALESCE(escalated_by_uid, $${profileValues.length + 1})`);
    profileValues.push(actorUid);
  }
  if (action === 'resolve') profileFields.push('resolved_at=COALESCE(resolved_at, NOW())');
  if (body.notificationStatus || body.notification_status) {
    profileFields.push(`notification_status=$${profileValues.length + 1}`);
    profileValues.push(normalizeEnum(
      body.notificationStatus || body.notification_status,
      new Set(['pending', 'sent', 'failed', 'not_required']),
      'pending',
      'notificationStatus',
    ));
  }

  profileValues.push(requestId);
  const { rows } = await queryDb.query(
    `UPDATE emergency_request_profiles
        SET ${profileFields.join(', ')}
      WHERE request_id = $${profileValues.length}
      RETURNING *`,
    profileValues,
  );
  if (!rows[0]) throw new ServiceError('Emergency profile not found', 404);

  if (action === 'acknowledge' || action === 'dispatch') {
    await queryDb.query(
      `UPDATE requests
          SET first_response_at=COALESCE(first_response_at, NOW()),
              sla_state=CASE WHEN sla_state='on_track' THEN 'responded' ELSE sla_state END,
              assigned_to_role=COALESCE($2, assigned_to_role),
              assigned_at=CASE WHEN $2::text IS NULL THEN assigned_at ELSE COALESCE(assigned_at, NOW()) END,
              updated_at=NOW()
        WHERE id=$1`,
      [requestId, action === 'dispatch' ? (escalationTarget || rows[0].escalation_target) : null],
    );
  }
  if (action === 'escalate') {
    await queryDb.query(
      `UPDATE requests
          SET sla_state='emergency_escalated',
              escalation_level=escalation_level + 1,
              escalated_at=COALESCE(escalated_at, NOW()),
              escalation_reason=$2,
              updated_at=NOW()
        WHERE id=$1`,
      [requestId, body.reason || 'manual emergency escalation'],
    );
  }
  if (action === 'resolve') {
    await queryDb.query(
      `UPDATE requests
          SET resolved_at=COALESCE(resolved_at, NOW()),
              sla_state='resolved',
              updated_at=NOW()
        WHERE id=$1`,
      [requestId],
    );
  }

  return formatEmergencyProfileRow(rows[0]);
}

async function createEmergencyDrillRecord(user, queryDb, body = {}) {
  assertCanManageEmergency(user);
  const propertyId = normalizePropertyId(body.property_id || body.propertyId || user?.property_id || user?.propertyId);
  if (!propertyId) throw new ServiceError('property_id is required', 400);

  const scenarioType = normalizeEnum(
    body.scenarioType || body.scenario_type,
    EMERGENCY_TYPES,
    'other',
    'scenarioType',
  );
  const severity = normalizeEnum(body.severity, SEVERITIES, defaultSeverity(scenarioType), 'severity');
  const escalationTarget = normalizeEnum(
    body.escalationTarget || body.escalation_target,
    ESCALATION_TARGETS,
    defaultEscalationTarget(scenarioType),
    'escalationTarget',
  );
  const status = normalizeEnum(body.status, DRILL_STATUSES, 'passed', 'status');
  const startedAt = body.startedAt || body.started_at || null;
  const completedAt = body.completedAt || body.completed_at || null;

  const { rows } = await queryDb.query(
    `INSERT INTO emergency_dispatch_drills
       (property_id, scenario_type, severity, escalation_target, request_id,
        status, started_at, completed_at, created_by_uid, summary, findings,
        notification_evidence)
     VALUES (
       $1,$2,$3,$4,$5,$6,
       COALESCE($7::timestamptz, NOW()),
       COALESCE(
         $8::timestamptz,
         CASE WHEN $6 IN ('passed','failed','cancelled') THEN NOW() ELSE NULL END
       ),
       $9,$10,$11,$12
     )
     RETURNING *`,
    [
      propertyId,
      scenarioType,
      severity,
      escalationTarget,
      body.requestId || body.request_id || null,
      status,
      startedAt,
      completedAt,
      user?.uid || null,
      body.summary || null,
      parseJsonObject(body.findings),
      parseJsonObject(body.notificationEvidence || body.notification_evidence),
    ],
  );
  return formatDrillRow(rows[0]);
}

async function recordEmergencyProviderDeliveryEvidence(user, queryDb, body = {}) {
  assertCanManageEmergency(user);
  const propertyId = normalizePropertyId(body.property_id || body.propertyId || user?.property_id || user?.propertyId);
  if (!propertyId) throw new ServiceError('property_id is required', 400);

  const provider = String(body.provider || '').trim();
  if (!provider || provider.length > 40) throw new ServiceError('provider is required', 400);
  const channel = normalizeEnum(
    body.channel,
    PROVIDER_DELIVERY_CHANNELS,
    null,
    'channel',
  );
  const scenarioType = normalizeEnum(
    body.scenarioType || body.scenario_type,
    EMERGENCY_TYPES,
    'other',
    'scenarioType',
  );
  const status = normalizeEnum(
    body.status,
    PROVIDER_DELIVERY_STATUSES,
    'sent',
    'status',
  );

  const { rows } = await queryDb.query(
    `INSERT INTO emergency_provider_delivery_evidence
       (property_id, request_id, drill_id, provider, channel, scenario_type,
        status, latency_ms, external_delivery_id, observed_at, recorded_by_uid,
        payload)
     VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,
       COALESCE($10::timestamptz, NOW()),$11,$12::jsonb
     )
     RETURNING id, property_id, request_id, drill_id, provider, channel,
               scenario_type, status, latency_ms, external_delivery_id,
               observed_at, recorded_by_uid, payload, created_at`,
    [
      propertyId,
      body.requestId || body.request_id || null,
      body.drillId || body.drill_id || null,
      provider,
      channel,
      scenarioType,
      status,
      normalizeNullableInt(body.latencyMs ?? body.latency_ms, 'latencyMs'),
      body.externalDeliveryId || body.external_delivery_id || null,
      body.observedAt || body.observed_at || null,
      user?.uid || null,
      JSON.stringify(parseJsonObject(body.payload)),
    ],
  );

  return formatProviderDeliveryEvidenceRow(rows[0]);
}

module.exports = {
  buildEmergencyProfileInput,
  createEmergencyDrillRecord,
  createEmergencyProfileForRequest,
  listEmergencyReadiness,
  listEmergencyQueue,
  recordEmergencyProviderDeliveryEvidence,
  recordEmergencyDispatchAction,
  formatEmergencyProfileRow,
};
