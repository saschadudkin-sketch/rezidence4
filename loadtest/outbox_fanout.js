/**
 * loadtest/outbox_fanout.js — LOAD-1: notifications-outbox fan-out throughput.
 *
 * Spec: docs/product/specs/platform-v1/notifications-outbox-spec.md §6
 *   «Load-test (LOAD-1): при rate 100 req/s с announcement.published на 500
 *    резидентов outbox заполняется за < 30 секунд, worker успевает обрабатывать
 *    fanout без back-pressure collapse.»
 *
 * Что меряем:
 *   1. Sync publish HTTP latency — p95 должен быть <2s при TARGET_RPS.
 *    (`announcement_publish_latency_ms`).
 *   2. Fan-out count per publish — backend возвращает `outbox_fanout: N`.
 *      Ожидаемое N = EXPECTED_FANOUT (500 для zamoskvorechye seed).
 *    Shortfall — counter `announcement_fanout_shortfall`.
 *   3. Ошибки (HTTP != 2xx) — Rate metric `errors`.
 *   4. Teardown: snapshot outbox metrics из admin-endpoint для offline-анализа
 *      (сколько в status=sent/failed/dead после прогона).
 *
 * Чего НЕ меряем (out of scope этого скрипта):
 *   - Channel-level doставляемость (это делает worker; проверяется отдельным
 *     post-run SQL-анализом или долго-pollом /admin/outbox/metrics).
 *   - Lag worker'а (enqueue → send).  Проверяется glance'ом на `oldest_pending_age_s`
 *     в metrics snapshot.
 *
 * Prerequisites (см. loadtest/README.md §Setup):
 *   1. Backend запущен с `NOTIFICATIONS_OUTBOX_ENABLED=true`, worker активен.
 *   2. В property БД (PROPERTY_SLUG) ≥ EXPECTED_FANOUT active residents,
 *      с подпиской хотя бы на один канал (web_push / email / …).
 *   3. Rate-limiters announcement'ов на load-test инстансе обойдены — либо
 *      env flag (см. README), либо временный patch routes/announcements.js.
 *      Без этого createLimiter=10/hour упрётся на первых ~10 итерациях.
 *   4. TEST_TOKEN — JWT staff/admin scope для PROPERTY_SLUG.
 *
 * Запуск:
 *   k6 run loadtest/outbox_fanout.js \
 *     -e BASE_URL=http://staging.example.com:3001 \
 *     -e TEST_TOKEN=<admin-jwt> \
 *     -e PROPERTY_SLUG=zamoskvorechye \
 *     -e PROPERTY_ID=<uuid> \
 *     -e TARGET_RPS=100 \
 *     -e DURATION=60s \
 *     -e EXPECTED_FANOUT=500
 *
 * Local smoke (быстрая проверка, не LOAD-1 AC):
 *   k6 run loadtest/outbox_fanout.js \
 *     -e BASE_URL=http://localhost:3001 \
 *     -e TEST_TOKEN=<dev-jwt> \
 *     -e PROPERTY_SLUG=dev \
 *     -e PROPERTY_ID=<dev-property-uuid> \
 *     -e TARGET_RPS=5 -e DURATION=10s -e EXPECTED_FANOUT=3
 */

import http from 'k6/http';
import { check } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// ─── Env parsing ──────────────────────────────────────────────────────────────
const BASE = __ENV.BASE_URL || 'http://localhost:3001';
const TOKEN = __ENV.TEST_TOKEN || '';
const PROPERTY_SLUG = __ENV.PROPERTY_SLUG || '';
const PROPERTY_ID = __ENV.PROPERTY_ID || '';
const TARGET_RPS = Number(__ENV.TARGET_RPS || 10);
const DURATION = __ENV.DURATION || '30s';
const EXPECTED_FANOUT = Number(__ENV.EXPECTED_FANOUT || 500);

// k6 runs `init` context once per VU; fail-fast на неполном env.
if (!TOKEN) throw new Error('env TEST_TOKEN required');
if (!PROPERTY_SLUG) throw new Error('env PROPERTY_SLUG required');
if (!PROPERTY_ID) throw new Error('env PROPERTY_ID required (UUID)');
if (!Number.isFinite(TARGET_RPS) || TARGET_RPS <= 0) {
  throw new Error('env TARGET_RPS must be positive number');
}

// ─── Custom metrics ──────────────────────────────────────────────────────────
const errorRate = new Rate('errors');
const publishLatency = new Trend('announcement_publish_latency_ms', true);
const fanoutRows = new Trend('announcement_fanout_rows');
const fanoutShortfall = new Counter('announcement_fanout_shortfall');

// ─── k6 options ──────────────────────────────────────────────────────────────
//
// executor=constant-arrival-rate держит фиксированный throughput независимо
// от latency — это что нам нужно для LOAD-1 AC «при rate 100 req/s».
//
// Если backend тормозит, k6 автоматически увеличит VU до maxVUs; дальше
// пойдут dropped iterations (видно в summary), — это legitimate сигнал
// что backend не тянет заявленный rate.
export const options = {
  scenarios: {
    announcement_publish: {
      executor: 'constant-arrival-rate',
      rate: TARGET_RPS,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: Math.max(20, TARGET_RPS),
      maxVUs: Math.max(100, TARGET_RPS * 3),
    },
  },
  thresholds: {
    // Publish — sync HTTP.  Fan-out записей идёт в той же транзакции
    // (см. publishAnnouncement §3), поэтому latency включает INSERT'ы
    // EXPECTED_FANOUT rows.  2s p95 — разумный budget.
    'announcement_publish_latency_ms': ['p(95)<2000'],
    // HTTP-failures — load-test считает успешным только 2xx.
    'http_req_failed': ['rate<0.01'],
    // Custom errors rate — включает и HTTP-failures, и case'ы когда
    // JSON не распарсился / нет outbox_fanout.
    'errors': ['rate<0.01'],
    // Каждый publish должен отдавать ожидаемое число fan-out rows;
    // 0 shortfalls — значит audience резолвится стабильно.
    'announcement_fanout_shortfall': ['count<10'],
  },
};

// ─── Headers (одна констант'а на VU-жизнь) ───────────────────────────────────
const jsonHeaders = {
  'Content-Type': 'application/json',
  // Cookie-based JWT — как в loadtest/requests.js.  Adjust если staging
  // использует Bearer.
  Cookie: `token=${TOKEN}`,
  // `X-Property-Slug` — hybrid tenant resolver (см. backend/src/middleware
  // tenantResolver).  Без него request attached к default property.
  'X-Property-Slug': PROPERTY_SLUG,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function safeJson(body) {
  try { return JSON.parse(body); } catch (_) { return null; }
}

function uniqSuffix() {
  // k6 VU's Math.random — deterministic в init, но в iteration — random.
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

// ─── Main iteration: create + publish ────────────────────────────────────────
export default function main() {
  // 1. Создаём draft-объявление.
  const createPayload = JSON.stringify({
    property_id: PROPERTY_ID,
    title: `LOAD-1 fanout ${uniqSuffix()}`,
    body_md: 'k6 LOAD-1 — announcement.published fan-out benchmark.',
    audience_type: 'all',
    notify_channels: ['web_push'],
    is_urgent: false,
  });
  const createRes = http.post(`${BASE}/api/v1/announcements`, createPayload, {
    headers: jsonHeaders,
    tags: { endpoint: 'create' },
  });
  const createOk = check(createRes, {
    'create 201': (r) => r.status === 201,
  });
  if (!createOk) {
    errorRate.add(1);
    // 429 (rate-limited) — частая причина: значит prereq «skip rate-limits»
    // не выполнен; см. loadtest/README.md.
    return;
  }

  const createBody = safeJson(createRes.body);
  const announcementId = createBody && createBody.announcement && createBody.announcement.id;
  if (!announcementId) {
    errorRate.add(1);
    return;
  }

  // 2. Publish → транзакционно INSERT'ит outbox rows.
  //    Возврат: { ok, announcement, outbox_fanout: N }.
  const publishRes = http.post(
    `${BASE}/api/v1/announcements/${announcementId}/publish`,
    null,
    { headers: jsonHeaders, tags: { endpoint: 'publish' } },
  );
  publishLatency.add(publishRes.timings.duration);

  const publishOk = check(publishRes, {
    'publish 200': (r) => r.status === 200,
    'publish has outbox_fanout': (r) => {
      const body = safeJson(r.body);
      return body && typeof body.outbox_fanout === 'number';
    },
  });
  errorRate.add(!publishOk);

  if (!publishOk) return;

  const publishBody = safeJson(publishRes.body);
  const rows = publishBody && typeof publishBody.outbox_fanout === 'number'
    ? publishBody.outbox_fanout
    : 0;
  fanoutRows.add(rows);
  if (rows < EXPECTED_FANOUT) {
    fanoutShortfall.add(EXPECTED_FANOUT - rows);
  }
}

// ─── Teardown: snapshot outbox state ─────────────────────────────────────────
export function teardown() {
  const res = http.get(`${BASE}/api/v1/admin/outbox/metrics`, {
    headers: jsonHeaders,
    tags: { endpoint: 'metrics' },
  });
  if (res.status !== 200) {
    console.log(`[teardown] outbox metrics fetch failed status=${res.status} body=${res.body}`);
    return;
  }
  const body = safeJson(res.body);
  if (!body) {
    console.log(`[teardown] outbox metrics non-JSON: ${res.body}`);
    return;
  }
  // Строчный JSON — чтобы grep'ать из CI логов.
  console.log(`[teardown] outbox metrics: ${JSON.stringify(body)}`);
}

// ─── Summary writer ──────────────────────────────────────────────────────────
export function handleSummary(data) {
  return {
    'loadtest/results-outbox-fanout.json': JSON.stringify(data, null, 2),
    stdout: textSummary(data),
  };
}

function textSummary(data) {
  const metrics = data.metrics || {};
  const lines = [
    '',
    '================================================================',
    '  LOAD-1 — announcement.published fan-out',
    '================================================================',
    `  target rate:          ${TARGET_RPS} req/s`,
    `  duration:             ${DURATION}`,
    `  expected fan-out:     ${EXPECTED_FANOUT} rows / publish`,
    `  property:             ${PROPERTY_SLUG}`,
    '',
    '  Metrics:',
  ];
  const interesting = [
    'announcement_publish_latency_ms',
    'announcement_fanout_rows',
    'announcement_fanout_shortfall',
    'http_req_duration',
    'http_req_failed',
    'errors',
    'iterations',
    'iteration_duration',
    'dropped_iterations',
    'vus',
    'vus_max',
  ];
  for (const name of interesting) {
    const m = metrics[name];
    if (!m) continue;
    const v = m.values || {};
    if ('p(95)' in v || 'p(99)' in v) {
      lines.push(
        `  ${name.padEnd(42)} avg=${(v.avg ?? 0).toFixed(1)} ` +
        `p95=${(v['p(95)'] ?? 0).toFixed(1)} p99=${(v['p(99)'] ?? 0).toFixed(1)}`,
      );
    } else if ('rate' in v) {
      lines.push(`  ${name.padEnd(42)} rate=${(v.rate * 100).toFixed(3)}%`);
    } else if ('count' in v) {
      lines.push(`  ${name.padEnd(42)} count=${v.count}`);
    } else if ('value' in v) {
      lines.push(`  ${name.padEnd(42)} value=${v.value}`);
    }
  }
  lines.push('');
  // Threshold-результаты сжато: OK/FAIL per threshold.
  const thr = data.root_group && data.root_group.checks;
  if (thr) {
    lines.push('  Checks:');
    for (const c of thr) {
      const ok = c.fails === 0;
      lines.push(`    ${ok ? '[OK]' : '[FAIL]'} ${c.name} — passes=${c.passes} fails=${c.fails}`);
    }
  }
  lines.push('');
  lines.push('  Full results JSON: loadtest/results-outbox-fanout.json');
  lines.push('');
  return lines.join('\n');
}
