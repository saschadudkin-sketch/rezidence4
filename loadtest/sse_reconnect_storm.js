/**
 * loadtest/sse_reconnect_storm.js
 *
 * Эмуляция reconnect-storm: клиенты часто переподключаются к /api/chat/stream.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';
const TEST_TOKEN = __ENV.TEST_TOKEN || '';

const reconnectErrors = new Rate('sse_reconnect_errors');
const handshakeLatency = new Trend('sse_handshake_latency');

export const options = {
  scenarios: {
    reconnect_storm: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.RATE || 40),
      timeUnit: '1s',
      duration: __ENV.DURATION || '1m',
      preAllocatedVUs: Number(__ENV.VUS || 40),
      maxVUs: Number(__ENV.MAX_VUS || 120),
    },
  },
  thresholds: {
    sse_reconnect_errors: ['rate<0.05'],
    sse_handshake_latency: ['p(95)<700'],
  },
};

export default function () {
  const res = http.get(`${BASE_URL}/api/chat/stream`, {
    headers: {
      Cookie: `token=${TEST_TOKEN}`,
      Accept: 'text/event-stream',
      'X-Request-Id': `k6-sse-${__VU}-${__ITER}`,
    },
    timeout: __ENV.SSE_TIMEOUT || '4s',
    redirects: 0,
  });

  handshakeLatency.add(res.timings.duration);
  const ok = check(res, {
    'sse status 200': r => r.status === 200,
    'sse content-type': r => String(r.headers['Content-Type'] || '').toLowerCase().includes('text/event-stream'),
  });
  reconnectErrors.add(!ok);

  sleep(Number(__ENV.RECONNECT_PAUSE || 0.2));
}
