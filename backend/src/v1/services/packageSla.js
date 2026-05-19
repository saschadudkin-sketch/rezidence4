'use strict';

// platform-v1 package-SLA observability service.
// Spec: packages-v2-spec.md §5 (SLA reminders + manual follow-up/alerts).
//
// Read-side gauges over `packages_v2` and `notifications_outbox`. The write
// side is packageSlaRunner.js. The policy intentionally has no auto-return:
// returned/lost are manual terminal transitions only.

const DEFAULT_REMINDER_AFTER_DAYS = 7;
const DEFAULT_FOLLOWUP_AFTER_DAYS = 14;
const DEFAULT_ADMIN_ALERT_AFTER_DAYS = 30;

const PICKUP_REMINDER_EVENT_TYPE = 'package.pickup_reminder';
const FOLLOWUP_EVENT_TYPE = 'package.followup_required';
const ADMIN_ALERT_EVENT_TYPE = 'package.overdue_alert';

// Backward-compatible alias for older callers using returnDays.
const DEFAULT_AUTO_RETURN_AFTER_DAYS = DEFAULT_FOLLOWUP_AFTER_DAYS;

function resolveThresholds(opts = {}) {
  const remindDays = Number.isFinite(opts.remindDays)
    ? opts.remindDays
    : DEFAULT_REMINDER_AFTER_DAYS;
  const followupDays = Number.isFinite(opts.followupDays)
    ? opts.followupDays
    : (Number.isFinite(opts.returnDays) ? opts.returnDays : DEFAULT_FOLLOWUP_AFTER_DAYS);
  const adminAlertDays = Number.isFinite(opts.adminAlertDays)
    ? opts.adminAlertDays
    : DEFAULT_ADMIN_ALERT_AFTER_DAYS;

  if (remindDays <= 0) {
    throw new Error('getPackageSlaSnapshot: remindDays > 0 required');
  }
  if (followupDays <= remindDays) {
    throw new Error('getPackageSlaSnapshot: followupDays > remindDays required');
  }
  if (adminAlertDays <= followupDays) {
    throw new Error('getPackageSlaSnapshot: adminAlertDays > followupDays required');
  }
  return { remindDays, followupDays, adminAlertDays };
}

async function getPackageSlaSnapshot(db, opts = {}) {
  if (!db || typeof db.query !== 'function') {
    throw new Error('getPackageSlaSnapshot: db with .query required');
  }
  const { remindDays, followupDays, adminAlertDays } = resolveThresholds(opts);
  const generatedAt = new Date().toISOString();
  const packageArgs = [String(remindDays), String(followupDays), String(adminAlertDays)];
  const packageWhere = opts.propertyId ? `WHERE property_id = $${packageArgs.length + 1}` : '';
  if (opts.propertyId) packageArgs.push(opts.propertyId);

  const { rows: aggRows } = await db.query(
    `
    SELECT
      COUNT(*) FILTER (WHERE status = 'awaiting_pickup')
        AS awaiting_pickup_total,
      COUNT(*) FILTER (WHERE status = 'awaiting_pickup'
                         AND received_at < NOW() - ($1 || ' days')::INTERVAL
                         AND received_at >= NOW() - ($2 || ' days')::INTERVAL)
        AS awaiting_pickup_over_remind,
      COUNT(*) FILTER (WHERE status = 'awaiting_pickup'
                         AND received_at < NOW() - ($2 || ' days')::INTERVAL
                         AND received_at >= NOW() - ($3 || ' days')::INTERVAL)
        AS awaiting_pickup_over_followup,
      COUNT(*) FILTER (WHERE status = 'awaiting_pickup'
                         AND received_at < NOW() - ($3 || ' days')::INTERVAL)
        AS awaiting_pickup_over_admin_alert,
      COUNT(*) FILTER (WHERE received_at >= NOW() - INTERVAL '24 hours')
        AS received_24h
      FROM packages_v2
      ${packageWhere}
    `,
    packageArgs,
  );
  const agg = aggRows[0] || {};

  const eventTypes = [
    PICKUP_REMINDER_EVENT_TYPE,
    FOLLOWUP_EVENT_TYPE,
    ADMIN_ALERT_EVENT_TYPE,
  ];
  const outboxArgs = [
    PICKUP_REMINDER_EVENT_TYPE,
    FOLLOWUP_EVENT_TYPE,
    ADMIN_ALERT_EVENT_TYPE,
    eventTypes,
  ];
  const outboxPropertyPredicate = opts.propertyId ? `AND property_id = $${outboxArgs.length + 1}` : '';
  if (opts.propertyId) outboxArgs.push(opts.propertyId);
  const { rows: outboxRows } = await db.query(
    `
    SELECT
      COUNT(*) FILTER (WHERE event_type = $1) AS reminders_sent_24h,
      COUNT(*) FILTER (WHERE event_type = $2) AS followups_sent_24h,
      COUNT(*) FILTER (WHERE event_type = $3) AS admin_alerts_sent_24h
      FROM notifications_outbox
     WHERE event_type = ANY($4::text[])
       AND created_at >= NOW() - INTERVAL '24 hours'
       ${outboxPropertyPredicate}
    `,
    outboxArgs,
  );
  const outboxAgg = outboxRows[0] || {};

  return {
    awaiting_pickup_total: toInt(agg.awaiting_pickup_total),
    awaiting_pickup_over_7d: toInt(agg.awaiting_pickup_over_remind),
    awaiting_pickup_over_14d: toInt(agg.awaiting_pickup_over_followup),
    awaiting_pickup_over_30d: toInt(agg.awaiting_pickup_over_admin_alert),
    reminders_sent_24h: toInt(outboxAgg.reminders_sent_24h),
    followups_sent_24h: toInt(outboxAgg.followups_sent_24h),
    admin_alerts_sent_24h: toInt(outboxAgg.admin_alerts_sent_24h),
    received_24h: toInt(agg.received_24h),
    thresholds: {
      remind_days: remindDays,
      followup_days: followupDays,
      admin_alert_days: adminAlertDays,
    },
    generated_at: generatedAt,
  };
}

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function renderSlaAsPrometheus(snapshot, opts = {}) {
  const propertyLabel = typeof opts.propertySlug === 'string' && opts.propertySlug
    ? `{property="${escapeLabel(opts.propertySlug)}"}`
    : '';

  const lines = [];

  function emit(name, help, value) {
    lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} gauge`);
    lines.push(`${name}${propertyLabel} ${Number(value) || 0}`);
  }

  emit(
    'package_sla_awaiting_pickup',
    'Packages currently in awaiting_pickup state',
    snapshot.awaiting_pickup_total,
  );
  emit(
    'package_sla_awaiting_pickup_over_7d',
    'Packages due for resident pickup reminder',
    snapshot.awaiting_pickup_over_7d,
  );
  emit(
    'package_sla_awaiting_pickup_over_14d',
    'Packages due for concierge follow-up',
    snapshot.awaiting_pickup_over_14d,
  );
  emit(
    'package_sla_awaiting_pickup_over_30d',
    'Packages due for property-admin alert',
    snapshot.awaiting_pickup_over_30d,
  );
  emit(
    'package_sla_reminders_sent_24h',
    'package.pickup_reminder outbox rows created in the last 24 hours',
    snapshot.reminders_sent_24h,
  );
  emit(
    'package_sla_followups_sent_24h',
    'package.followup_required outbox rows created in the last 24 hours',
    snapshot.followups_sent_24h,
  );
  emit(
    'package_sla_admin_alerts_sent_24h',
    'package.overdue_alert outbox rows created in the last 24 hours',
    snapshot.admin_alerts_sent_24h,
  );
  emit(
    'package_sla_received_24h',
    'Packages received in the last 24 hours',
    snapshot.received_24h,
  );

  return lines.join('\n') + '\n';
}

function escapeLabel(v) {
  return String(v)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
}

module.exports = {
  getPackageSlaSnapshot,
  renderSlaAsPrometheus,
  escapeLabel,
  DEFAULT_REMINDER_AFTER_DAYS,
  DEFAULT_FOLLOWUP_AFTER_DAYS,
  DEFAULT_ADMIN_ALERT_AFTER_DAYS,
  DEFAULT_AUTO_RETURN_AFTER_DAYS,
  PICKUP_REMINDER_EVENT_TYPE,
  FOLLOWUP_EVENT_TYPE,
  ADMIN_ALERT_EVENT_TYPE,
};
