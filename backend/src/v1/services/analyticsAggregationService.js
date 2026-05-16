'use strict';

const {
  getOperationsDashboard,
  parsePeriod,
} = require('./operationsDashboard');

const SNAPSHOT_COLS = `
  id, property_id, metric_group, period, window_started_at, window_ended_at,
  generated_at, generated_by, source_version, payload, flat_rows, row_count,
  created_at
`;

const SOURCE_VERSION = 'dh45_v1';
const METRIC_GROUP = 'operations_dashboard';

function toNumberOrNull(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return value;
}

function escapeCsvValue(value) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function metricRow(snapshot, {
  metricKey,
  metricGroup,
  value,
  unit = 'count',
  dimensions = {},
}) {
  return {
    property_id: snapshot.property_id,
    period: snapshot.period.key,
    generated_at: snapshot.generated_at,
    metric_group: metricGroup,
    metric_key: metricKey,
    value: toNumberOrNull(value),
    unit,
    dimensions,
  };
}

function flattenOperationsDashboard(snapshot) {
  const rows = [];
  const add = (metricGroup, metricKey, value, unit = 'count', dimensions = {}) => {
    rows.push(metricRow(snapshot, { metricKey, metricGroup, value, unit, dimensions }));
  };

  const requests = snapshot.requests || {};
  add('requests', 'requests.created', requests.created);
  add('requests', 'requests.completed', requests.completed);
  add('requests', 'requests.open', requests.open);
  add('requests', 'requests.overdue_backlog', requests.overdue_backlog);
  add('requests', 'requests.sla_compliance_rate', requests.sla_compliance_rate, 'ratio');
  add('requests', 'requests.first_response_median_minutes', requests.first_response_median_minutes, 'minutes');
  add('requests', 'requests.resolution_median_minutes', requests.resolution_median_minutes, 'minutes');
  for (const item of requests.by_status || []) {
    add('requests', 'requests.by_status', item.total, 'count', { status: item.status });
  }
  for (const item of requests.by_priority || []) {
    add('requests', 'requests.by_priority', item.total, 'count', { priority: item.priority });
  }

  const access = snapshot.access || {};
  add('access', 'access.requests_created', access.requests_created);
  add('access', 'access.requests_approved', access.requests_approved);
  add('access', 'access.requests_rejected', access.requests_rejected);
  add('access', 'access.approval_rate', access.approval_rate, 'ratio');
  add('access', 'access.allow_count', access.allow_count);
  add('access', 'access.denial_count', access.denial_count);
  add('access', 'access.vehicle_traffic_count', access.vehicle_traffic_count);
  add('access', 'access.avg_decision_sample_count', access.avg_decision_sample_count);
  add('access', 'access.avg_decision_seconds', access.avg_decision_seconds, 'seconds');
  add('access', 'access.active_passes', access.active_passes);
  add('access', 'access.used_passes', access.used_passes);
  add('access', 'access.manual_override_count', access.manual_override_count);
  add('access', 'access.offline_replay_count', access.offline_replay_count);
  add('access', 'access.trusted_visitors_active', access.trusted_visitors_active);
  add('access', 'access.trusted_visitor_passes_created', access.trusted_visitor_passes_created);
  add('access', 'access.skud_failed_events', access.skud_failed_events);
  add('access', 'access.skud_manual_control_count', access.skud_manual_control_count);
  for (const item of access.by_access_point || []) {
    add('access', 'access.by_access_point.total', item.total, 'count', {
      access_point_id: item.access_point_id || null,
      name: item.name,
    });
    add('access', 'access.by_access_point.allow_count', item.allow_count, 'count', {
      access_point_id: item.access_point_id || null,
      name: item.name,
    });
    add('access', 'access.by_access_point.denial_count', item.denial_count, 'count', {
      access_point_id: item.access_point_id || null,
      name: item.name,
    });
  }
  for (const item of access.deny_reasons || []) {
    add('access', 'access.deny_reasons', item.total, 'count', { reason: item.reason });
  }
  for (const item of access.peak_traffic_windows || []) {
    add('access', 'access.peak_traffic_windows', item.total, 'count', { window_start: item.window_start });
  }
  for (const item of access.manual_overrides_by_type || []) {
    add('access', 'access.manual_overrides_by_type', item.total, 'count', { override_type: item.override_type });
  }
  for (const item of access.offline_replay_by_status || []) {
    add('access', 'access.offline_replay_by_status', item.total, 'count', { replay_status: item.replay_status });
  }

  const incidents = snapshot.incidents || {};
  add('incidents', 'incidents.open', incidents.open);
  add('incidents', 'incidents.investigating', incidents.investigating);
  add('incidents', 'incidents.closed', incidents.closed);
  add('incidents', 'incidents.high_priority_open', incidents.high_priority_open);
  add('incidents', 'incidents.blacklist_hits', incidents.blacklist_hits);
  add('incidents', 'incidents.suspicious_attempts', incidents.suspicious_attempts);
  add('incidents', 'incidents.resolution_median_minutes', incidents.resolution_median_minutes, 'minutes');
  for (const item of incidents.by_type || []) {
    add('incidents', 'incidents.by_type', item.total, 'count', { incident_type: item.incident_type });
  }

  const notifications = snapshot.notifications || {};
  add('notifications', 'notifications.sent', notifications.sent);
  add('notifications', 'notifications.failed', notifications.failed);
  add('notifications', 'notifications.success_rate', notifications.success_rate, 'ratio');
  add('notifications', 'notifications.oldest_pending_age_seconds', notifications.oldest_pending_age_seconds, 'seconds');
  for (const [status, total] of Object.entries(notifications.queue || {})) {
    add('notifications', 'notifications.queue', total, 'count', { status });
  }
  for (const item of notifications.per_channel || []) {
    add('notifications', 'notifications.per_channel.sent', item.sent, 'count', { channel: item.channel });
    add('notifications', 'notifications.per_channel.failed', item.failed, 'count', { channel: item.channel });
    add('notifications', 'notifications.per_channel.success_rate', item.success_rate, 'ratio', { channel: item.channel });
  }

  return rows;
}

function renderMetricsCsv(rows) {
  const headers = [
    'property_id',
    'period',
    'generated_at',
    'metric_group',
    'metric_key',
    'value',
    'unit',
    'dimensions',
  ];
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((key) => escapeCsvValue(row[key])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function snapshotWindow(period, generatedAt = new Date()) {
  const end = generatedAt instanceof Date ? generatedAt : new Date(generatedAt);
  if (Number.isNaN(end.getTime())) throw new Error('snapshotWindow: generatedAt must be valid date');
  const start = new Date(end.getTime() - period.hours * 60 * 60 * 1000);
  return {
    window_started_at: start.toISOString(),
    window_ended_at: end.toISOString(),
  };
}

async function materializePropertyAnalyticsSnapshot(db, {
  propertyId,
  period = '7d',
  generatedBy = 'job',
  generatedAt = null,
  fetchDashboard = getOperationsDashboard,
} = {}) {
  if (!db || typeof db.query !== 'function') {
    throw new Error('materializePropertyAnalyticsSnapshot: db with query() required');
  }
  if (!propertyId) {
    throw new Error('materializePropertyAnalyticsSnapshot: propertyId required');
  }
  const parsedPeriod = parsePeriod(period);
  const dashboard = await fetchDashboard(db, {
    propertyId,
    period: parsedPeriod.key,
  });
  const snapshotGeneratedAt = generatedAt || dashboard.generated_at || new Date().toISOString();
  const normalizedSnapshot = {
    ...dashboard,
    generated_at: snapshotGeneratedAt,
    property_id: propertyId,
    period: {
      key: parsedPeriod.key,
      hours: parsedPeriod.hours,
    },
  };
  const rows = flattenOperationsDashboard(normalizedSnapshot);
  const window = snapshotWindow(parsedPeriod, snapshotGeneratedAt);

  const result = await db.query(
    `INSERT INTO analytics_kpi_snapshots
       (property_id, metric_group, period, window_started_at, window_ended_at,
        generated_at, generated_by, source_version, payload, flat_rows, row_count)
     VALUES ($1,$2,$3,$4::timestamptz,$5::timestamptz,$6::timestamptz,$7,$8,$9::jsonb,$10::jsonb,$11)
     RETURNING ${SNAPSHOT_COLS}`,
    [
      propertyId,
      METRIC_GROUP,
      parsedPeriod.key,
      window.window_started_at,
      window.window_ended_at,
      snapshotGeneratedAt,
      generatedBy,
      SOURCE_VERSION,
      JSON.stringify(normalizedSnapshot),
      JSON.stringify(rows),
      rows.length,
    ],
  );

  return {
    snapshot: normalizeSnapshotRow(result.rows[0]),
    metrics: rows,
  };
}

function normalizeSnapshotRow(row) {
  if (!row) return null;
  return {
    ...row,
    payload: normalizeJson(row.payload, {}),
    flat_rows: normalizeJson(row.flat_rows, []),
    row_count: Number(row.row_count || 0),
  };
}

async function listPropertyAnalyticsSnapshots(db, {
  propertyId,
  period = null,
  limit = 20,
} = {}) {
  if (!db || typeof db.query !== 'function') {
    throw new Error('listPropertyAnalyticsSnapshots: db with query() required');
  }
  if (!propertyId) throw new Error('listPropertyAnalyticsSnapshots: propertyId required');
  const safeLimit = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 20));
  const params = [propertyId];
  const filters = ['property_id = $1', 'metric_group = $2'];
  params.push(METRIC_GROUP);
  if (period) {
    const parsedPeriod = parsePeriod(period);
    params.push(parsedPeriod.key);
    filters.push(`period = $${params.length}`);
  }
  params.push(safeLimit);
  const { rows } = await db.query(
    `SELECT ${SNAPSHOT_COLS}
       FROM analytics_kpi_snapshots
      WHERE ${filters.join(' AND ')}
      ORDER BY generated_at DESC
      LIMIT $${params.length}`,
    params,
  );
  return rows.map(normalizeSnapshotRow);
}

async function getLatestPropertyAnalyticsSnapshot(db, {
  propertyId,
  period = '7d',
} = {}) {
  const rows = await listPropertyAnalyticsSnapshots(db, {
    propertyId,
    period,
    limit: 1,
  });
  return rows[0] || null;
}

module.exports = {
  METRIC_GROUP,
  SOURCE_VERSION,
  flattenOperationsDashboard,
  getLatestPropertyAnalyticsSnapshot,
  listPropertyAnalyticsSnapshots,
  materializePropertyAnalyticsSnapshot,
  renderMetricsCsv,
};
