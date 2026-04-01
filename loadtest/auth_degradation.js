/**
 * loadtest/auth_degradation.js
 *
 * Нагрузка на /api/auth/me с инъекцией деградации токенов (часть запросов без/с битым token)
 * для оценки устойчивости requireAuth-path при нестабильной инфраструктуре auth-зависимостей.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';
const TEST_TOKEN = __ENV.TEST_TOKEN || '';
const DEGRADED_RATIO = Math.min(0.95, Math.max(0, Number(__ENV.DEGRADED_RATIO || 0.2)));

const totalErrors = new Rate('auth_total_errors');
const degradedErrors = new Rate('auth_degraded_errors');
const healthyErrors = new Rate('auth_healthy_errors');
const latency = new Trend('auth_me_latency_degradation');

export const options = {
  stages: [
    { duration: '20s', target: 30 },
    { duration: '40s', target: 120 },
    { duration: '20s', target: 0 },
  ],
  thresholds: {
    auth_total_errors: ['rate<0.20'],
    auth_healthy_errors: ['rate<0.03'],
    auth_me_latency_degradation: ['p(95)<500', 'p(99)<900'],
  },
};

function buildHeaders(degraded) {
  if (degraded) {
    return {
      Cookie: Math.random() < 0.5 ? 'token=broken-token' : '',
      'X-Request-Id': `k6-auth-degraded-${__VU}-${__ITER}`,
    };
  }
  return {
    Cookie: `token=${TEST_TOKEN}`,
    'X-Request-Id': `k6-auth-healthy-${__VU}-${__ITER}`,
  };
}

export default function () {
  const degraded = Math.random() < DEGRADED_RATIO;
  const res = http.get(`${BASE_URL}/api/auth/me`, { headers: buildHeaders(degraded) });

  latency.add(res.timings.duration);

  const ok = degraded
    ? check(res, { 'degraded request handled (401/403/5xx)': r => [401, 403, 500, 502, 503, 504].includes(r.status) })
    : check(res, { 'healthy request is 200': r => r.status === 200 });

  totalErrors.add(!ok);
  if (degraded) degradedErrors.add(!ok);
  else healthyErrors.add(!ok);

  sleep(0.03 + Math.random() * 0.07);
}
