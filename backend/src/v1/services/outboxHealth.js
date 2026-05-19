'use strict';

// platform-v1 notifications-outbox health helper — Spec: notifications-outbox-spec.md §4.5.
//
// Единственный SQL-шот, собирающий снимок состояния `notifications_outbox`
// одного tenant'а:
//   • per-status counts (pending / in_flight / failed / dead)
//   • sent за последние 24h — чтобы не тащить всю историю
//   • stuck_in_flight — строки, застрявшие > 30 минут (цель reaper'а)
//   • oldest_pending_age_seconds — возраст самой старой pending/failed
//
// Зачем вынесено:
//   - /api/v1/notifications/outbox/health           (per-tenant admin)
//   - /platform/api/v1/notifications/outbox/health  (superadmin dashboard)
//   обе ручки выполняют ровно этот SELECT + нормализацию.  Единое место —
//   единое место правки SQL (например, когда добавим retry-queue-depth или
//   per-channel разбивку).
//
// Принципиальные решения:
//   1. pg `COUNT(*)` возвращает строки (bigint-safe).  Любое значение,
//      попадающее в ответ HTTP API, прогоняем через `Number(...) || 0`.
//   2. oldest_pending_age_seconds оставляем `null`, если очередь пустая —
//      это информативнее, чем «0 секунд».  Клиент Grafana строит панель
//      «самое старое» и null у него = «нет данных», что корректно.
//   3. Округляем возраст до ближайшей секунды: миллисекунды в мониторинге
//      шумят.  Math.round, не floor — «123.8s» → «124s» лучше, чем «123s».
//   4. По умолчанию SQL без WHERE: multi-tenant изоляция обеспечивается
//      per-property pool'ом.  Но helper также принимает propertyId для
//      shared-DB/legacy fallback'ов и тестовых mounts, где pool может быть
//      общим, а row-level guard всё равно нужен.

'use strict';

/**
 * QUERY_SQL — единственный aggregate SELECT.  Экспортирую отдельно, чтобы
 * тесты могли делать exact-match (см. v1OutboxHealth.test.js).
 *
 * Важно: окна 24h и 30 minutes ДОЛЖНЫ совпадать с worker/reaper'ом:
 *   - 24h  — sent_last_24h (info-поле, не контроль).
 *   - 30m  — STUCK_TTL_MINUTES в outboxRunner (см. DEFAULT_STUCK_TTL_MINUTES).
 *            Меняешь одно — меняй оба.
 */
const QUERY_SQL = `
  SELECT
    COUNT(*) FILTER (WHERE status = 'pending')                         AS pending,
    COUNT(*) FILTER (WHERE status = 'in_flight')                       AS in_flight,
    COUNT(*) FILTER (WHERE status = 'failed')                          AS failed,
    COUNT(*) FILTER (WHERE status = 'dead')                            AS dead,
    COUNT(*) FILTER (
      WHERE status = 'sent'
        AND sent_at > NOW() - INTERVAL '24 hours'
    )                                                                  AS sent_last_24h,
    COUNT(*) FILTER (
      WHERE status = 'in_flight'
        AND last_attempted_at < NOW() - INTERVAL '30 minutes'
    )                                                                  AS stuck_in_flight,
    EXTRACT(EPOCH FROM (NOW() - MIN(next_attempt_at))
      FILTER (WHERE status IN ('pending','failed')))                   AS oldest_pending_age_seconds
  FROM notifications_outbox
`;

function buildQuery(opts = {}) {
  if (!opts.propertyId) return { sql: QUERY_SQL, args: [] };
  return {
    sql: `${QUERY_SQL.trimEnd()}
  WHERE property_id = $1
`,
    args: [opts.propertyId],
  };
}

/**
 * normalizeRow — превращает raw-строку pg (все числа — строки) в чистую
 * JSON-пригодную структуру.  Null-ы сохраняем для oldest_pending_age_seconds.
 */
function normalizeRow(r) {
  const row = r || {};
  return {
    counts: {
      pending:       Number(row.pending)       || 0,
      in_flight:     Number(row.in_flight)     || 0,
      failed:        Number(row.failed)        || 0,
      dead:          Number(row.dead)          || 0,
      sent_last_24h: Number(row.sent_last_24h) || 0,
    },
    stuck_in_flight: Number(row.stuck_in_flight) || 0,
    oldest_pending_age_seconds:
      row.oldest_pending_age_seconds == null
        ? null
        : Math.round(Number(row.oldest_pending_age_seconds)),
  };
}

/**
 * fetchTenantOutboxHealth — один query против указанного пула.
 *
 * @param {{query: Function}} pool — pg-подобный объект (Pool | Client).
 * @returns {Promise<{counts, stuck_in_flight, oldest_pending_age_seconds}>}
 *
 * Throws — только если `pool.query` падает (relation missing / connection
 * refused и т.п.).  Вызывающий код (HTTP-хендлер) решает, превращать
 * это в 503 (per-tenant ручка) или в item.error (superadmin dashboard).
 */
async function fetchTenantOutboxHealth(pool, opts = {}) {
  if (!pool || typeof pool.query !== 'function') {
    throw new Error('fetchTenantOutboxHealth: pool with .query required');
  }
  const { sql, args } = buildQuery(opts);
  const { rows } = await pool.query(sql, args);
  return normalizeRow(rows[0]);
}

/**
 * aggregateSnapshots — summation helper для superadmin rollup.
 *
 * Важно:
 *   • counts.* суммируются (физический смысл сохраняется).
 *   • stuck_in_flight суммируется (общее количество «потерянных» строк
 *     по всей платформе — критичная метрика для on-call).
 *   • oldest_pending_age_seconds = MAX, НЕ SUM.  «Самая старая pending
 *     во всей платформе» — max по tenants; null'ы отфильтровываются.
 *     Если все null (все очереди пустые) — возвращаем null.
 *
 * Ошибочные tenants (с `error: ...`) в rollup не попадают, но их счётчик
 * видно в верхнем уровне `errors_count`.
 */
function aggregateSnapshots(tenantSnapshots) {
  const rollup = {
    counts: { pending: 0, in_flight: 0, failed: 0, dead: 0, sent_last_24h: 0 },
    stuck_in_flight: 0,
    oldest_pending_age_seconds: null,
  };
  for (const t of tenantSnapshots) {
    if (!t || t.error) continue;
    const c = t.counts || {};
    rollup.counts.pending       += Number(c.pending)       || 0;
    rollup.counts.in_flight     += Number(c.in_flight)     || 0;
    rollup.counts.failed        += Number(c.failed)        || 0;
    rollup.counts.dead          += Number(c.dead)          || 0;
    rollup.counts.sent_last_24h += Number(c.sent_last_24h) || 0;
    rollup.stuck_in_flight      += Number(t.stuck_in_flight) || 0;
    if (t.oldest_pending_age_seconds != null) {
      const age = Number(t.oldest_pending_age_seconds);
      if (!Number.isFinite(age)) continue;
      if (rollup.oldest_pending_age_seconds == null || age > rollup.oldest_pending_age_seconds) {
        rollup.oldest_pending_age_seconds = age;
      }
    }
  }
  return rollup;
}

module.exports = {
  QUERY_SQL,
  buildQuery,
  normalizeRow,
  fetchTenantOutboxHealth,
  aggregateSnapshots,
};
