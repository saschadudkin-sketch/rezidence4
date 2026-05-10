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

function mapBreakdown(rows, keyName) {
  return rows.map((row) => ({
    [keyName]: row[keyName],
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

async function getAccessKpis(db, propertyId, period) {
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
        ) AS vehicle_traffic_count
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

  const reqAgg = requestRows[0] || {};
  const visitAgg = visitRows[0] || {};
  const passAgg = passRows[0] || {};
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
    active_passes: toInt(passAgg.active),
    used_passes: toInt(passAgg.used),
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

async function getNotificationHealth(db, period) {
  const [outbox, logAggResult, logChannelResult] = await Promise.all([
    getOutboxMetrics(db),
    db.query(
      `
        SELECT
          COUNT(*) FILTER (WHERE status = 'sent') AS sent,
          COUNT(*) FILTER (WHERE status = 'failed') AS failed
        FROM notification_log_v2
        WHERE created_at >= NOW() - $1::interval
      `,
      [period.interval],
    ),
    db.query(
      `
        SELECT channel,
               COUNT(*) FILTER (WHERE status = 'sent') AS sent,
               COUNT(*) FILTER (WHERE status = 'failed') AS failed
          FROM notification_log_v2
         WHERE created_at >= NOW() - $1::interval
         GROUP BY channel
         ORDER BY channel ASC
      `,
      [period.interval],
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
    getAccessKpis(db, opts.propertyId, period),
    getIncidentSummary(db, opts.propertyId, period),
    getNotificationHealth(db, period),
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
