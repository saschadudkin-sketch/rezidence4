/**
 * loadtest/requests.js — FIX [T2]: нагрузочный тест k6
 *
 * ПРОБЛЕМА: Неизвестно при какой нагрузке упадёт SSE, база данных, Node.js процесс.
 *
 * Запуск: k6 run loadtest/requests.js -e BASE_URL=http://localhost:3001 -e TEST_TOKEN=<jwt>
 *
 * Сценарии:
 *   1. GET /api/requests — чтение с пагинацией (основная нагрузка)
 *   2. POST /api/requests — создание заявки
 *   3. GET /api/health — healthcheck
 *
 * Thresholds:
 *   - p95 < 500ms для GET
 *   - p95 < 1000ms для POST
 *   - Error rate < 1%
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE   = __ENV.BASE_URL || 'http://localhost:3001';
const TOKEN  = __ENV.TEST_TOKEN || 'test';

const errorRate = new Rate('errors');
const getLatency = new Trend('get_requests_latency');
const postLatency = new Trend('post_requests_latency');

export const options = {
  stages: [
    { duration: '10s', target: 10 },   // ramp-up
    { duration: '30s', target: 50 },   // sustained load
    { duration: '10s', target: 100 },  // peak
    { duration: '10s', target: 0 },    // ramp-down
  ],
  thresholds: {
    'get_requests_latency': ['p(95)<500'],
    'post_requests_latency': ['p(95)<1000'],
    'errors': ['rate<0.01'],
  },
};

const headers = {
  'Content-Type': 'application/json',
  Cookie: `token=${TOKEN}`,
};

export default function () {
  // 80% — GET (чтение заявок с пагинацией)
  if (Math.random() < 0.8) {
    const page = Math.floor(Math.random() * 5) + 1;
    const res = http.get(`${BASE}/api/requests?page=${page}&limit=50`, { headers });
    getLatency.add(res.timings.duration);
    const ok = check(res, {
      'GET /requests status 200': (r) => r.status === 200,
      'GET /requests has data': (r) => {
        try {
          const body = JSON.parse(r.body);
          return Array.isArray(body.data);
        } catch { return false; }
      },
    });
    errorRate.add(!ok);
  }
  // 15% — POST (создание заявки)
  else if (Math.random() < 0.9375) {
    const payload = JSON.stringify({
      type: 'pass',
      category: 'guest',
      visitorName: `Тест Гость ${Date.now()}`,
      comment: 'k6 load test',
    });
    const res = http.post(`${BASE}/api/requests`, payload, { headers });
    postLatency.add(res.timings.duration);
    const ok = check(res, {
      'POST /requests status 201': (r) => r.status === 201,
    });
    errorRate.add(!ok);
  }
  // 5% — healthcheck
  else {
    const res = http.get(`${BASE}/api/health`);
    check(res, { 'health OK': (r) => r.status === 200 });
  }

  sleep(0.1 + Math.random() * 0.3);
}

export function handleSummary(data) {
  return {
    'loadtest/results.json': JSON.stringify(data, null, 2),
    stdout: textSummary(data, { indent: '  ', enableColors: true }),
  };
}

// k6 built-in
function textSummary(data) {
  const metrics = data.metrics || {};
  const lines = ['=== Load Test Results ==='];
  for (const [name, m] of Object.entries(metrics)) {
    if (m.values) {
      lines.push(`  ${name}: avg=${m.values.avg?.toFixed(1)}ms p95=${m.values['p(95)']?.toFixed(1)}ms`);
    }
  }
  return lines.join('\n');
}
