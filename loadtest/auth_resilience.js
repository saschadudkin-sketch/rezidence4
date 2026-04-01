/**
 * loadtest/auth_resilience.js
 *
 * Цель:
 *   Проверить hot-path requireAuth (/api/auth/me) под нагрузкой и зафиксировать SLO:
 *   - latency p95/p99
 *   - error rate
 *   - поведение при burst нагрузке
 *
 * Запуск:
 *   k6 run loadtest/auth_resilience.js \
 *     -e BASE_URL=http://localhost:3001 \
 *     -e TEST_TOKEN=<jwt>
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';
const TEST_TOKEN = __ENV.TEST_TOKEN || '';

const authErrors = new Rate('auth_errors');
const authLatency = new Trend('auth_me_latency');

export const options = {
  stages: [
    { duration: '15s', target: 20 },
    { duration: '30s', target: 80 },
    { duration: '15s', target: 150 },
    { duration: '15s', target: 0 },
  ],
  thresholds: {
    auth_errors: ['rate<0.01'],
    auth_me_latency: ['p(95)<350', 'p(99)<700'],
  },
};

function getHeaders() {
  return {
    Cookie: `token=${TEST_TOKEN}`,
    'X-Request-Id': `k6-auth-${__VU}-${__ITER}`,
  };
}

export default function () {
  const res = http.get(`${BASE_URL}/api/auth/me`, { headers: getHeaders() });
  authLatency.add(res.timings.duration);

  const ok = check(res, {
    'GET /api/auth/me status 200': (r) => r.status === 200,
    'GET /api/auth/me has user': (r) => {
      try {
        const body = JSON.parse(r.body);
        return Boolean(body?.user?.uid);
      } catch {
        return false;
      }
    },
  });

  authErrors.add(!ok);
  sleep(0.05 + Math.random() * 0.1);
}

function summaryText(data) {
  const p95 = data.metrics?.auth_me_latency?.values?.['p(95)'];
  const p99 = data.metrics?.auth_me_latency?.values?.['p(99)'];
  const errorRate = data.metrics?.auth_errors?.values?.rate;
  return [
    '=== Auth Resilience Load Test ===',
    `auth_me_latency p95: ${p95?.toFixed?.(1) ?? 'n/a'}ms`,
    `auth_me_latency p99: ${p99?.toFixed?.(1) ?? 'n/a'}ms`,
    `auth_errors rate: ${(errorRate ?? 0).toFixed(4)}`,
  ].join('\n');
}

export function handleSummary(data) {
  return {
    'loadtest/auth_resilience_results.json': JSON.stringify(data, null, 2),
    stdout: summaryText(data),
  };
}
