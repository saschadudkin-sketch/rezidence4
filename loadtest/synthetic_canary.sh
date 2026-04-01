#!/usr/bin/env bash
set -euo pipefail

# synthetic_canary.sh
# Быстрый smoke/canary для критичных endpoint'ов:
#  - /api/health
#  - /api/auth/me
#  - /api/chat/stream (SSE handshake)
#
# Пример:
#   BASE_URL=http://localhost:3001 TOKEN=<jwt> ./loadtest/synthetic_canary.sh

BASE_URL="${BASE_URL:-http://localhost:3001}"
TOKEN="${TOKEN:-}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-10}"

if [[ -z "${TOKEN}" ]]; then
  echo "ERROR: TOKEN env is required"
  echo "Usage: BASE_URL=http://localhost:3001 TOKEN=<jwt> ./loadtest/synthetic_canary.sh"
  exit 2
fi

echo "[1/3] health check: ${BASE_URL}/api/health"
health_code="$(curl -sS -o /dev/null -w '%{http_code}' "${BASE_URL}/api/health")"
if [[ "${health_code}" != "200" ]]; then
  echo "FAIL: /api/health returned HTTP ${health_code}"
  exit 1
fi

echo "[2/3] auth me: ${BASE_URL}/api/auth/me"
auth_code="$(curl -sS -o /dev/null -w '%{http_code}' --cookie "token=${TOKEN}" "${BASE_URL}/api/auth/me")"
if [[ "${auth_code}" != "200" ]]; then
  echo "FAIL: /api/auth/me returned HTTP ${auth_code}"
  exit 1
fi

echo "[3/3] chat stream SSE handshake: ${BASE_URL}/api/chat/stream"
# Для canary достаточно проверить, что сервер отвечает 200 и отдаёт event-stream.
headers="$(curl -sS -D - --max-time "${TIMEOUT_SECONDS}" --cookie "token=${TOKEN}" "${BASE_URL}/api/chat/stream" -o /dev/null || true)"
stream_status="$(echo "${headers}" | awk '/^HTTP\// {print $2}' | tail -n1)"
stream_ct="$(echo "${headers}" | awk -F': ' 'tolower($1)=="content-type" {print tolower($2)}' | tr -d '\r' | tail -n1)"

if [[ "${stream_status}" != "200" ]]; then
  echo "FAIL: /api/chat/stream returned HTTP ${stream_status:-unknown}"
  exit 1
fi
if [[ "${stream_ct}" != *"text/event-stream"* ]]; then
  echo "FAIL: /api/chat/stream content-type is '${stream_ct:-missing}', expected text/event-stream"
  exit 1
fi

echo "OK: synthetic canary passed"
