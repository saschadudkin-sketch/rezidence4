'use strict';

// platform-v1 package-SLA observability service.
// Spec: packages-v2-spec.md §5 (SLA reminders + auto-return).
//
// Этот модуль — per-property read-side observability над `packages_v2` +
// `notifications_outbox`.  Пишущая сторона — packageSlaRunner.js.
//
// Что отвечает:
//   • getPackageSlaSnapshot(db)        — JSON snapshot для admin UI
//   • renderSlaAsPrometheus(snap, opt) — text/plain exposition для scraper'а
//
// Это DB-level gauges, не process-level counters.  Пережёвывать
// `package_sla_ticks_total` внутри runner-памяти смысла мало: process
// рестартится, и дашборды кривятся.  Gauge по базе переживает рестарт
// и показывает истинное состояние «здоровья» SLA (overdue посылки, кол-во
// отправленных reminders за 24h и т.д.).
//
// Gauges возвращают:
//   awaiting_pickup_total        — всего status='awaiting_pickup'
//   awaiting_pickup_over_7d      — подпадают под reminder (≥7 и <14 дней)
//   awaiting_pickup_over_14d     — ДОЛЖНЫ быть 0, если runner здоров;
//                                   не-ноль = воркер сломался или env отключил
//   auto_returned_24h            — сработавших автоматом за последние 24h
//   reminders_sent_24h           — package.pickup_reminder rows в outbox за 24h
//   received_24h                 — новые посылки за 24h (базовая активность)
//
// Форма snapshot'а — shape-compatible с renderSlaAsPrometheus, не
// изменяй ключи без синхронной правки Prometheus helper'а.

// ─── Константы ───────────────────────────────────────────────────────────────

const DEFAULT_REMINDER_AFTER_DAYS    = 7;
const DEFAULT_AUTO_RETURN_AFTER_DAYS = 14;

// Совпадает с AUTO_RETURN_REASON в packageSlaRunner.js — мы ищем в
// returned_reason ILIKE 'Автоматически возвращено%'.  Держим свой
// паттерн, чтобы не зависеть от экспорта константы.
const AUTO_RETURN_REASON_PATTERN = 'Автоматически возвращено%';

// ─── getPackageSlaSnapshot ───────────────────────────────────────────────────

/**
 * getPackageSlaSnapshot — одним запросом (многоколоночный COUNT+FILTER)
 * собирает все gauge'и.  Один раунд-трип в БД — дёшево даже при частом
 * scrape.
 *
 * Параметризация дней — через аргументы, чтобы тесты могли варьировать
 * пороги без подмены DEFAULT'ов.
 */
async function getPackageSlaSnapshot(db, opts = {}) {
  if (!db || typeof db.query !== 'function') {
    throw new Error('getPackageSlaSnapshot: db with .query required');
  }
  const remindDays = Number.isFinite(opts.remindDays)
    ? opts.remindDays : DEFAULT_REMINDER_AFTER_DAYS;
  const returnDays = Number.isFinite(opts.returnDays)
    ? opts.returnDays : DEFAULT_AUTO_RETURN_AFTER_DAYS;

  if (remindDays <= 0 || returnDays <= remindDays) {
    throw new Error('getPackageSlaSnapshot: remindDays > 0 && returnDays > remindDays');
  }

  const generatedAt = new Date().toISOString();

  // Один SQL — FILTER aggregate'ы.  Без CTE, чтобы planner был максимально
  // прямолинеен; индексы по status/received_at и status/returned_at
  // существуют (см. миграция packages_v2).
  //
  // NB: COUNT(*) без строк всё равно вернёт одну row (ноль в каждом
  // aggregate).  Но в юнит-тестах мокаем `rows: []`, поэтому защита
  // `|| {}` обязательна — не полагаемся на destructure default.
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
                         AND received_at < NOW() - ($2 || ' days')::INTERVAL)
        AS awaiting_pickup_over_return,
      COUNT(*) FILTER (WHERE status = 'returned'
                         AND returned_reason ILIKE $3
                         AND returned_at >= NOW() - INTERVAL '24 hours')
        AS auto_returned_24h,
      COUNT(*) FILTER (WHERE received_at >= NOW() - INTERVAL '24 hours')
        AS received_24h
      FROM packages_v2
    `,
    [String(remindDays), String(returnDays), AUTO_RETURN_REASON_PATTERN],
  );
  const agg = aggRows[0] || {};

  // Reminders живут в outbox — отдельный запрос, таблица другая.
  const { rows: remindRows } = await db.query(
    `
    SELECT COUNT(*)::bigint AS reminders_sent_24h
      FROM notifications_outbox
     WHERE event_type = 'package.pickup_reminder'
       AND created_at >= NOW() - INTERVAL '24 hours'
    `,
  );
  const remindAgg = remindRows[0] || {};

  return {
    awaiting_pickup_total:        toInt(agg.awaiting_pickup_total),
    awaiting_pickup_over_7d:      toInt(agg.awaiting_pickup_over_remind),
    awaiting_pickup_over_14d:     toInt(agg.awaiting_pickup_over_return),
    auto_returned_24h:            toInt(agg.auto_returned_24h),
    reminders_sent_24h:           toInt(remindAgg.reminders_sent_24h),
    received_24h:                 toInt(agg.received_24h),
    thresholds: {
      remind_days: remindDays,
      return_days: returnDays,
    },
    generated_at: generatedAt,
  };
}

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ─── renderSlaAsPrometheus ───────────────────────────────────────────────────

/**
 * renderSlaAsPrometheus — snapshot → Prometheus text-exposition.
 *
 * Генерирует 6 gauge'ей:
 *
 *   package_sla_awaiting_pickup{property="..."}          — current queue size
 *   package_sla_awaiting_pickup_over_7d{property="..."}  — due for reminder
 *   package_sla_awaiting_pickup_over_14d{property="..."} — overdue for return
 *   package_sla_auto_returned_24h{property="..."}
 *   package_sla_reminders_sent_24h{property="..."}
 *   package_sla_received_24h{property="..."}
 *
 * ALERT rules (suggested):
 *   - package_sla_awaiting_pickup_over_14d > 0 for 30m → paging
 *     («SLA runner stuck» — 14-дневные посылки не авто-возвращаются)
 *   - package_sla_reminders_sent_24h == 0 AND package_sla_awaiting_pickup_over_7d > 0
 *     → warning («reminders не уходят»)
 */
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
    'Packages due for reminder (>=7 and <14 days since received_at)',
    snapshot.awaiting_pickup_over_7d,
  );
  emit(
    'package_sla_awaiting_pickup_over_14d',
    'Packages overdue for auto-return (>=14 days); should be 0 if runner is healthy',
    snapshot.awaiting_pickup_over_14d,
  );
  emit(
    'package_sla_auto_returned_24h',
    'Packages auto-returned in the last 24 hours',
    snapshot.auto_returned_24h,
  );
  emit(
    'package_sla_reminders_sent_24h',
    'package.pickup_reminder outbox rows created in the last 24 hours',
    snapshot.reminders_sent_24h,
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
  DEFAULT_AUTO_RETURN_AFTER_DAYS,
  AUTO_RETURN_REASON_PATTERN,
};
