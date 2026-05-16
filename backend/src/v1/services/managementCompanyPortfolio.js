'use strict';

// DH-36 management company portfolio aggregation.
// Uses DH-35 object-level formulas as the per-property source and only
// combines non-PII operational counts across properties in the same company.

const defaultLogger = require('../../logger');
const { getPropertyPool: defaultGetPropertyPool } = require('../../middleware/propertyDb');
const { getOperationsDashboard } = require('./operationsDashboard');

const DEFAULT_CONCURRENCY = 6;

function serviceError(statusCode, code, message, details = null) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  err.details = details;
  return err;
}

function toInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function maxNullable(a, b) {
  const left = Number.isFinite(Number(a)) ? Number(a) : null;
  const right = Number.isFinite(Number(b)) ? Number(b) : null;
  if (left === null) return right;
  if (right === null) return left;
  return Math.max(left, right);
}

function rate(numerator, denominator) {
  const den = toInt(denominator);
  if (den <= 0) return null;
  return toInt(numerator) / den;
}

function addToMap(map, key, value) {
  const normalizedKey = key || 'unknown';
  map.set(normalizedKey, toInt(map.get(normalizedKey)) + toInt(value));
}

function addAccessPointToMap(map, item) {
  const key = item.access_point_id || item.name || 'unknown';
  const current = map.get(key) || {
    access_point_id: item.access_point_id || null,
    name: item.name || 'Без КПП',
    allow_count: 0,
    denial_count: 0,
    total: 0,
  };
  current.allow_count += toInt(item.allow_count);
  current.denial_count += toInt(item.denial_count);
  current.total += toInt(item.total);
  map.set(key, current);
}

function breakdownFromMap(map, keyName) {
  return [...map.entries()]
    .map(([key, total]) => ({ [keyName]: key, total }))
    .sort((a, b) => b.total - a.total || String(a[keyName]).localeCompare(String(b[keyName])));
}

function accessPointBreakdownFromMap(map) {
  return [...map.values()]
    .sort((a, b) => b.total - a.total || String(a.name).localeCompare(String(b.name)));
}

function normalizePropertySlugs(propertySlugs = []) {
  return [...new Set(
    propertySlugs
      .map((slug) => String(slug || '').trim().toLowerCase())
      .filter(Boolean),
  )];
}

async function mapLimit(items, limit, iterator) {
  if (!items.length) return [];
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await iterator(items[index], index);
    }
  }));

  return results;
}

async function listPortfolioProperties(platformDb, {
  managementCompanyId,
  propertySlugs = [],
  includeInactive = false,
} = {}) {
  if (!platformDb || typeof platformDb.query !== 'function') {
    throw new Error('listPortfolioProperties: platformDb with query() required');
  }
  if (!managementCompanyId) {
    throw serviceError(
      400,
      'MANAGEMENT_COMPANY_REQUIRED',
      'management_company_id required',
    );
  }

  const requestedSlugs = normalizePropertySlugs(propertySlugs);
  const { rows } = await platformDb.query(
    `
      SELECT id, slug, name, status, is_active, db_connection_url, management_company_id
        FROM properties
       WHERE management_company_id = $1
         AND ($2::boolean = true OR is_active = true)
       ORDER BY name ASC, slug ASC
    `,
    [managementCompanyId, includeInactive === true],
  );

  if (!requestedSlugs.length) return rows;

  const bySlug = new Map(rows.map((property) => [property.slug, property]));
  const missing = requestedSlugs.filter((slug) => !bySlug.has(slug));
  if (missing.length) {
    throw serviceError(
      403,
      'PROPERTY_FILTER_OUTSIDE_PORTFOLIO',
      'property_slug filter contains a property outside this portfolio or inactive',
      { property_slugs: missing },
    );
  }

  return requestedSlugs.map((slug) => bySlug.get(slug));
}

function propertyHotspots(snapshot) {
  const hotspots = [];
  if (toInt(snapshot.requests?.overdue_backlog) > 0) hotspots.push('overdue_backlog');
  if (toInt(snapshot.incidents?.high_priority_open) > 0) hotspots.push('high_priority_incidents');
  if (toInt(snapshot.incidents?.open) + toInt(snapshot.incidents?.investigating) >= 5) {
    hotspots.push('incident_load');
  }
  if (snapshot.notifications?.success_rate !== null
    && snapshot.notifications?.success_rate !== undefined
    && Number(snapshot.notifications.success_rate) < 0.95) {
    hotspots.push('notification_delivery');
  }
  if (toInt(snapshot.notifications?.queue?.failed) + toInt(snapshot.notifications?.queue?.dead) > 0) {
    hotspots.push('notification_queue');
  }
  return hotspots;
}

function summarizeProperty(property, dashboard) {
  const snapshot = {
    requests: dashboard.requests || {},
    access: dashboard.access || {},
    incidents: dashboard.incidents || {},
    notifications: dashboard.notifications || {},
  };

  return {
    id: property.id,
    slug: property.slug,
    name: property.name,
    status: property.status || null,
    is_active: property.is_active !== false,
    health: 'ok',
    generated_at: dashboard.generated_at,
    ...snapshot,
    hotspots: propertyHotspots(snapshot),
  };
}

function errorProperty(property, err) {
  return {
    id: property.id,
    slug: property.slug,
    name: property.name,
    status: property.status || null,
    is_active: property.is_active !== false,
    health: 'error',
    error: err && err.message ? err.message : String(err),
    hotspots: ['tenant_unavailable'],
  };
}

async function fetchPortfolioProperty(property, {
  periodKey,
  getPropertyPool,
  fetchPropertyDashboard,
  logger,
} = {}) {
  try {
    if (!property.db_connection_url) {
      throw new Error('property has no db_connection_url');
    }
    const pool = getPropertyPool(property);
    const dashboard = await fetchPropertyDashboard(pool, {
      propertyId: property.id,
      period: periodKey,
    });
    return summarizeProperty(property, dashboard);
  } catch (err) {
    logger.warn(
      { err, property_slug: property.slug },
      '[management-company-portfolio] property aggregation failed',
    );
    return errorProperty(property, err);
  }
}

function aggregateProperties(properties) {
  const okProperties = properties.filter((property) => property.health === 'ok');
  const statusMap = new Map();
  const priorityMap = new Map();
  const incidentTypeMap = new Map();
  const accessPointMap = new Map();
  const denyReasonMap = new Map();
  const peakWindowMap = new Map();
  const overrideTypeMap = new Map();
  const offlineStatusMap = new Map();
  const channelMap = new Map();
  const queue = {};
  let decisionSecondsWeightedSum = 0;
  let decisionSecondsWeight = 0;

  const rollup = {
    properties_total: properties.length,
    properties_healthy: okProperties.length,
    properties_error: properties.length - okProperties.length,
    hotspot_property_count: okProperties.filter((property) => property.hotspots.length > 0).length,
    requests: {
      created: 0,
      completed: 0,
      open: 0,
      overdue_backlog: 0,
      resolved_within_sla: 0,
      resolved_with_sla: 0,
      sla_compliance_rate: null,
      by_status: [],
      by_priority: [],
    },
    access: {
      requests_created: 0,
      requests_approved: 0,
      requests_rejected: 0,
      approval_rate: null,
      pending: 0,
      expired: 0,
      allow_count: 0,
      denial_count: 0,
      vehicle_traffic_count: 0,
      avg_decision_seconds: null,
      active_passes: 0,
      used_passes: 0,
      manual_override_count: 0,
      offline_replay_count: 0,
      trusted_visitors_active: 0,
      trusted_visitor_passes_created: 0,
      skud_failed_events: 0,
      skud_manual_control_count: 0,
      by_access_point: [],
      deny_reasons: [],
      peak_traffic_windows: [],
      manual_overrides_by_type: [],
      offline_replay_by_status: [],
    },
    incidents: {
      open: 0,
      investigating: 0,
      closed: 0,
      high_priority_open: 0,
      blacklist_hits: 0,
      suspicious_attempts: 0,
      by_type: [],
    },
    notifications: {
      sent: 0,
      failed: 0,
      success_rate: null,
      queue,
      oldest_pending_age_seconds: null,
      per_channel: [],
    },
  };

  for (const property of okProperties) {
    const requests = property.requests || {};
    rollup.requests.created += toInt(requests.created);
    rollup.requests.completed += toInt(requests.completed);
    rollup.requests.open += toInt(requests.open);
    rollup.requests.overdue_backlog += toInt(requests.overdue_backlog);
    rollup.requests.resolved_within_sla += toInt(requests.resolved_within_sla);
    rollup.requests.resolved_with_sla += toInt(requests.resolved_with_sla);
    for (const item of requests.by_status || []) addToMap(statusMap, item.status, item.total);
    for (const item of requests.by_priority || []) addToMap(priorityMap, item.priority, item.total);

    const access = property.access || {};
    rollup.access.requests_created += toInt(access.requests_created);
    rollup.access.requests_approved += toInt(access.requests_approved);
    rollup.access.requests_rejected += toInt(access.requests_rejected);
    rollup.access.pending += toInt(access.pending);
    rollup.access.expired += toInt(access.expired);
    rollup.access.allow_count += toInt(access.allow_count);
    rollup.access.denial_count += toInt(access.denial_count);
    rollup.access.vehicle_traffic_count += toInt(access.vehicle_traffic_count);
    rollup.access.active_passes += toInt(access.active_passes);
    rollup.access.used_passes += toInt(access.used_passes);
    rollup.access.manual_override_count += toInt(access.manual_override_count);
    rollup.access.offline_replay_count += toInt(access.offline_replay_count);
    rollup.access.trusted_visitors_active += toInt(access.trusted_visitors_active);
    rollup.access.trusted_visitor_passes_created += toInt(access.trusted_visitor_passes_created);
    rollup.access.skud_failed_events += toInt(access.skud_failed_events);
    rollup.access.skud_manual_control_count += toInt(access.skud_manual_control_count);
    if (access.avg_decision_seconds !== null && access.avg_decision_seconds !== undefined) {
      const weight = Math.max(1, toInt(access.manual_override_count));
      decisionSecondsWeightedSum += Number(access.avg_decision_seconds) * weight;
      decisionSecondsWeight += weight;
    }
    for (const item of access.by_access_point || []) addAccessPointToMap(accessPointMap, item);
    for (const item of access.deny_reasons || []) addToMap(denyReasonMap, item.reason, item.total);
    for (const item of access.peak_traffic_windows || []) addToMap(peakWindowMap, item.window_start, item.total);
    for (const item of access.manual_overrides_by_type || []) addToMap(overrideTypeMap, item.override_type, item.total);
    for (const item of access.offline_replay_by_status || []) addToMap(offlineStatusMap, item.replay_status, item.total);

    const incidents = property.incidents || {};
    rollup.incidents.open += toInt(incidents.open);
    rollup.incidents.investigating += toInt(incidents.investigating);
    rollup.incidents.closed += toInt(incidents.closed);
    rollup.incidents.high_priority_open += toInt(incidents.high_priority_open);
    rollup.incidents.blacklist_hits += toInt(incidents.blacklist_hits);
    rollup.incidents.suspicious_attempts += toInt(incidents.suspicious_attempts);
    for (const item of incidents.by_type || []) addToMap(incidentTypeMap, item.incident_type, item.total);

    const notifications = property.notifications || {};
    rollup.notifications.sent += toInt(notifications.sent);
    rollup.notifications.failed += toInt(notifications.failed);
    rollup.notifications.oldest_pending_age_seconds = maxNullable(
      rollup.notifications.oldest_pending_age_seconds,
      notifications.oldest_pending_age_seconds,
    );
    for (const [key, value] of Object.entries(notifications.queue || {})) {
      queue[key] = toInt(queue[key]) + toInt(value);
    }
    for (const item of notifications.per_channel || []) {
      const current = channelMap.get(item.channel) || { channel: item.channel, sent: 0, failed: 0 };
      current.sent += toInt(item.sent);
      current.failed += toInt(item.failed);
      channelMap.set(item.channel, current);
    }
  }

  rollup.requests.sla_compliance_rate = rate(
    rollup.requests.resolved_within_sla,
    rollup.requests.resolved_with_sla,
  );
  rollup.requests.by_status = breakdownFromMap(statusMap, 'status');
  rollup.requests.by_priority = breakdownFromMap(priorityMap, 'priority');

  const accessDecisions = rollup.access.requests_approved + rollup.access.requests_rejected;
  rollup.access.approval_rate = rate(rollup.access.requests_approved, accessDecisions);
  rollup.access.avg_decision_seconds = decisionSecondsWeight > 0
    ? decisionSecondsWeightedSum / decisionSecondsWeight
    : null;
  rollup.access.by_access_point = accessPointBreakdownFromMap(accessPointMap);
  rollup.access.deny_reasons = breakdownFromMap(denyReasonMap, 'reason');
  rollup.access.peak_traffic_windows = breakdownFromMap(peakWindowMap, 'window_start');
  rollup.access.manual_overrides_by_type = breakdownFromMap(overrideTypeMap, 'override_type');
  rollup.access.offline_replay_by_status = breakdownFromMap(offlineStatusMap, 'replay_status');

  rollup.incidents.by_type = breakdownFromMap(incidentTypeMap, 'incident_type');

  const notificationDecisions = rollup.notifications.sent + rollup.notifications.failed;
  rollup.notifications.success_rate = rate(rollup.notifications.sent, notificationDecisions);
  rollup.notifications.per_channel = [...channelMap.values()]
    .map((item) => ({
      ...item,
      success_rate: rate(item.sent, item.sent + item.failed),
    }))
    .sort((a, b) => String(a.channel).localeCompare(String(b.channel)));

  return rollup;
}

function topProperties(properties, getter) {
  return properties
    .filter((property) => property.health === 'ok')
    .map((property) => ({
      property_id: property.id,
      property_slug: property.slug,
      property_name: property.name,
      value: toInt(getter(property)),
    }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value || a.property_slug.localeCompare(b.property_slug))
    .slice(0, 5);
}

function buildRankings(properties) {
  return {
    overdue_backlog: topProperties(properties, (property) => property.requests?.overdue_backlog),
    incident_load: topProperties(
      properties,
      (property) => toInt(property.incidents?.open) + toInt(property.incidents?.investigating),
    ),
    notification_failures: topProperties(
      properties,
      (property) => toInt(property.notifications?.failed)
        + toInt(property.notifications?.queue?.failed)
        + toInt(property.notifications?.queue?.dead),
    ),
  };
}

async function getManagementCompanyPortfolio({
  platformDb,
  managementCompanyId,
  period,
  propertySlugs = [],
  includeInactive = false,
  concurrency = DEFAULT_CONCURRENCY,
  getPropertyPool = defaultGetPropertyPool,
  fetchPropertyDashboard = getOperationsDashboard,
  logger = defaultLogger,
} = {}) {
  const normalizedSlugs = normalizePropertySlugs(propertySlugs);
  const properties = await listPortfolioProperties(platformDb, {
    managementCompanyId,
    propertySlugs: normalizedSlugs,
    includeInactive,
  });

  const propertySnapshots = await mapLimit(
    properties,
    concurrency,
    (property) => fetchPortfolioProperty(property, {
      periodKey: period.key || period,
      getPropertyPool,
      fetchPropertyDashboard,
      logger,
    }),
  );

  const errors = propertySnapshots
    .filter((property) => property.health === 'error')
    .map((property) => ({
      property_id: property.id,
      property_slug: property.slug,
      error: property.error,
    }));

  return {
    generated_at: new Date().toISOString(),
    management_company_id: managementCompanyId,
    period: {
      key: period.key || period,
      hours: period.hours || null,
    },
    filters: {
      property_slugs: normalizedSlugs,
      include_inactive: includeInactive === true,
    },
    rollup: aggregateProperties(propertySnapshots),
    rankings: buildRankings(propertySnapshots),
    properties: propertySnapshots,
    errors,
    formula_notes: {
      request_sla_compliance_rate:
        'Weighted by resolved_with_sla counts from DH-35 property snapshots.',
      notification_success_rate:
        'Weighted by sent and failed notification log counts across included properties.',
      hotspot_property_count:
        'Counts properties with overdue backlog, high incident load, or notification delivery/queue risk.',
    },
  };
}

module.exports = {
  aggregateProperties,
  getManagementCompanyPortfolio,
  listPortfolioProperties,
  normalizePropertySlugs,
};
