'use strict';

// platform-v1 property admin operations dashboard.
// Spec source: DH-35 + domhub-analytics-metric-definitions.md.
//
// Scope is intentionally object-level: caller passes the tenant DB pool and the
// current property_id resolved by propertyDbMiddleware. No cross-property reads
// happen here; DH-36 owns portfolio aggregation.

const { getOutboxMetrics } = require('./adminOutbox');

const PERIODS = Object.freeze({
  '24h': { hours: 24, interval: '24 hours' },
  '7d':  { hours: 24 * 7, interval: '168 hours' },
  '30d': { hours: 24 * 30, interval: '720 hours' },
});

const PERIOD_DEFAULT = '7d';

function parsePeriod(raw) {
  const value = raw ? String(raw).toLowerCase() : PERIOD_DEFAULT;
  if (!PERIODS[value]) {
    throw new Error(`unsupported period '${raw}'`);
  }
  return { key: value, ...PERIODS[value] };
}

function toInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toNullableNumber(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function ratio(numerator, denominator) {
  const den = toInt(denominator);
  if (den <= 0) return null;
  return toInt(numerator) / den;
}

function normalizeBreakdownLimit(value, fallback) {
  if (value === null) return null;
  const n = Number(value === undefined ? fallback : value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.trunc(n), 5000);
}

function limitClause(limit) {
  return Number.isInteger(limit) && limit > 0 ? `LIMIT ${limit}` : '';
}

function mapBreakdown(rows, keyName) {
  return rows.map((row) => ({
    [keyName]: row[keyName],
    total: toInt(row.total),
  }));
}

function mapAccessPointBreakdown(rows) {
  return rows.map((row) => ({
    access_point_id: row.access_point_id || null,
    name: row.name || 'Без КПП',
    allow_count: toInt(row.allow_count),
    denial_count: toInt(row.denial_count),
    total: toInt(row.total),
  }));
}

async function getRequestKpis(db, period) {
  const { rows: aggRows } = await db.query(
    `
      SELECT
        COUNT(*) FILTER (WHERE created_at >= NOW() - $1::interval) AS created,
        COUNT(*) FILTER (
          WHERE COALESCE(completed_at, resolved_at, updated_at) >= NOW() - $1::interval
            AND status IN ('completed','resolved')
        ) AS completed,
        COUNT(*) FILTER (
          WHERE status NOT IN ('completed','cancelled','rejected','expired','resolved')
        ) AS open,
        COUNT(*) FILTER (
          WHERE status NOT IN ('completed','cancelled','rejected','expired','resolved')
            AND (
              (first_response_due_at IS NOT NULL
                AND first_response_at IS NULL
                AND first_response_due_at < NOW())
              OR
              (resolution_due_at IS NOT NULL
                AND resolved_at IS NULL
                AND completed_at IS NULL
                AND resolution_due_at < NOW())
            )
        ) AS overdue_backlog,
        COUNT(*) FILTER (
          WHERE COALESCE(completed_at, resolved_at) >= NOW() - $1::interval
            AND resolution_due_at IS NOT NULL
            AND COALESCE(completed_at, resolved_at) <= resolution_due_at
        ) AS resolved_within_sla,
        COUNT(*) FILTER (
          WHERE COALESCE(completed_at, resolved_at) >= NOW() - $1::interval
            AND resolution_due_at IS NOT NULL
        ) AS resolved_with_sla,
        PERCENTILE_CONT(0.5) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (first_response_at - created_at)) / 60.0
        ) FILTER (
          WHERE first_response_at IS NOT NULL
            AND created_at >= NOW() - $1::interval
        ) AS first_response_median_minutes,
        PERCENTILE_CONT(0.5) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (COALESCE(resolved_at, completed_at) - created_at)) / 60.0
        ) FILTER (
          WHERE COALESCE(resolved_at, completed_at) IS NOT NULL
            AND created_at >= NOW() - $1::interval
        ) AS resolution_median_minutes
      FROM requests
      WHERE deleted_at IS NULL
    `,
    [period.interval],
  );

  const { rows: statusRows } = await db.query(
    `
      SELECT status, COUNT(*)::int AS total
        FROM requests
       WHERE deleted_at IS NULL
       GROUP BY status
       ORDER BY total DESC, status ASC
    `,
  );

  const { rows: priorityRows } = await db.query(
    `
      SELECT priority, COUNT(*)::int AS total
        FROM requests
       WHERE deleted_at IS NULL
       GROUP BY priority
       ORDER BY total DESC, priority ASC
    `,
  );

  const agg = aggRows[0] || {};
  return {
    created: toInt(agg.created),
    completed: toInt(agg.completed),
    open: toInt(agg.open),
    overdue_backlog: toInt(agg.overdue_backlog),
    resolved_within_sla: toInt(agg.resolved_within_sla),
    resolved_with_sla: toInt(agg.resolved_with_sla),
    sla_compliance_rate: ratio(agg.resolved_within_sla, agg.resolved_with_sla),
    first_response_median_minutes: toNullableNumber(agg.first_response_median_minutes),
    resolution_median_minutes: toNullableNumber(agg.resolution_median_minutes),
    by_status: mapBreakdown(statusRows, 'status'),
    by_priority: mapBreakdown(priorityRows, 'priority'),
  };
}

async function getAccessKpis(db, propertyId, period, options = {}) {
  const accessBreakdownLimit = normalizeBreakdownLimit(options.accessBreakdownLimit, 8);
  const peakTrafficWindowLimit = normalizeBreakdownLimit(options.peakTrafficWindowLimit, 6);

  const { rows: requestRows } = await db.query(
    `
      SELECT
        COUNT(*) FILTER (WHERE created_at >= NOW() - $1::interval) AS created,
        COUNT(*) FILTER (WHERE status = 'approved' AND approved_at >= NOW() - $1::interval) AS approved,
        COUNT(*) FILTER (WHERE status = 'rejected' AND rejected_at >= NOW() - $1::interval) AS rejected,
        COUNT(*) FILTER (WHERE status IN ('new','pending_approval','escalated')) AS pending,
        COUNT(*) FILTER (WHERE status = 'expired') AS expired
      FROM access_requests
      WHERE property_id = $2
    `,
    [period.interval, propertyId],
  );

  const { rows: visitRows } = await db.query(
    `
      SELECT
        COUNT(*) FILTER (
          WHERE occurred_at >= NOW() - $1::interval
            AND event_type IN ('entry_allowed','exit_allowed','manual_admit','override')
        ) AS allow_count,
        COUNT(*) FILTER (
          WHERE occurred_at >= NOW() - $1::interval
            AND event_type IN ('entry_denied','exit_denied','manual_deny')
        ) AS denial_count,
        COUNT(*) FILTER (
          WHERE occurred_at >= NOW() - $1::interval
            AND vehicle_plate IS NOT NULL
        ) AS vehicle_traffic_count,
        COUNT(*) FILTER (
          WHERE occurred_at >= NOW() - $1::interval
            AND created_at >= occurred_at
            AND event_type IN ('manual_admit','manual_deny','override')
        ) AS avg_decision_sample_count,
        AVG(EXTRACT(EPOCH FROM (created_at - occurred_at))) FILTER (
          WHERE occurred_at >= NOW() - $1::interval
            AND created_at >= occurred_at
            AND event_type IN ('manual_admit','manual_deny','override')
        ) AS avg_decision_seconds
      FROM visit_logs_v2
      WHERE property_id = $2
    `,
    [period.interval, propertyId],
  );

  const { rows: passRows } = await db.query(
    `
      SELECT
        COUNT(*) FILTER (WHERE status = 'active') AS active,
        COUNT(*) FILTER (
          WHERE status = 'used'
            AND created_at >= NOW() - $1::interval
        ) AS used
      FROM passes
      WHERE property_id = $2
    `,
    [period.interval, propertyId],
  );

  const { rows: accessPointRows } = await db.query(
    `
      SELECT
        vl.access_point_id::text AS access_point_id,
        COALESCE(ap.name, 'Без КПП') AS name,
        COUNT(*) FILTER (
          WHERE vl.event_type IN ('entry_allowed','exit_allowed','manual_admit','override')
        ) AS allow_count,
        COUNT(*) FILTER (
          WHERE vl.event_type IN ('entry_denied','exit_denied','manual_deny')
        ) AS denial_count,
        COUNT(*) AS total
      FROM visit_logs_v2 vl
      LEFT JOIN access_points ap
        ON ap.property_id = vl.property_id
       AND ap.id = vl.access_point_id
      WHERE vl.property_id = $2
        AND vl.occurred_at >= NOW() - $1::interval
      GROUP BY vl.access_point_id, ap.name
      ORDER BY total DESC, name ASC
      ${limitClause(accessBreakdownLimit)}
    `,
    [period.interval, propertyId],
  );

  const { rows: denyReasonRows } = await db.query(
    `
      SELECT
        COALESCE(
          NULLIF(provider_payload->>'reason', ''),
          NULLIF(provider_payload->>'degraded_reason', ''),
          event_type
        ) AS reason,
        COUNT(*)::int AS total
      FROM visit_logs_v2
      WHERE property_id = $2
        AND occurred_at >= NOW() - $1::interval
        AND event_type IN ('entry_denied','exit_denied','manual_deny')
      GROUP BY reason
      ORDER BY total DESC, reason ASC
      ${limitClause(accessBreakdownLimit)}
    `,
    [period.interval, propertyId],
  );

  const { rows: peakRows } = await db.query(
    `
      SELECT date_trunc('hour', occurred_at) AS window_start,
             COUNT(*)::int AS total
      FROM visit_logs_v2
      WHERE property_id = $2
        AND occurred_at >= NOW() - $1::interval
      GROUP BY window_start
      ORDER BY total DESC, window_start ASC
      ${limitClause(peakTrafficWindowLimit)}
    `,
    [period.interval, propertyId],
  );

  const { rows: overrideRows } = await db.query(
    `
      SELECT override_type, COUNT(*)::int AS total
      FROM access_overrides
      WHERE property_id = $2
        AND created_at >= NOW() - $1::interval
      GROUP BY override_type
      ORDER BY total DESC, override_type ASC
    `,
    [period.interval, propertyId],
  );

  const { rows: offlineRows } = await db.query(
    `
      SELECT replay_status, COUNT(*)::int AS total
      FROM security_offline_replay_events
      WHERE property_id = $2
        AND occurred_at >= NOW() - $1::interval
      GROUP BY replay_status
      ORDER BY total DESC, replay_status ASC
    `,
    [period.interval, propertyId],
  );

  const { rows: trustedRows } = await db.query(
    `
      SELECT
        COUNT(DISTINCT tv.id) FILTER (WHERE tv.is_active = true) AS active,
        COUNT(DISTINCT ar.id) FILTER (WHERE ar.created_at >= NOW() - $1::interval) AS passes_created
      FROM trusted_visitors tv
      LEFT JOIN access_requests ar
        ON ar.property_id = tv.property_id
       AND ar.trusted_visitor_id = tv.id
      WHERE tv.property_id = $2
    `,
    [period.interval, propertyId],
  );

  const { rows: skudRows } = await db.query(
    `
      SELECT
        COUNT(*) FILTER (
          WHERE sie.status IN ('failed','retrying','dead_lettered')
            AND sie.occurred_at >= NOW() - $1::interval
        ) AS failed_events,
        (
          SELECT COUNT(*)
          FROM hardware_manual_control_events hmce
          WHERE hmce.property_id = $2
            AND hmce.created_at >= NOW() - $1::interval
        ) AS manual_control_events
      FROM skud_integration_events sie
      WHERE sie.property_id = $2
    `,
    [period.interval, propertyId],
  );

  const reqAgg = requestRows[0] || {};
  const visitAgg = visitRows[0] || {};
  const passAgg = passRows[0] || {};
  const trustedAgg = trustedRows[0] || {};
  const skudAgg = skudRows[0] || {};
  const approved = toInt(reqAgg.approved);
  const rejected = toInt(reqAgg.rejected);

  return {
    requests_created: toInt(reqAgg.created),
    requests_approved: approved,
    requests_rejected: rejected,
    approval_rate: approved + rejected > 0 ? approved / (approved + rejected) : null,
    pending: toInt(reqAgg.pending),
    expired: toInt(reqAgg.expired),
    allow_count: toInt(visitAgg.allow_count),
    denial_count: toInt(visitAgg.denial_count),
    vehicle_traffic_count: toInt(visitAgg.vehicle_traffic_count),
    avg_decision_sample_count: toInt(visitAgg.avg_decision_sample_count),
    avg_decision_seconds: toNullableNumber(visitAgg.avg_decision_seconds),
    active_passes: toInt(passAgg.active),
    used_passes: toInt(passAgg.used),
    manual_override_count: overrideRows.reduce((sum, row) => sum + toInt(row.total), 0),
    offline_replay_count: offlineRows.reduce((sum, row) => sum + toInt(row.total), 0),
    trusted_visitors_active: toInt(trustedAgg.active),
    trusted_visitor_passes_created: toInt(trustedAgg.passes_created),
    skud_failed_events: toInt(skudAgg.failed_events),
    skud_manual_control_count: toInt(skudAgg.manual_control_events),
    by_access_point: mapAccessPointBreakdown(accessPointRows),
    deny_reasons: mapBreakdown(denyReasonRows, 'reason'),
    peak_traffic_windows: peakRows.map((row) => ({
      window_start: row.window_start instanceof Date ? row.window_start.toISOString() : row.window_start,
      total: toInt(row.total),
    })),
    manual_overrides_by_type: mapBreakdown(overrideRows, 'override_type'),
    offline_replay_by_status: mapBreakdown(offlineRows, 'replay_status'),
  };
}

async function getIncidentSummary(db, propertyId, period) {
  const { rows: aggRows } = await db.query(
    `
      SELECT
        COUNT(*) FILTER (WHERE status = 'open') AS open,
        COUNT(*) FILTER (WHERE status = 'investigating') AS investigating,
        COUNT(*) FILTER (
          WHERE status IN ('resolved','dismissed')
            AND resolved_at >= NOW() - $1::interval
        ) AS closed,
        COUNT(*) FILTER (
          WHERE status IN ('open','investigating')
            AND severity IN ('high','critical')
        ) AS high_priority_open,
        COUNT(*) FILTER (
          WHERE incident_type = 'blacklist_hit'
            AND created_at >= NOW() - $1::interval
        ) AS blacklist_hits,
        COUNT(*) FILTER (
          WHERE incident_type = 'suspicious_repeat_attempt'
            AND created_at >= NOW() - $1::interval
        ) AS suspicious_attempts,
        PERCENTILE_CONT(0.5) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (resolved_at - created_at)) / 60.0
        ) FILTER (
          WHERE status IN ('resolved','dismissed')
            AND resolved_at IS NOT NULL
            AND resolved_at >= NOW() - $1::interval
        ) AS resolution_median_minutes
      FROM access_incidents
      WHERE property_id = $2
    `,
    [period.interval, propertyId],
  );

  const { rows: typeRows } = await db.query(
    `
      SELECT incident_type, COUNT(*)::int AS total
        FROM access_incidents
       WHERE property_id = $2
         AND created_at >= NOW() - $1::interval
       GROUP BY incident_type
       ORDER BY total DESC, incident_type ASC
       LIMIT 8
    `,
    [period.interval, propertyId],
  );

  const agg = aggRows[0] || {};
  return {
    open: toInt(agg.open),
    investigating: toInt(agg.investigating),
    closed: toInt(agg.closed),
    high_priority_open: toInt(agg.high_priority_open),
    blacklist_hits: toInt(agg.blacklist_hits),
    suspicious_attempts: toInt(agg.suspicious_attempts),
    resolution_median_minutes: toNullableNumber(agg.resolution_median_minutes),
    by_type: mapBreakdown(typeRows, 'incident_type'),
  };
}

async function getNotificationHealth(db, period, opts = {}) {
  const logArgs = [period.interval];
  const propertyClause = opts.propertyId ? 'AND property_id = $2' : '';
  if (opts.propertyId) logArgs.push(opts.propertyId);
  const [outbox, logAggResult, logChannelResult] = await Promise.all([
    getOutboxMetrics(db, { propertyId: opts.propertyId }),
    db.query(
      `
        SELECT
          COUNT(*) FILTER (WHERE status = 'sent') AS sent,
          COUNT(*) FILTER (WHERE status = 'failed') AS failed
        FROM notification_log_v2
        WHERE created_at >= NOW() - $1::interval
          ${propertyClause}
      `,
      logArgs,
    ),
    db.query(
      `
        SELECT channel,
               COUNT(*) FILTER (WHERE status = 'sent') AS sent,
               COUNT(*) FILTER (WHERE status = 'failed') AS failed
          FROM notification_log_v2
         WHERE created_at >= NOW() - $1::interval
          ${propertyClause}
         GROUP BY channel
         ORDER BY channel ASC
      `,
      logArgs,
    ),
  ]);

  const agg = logAggResult.rows[0] || {};
  const sent = toInt(agg.sent);
  const failed = toInt(agg.failed);

  return {
    sent,
    failed,
    success_rate: sent + failed > 0 ? sent / (sent + failed) : null,
    queue: outbox.counts,
    oldest_pending_age_seconds: outbox.oldest_pending_age_seconds,
    per_channel: logChannelResult.rows.map((row) => {
      const channelSent = toInt(row.sent);
      const channelFailed = toInt(row.failed);
      return {
        channel: row.channel,
        sent: channelSent,
        failed: channelFailed,
        success_rate:
          channelSent + channelFailed > 0
            ? channelSent / (channelSent + channelFailed)
            : null,
      };
    }),
  };
}

async function getOperationsDashboard(db, opts = {}) {
  if (!db || typeof db.query !== 'function') {
    throw new Error('getOperationsDashboard: db with query() required');
  }
  if (!opts.propertyId) {
    throw new Error('getOperationsDashboard: propertyId required');
  }

  const period = parsePeriod(opts.period);
  const [
    requests,
    access,
    incidents,
    notifications,
  ] = await Promise.all([
    getRequestKpis(db, period),
    getAccessKpis(db, opts.propertyId, period, {
      accessBreakdownLimit: opts.accessBreakdownLimit,
      peakTrafficWindowLimit: opts.peakTrafficWindowLimit,
    }),
    getIncidentSummary(db, opts.propertyId, period),
    getNotificationHealth(db, period, { propertyId: opts.propertyId }),
  ]);

  return {
    generated_at: new Date().toISOString(),
    property_id: opts.propertyId,
    period: {
      key: period.key,
      hours: period.hours,
    },
    requests,
    access,
    incidents,
    notifications,
  };
}

module.exports = {
  getOperationsDashboard,
  getRequestKpis,
  getAccessKpis,
  getIncidentSummary,
  getNotificationHealth,
  parsePeriod,
  PERIODS,
  PERIOD_DEFAULT,
};
