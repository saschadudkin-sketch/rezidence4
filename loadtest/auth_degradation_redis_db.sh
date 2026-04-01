#!/usr/bin/env bash
set -euo pipefail

# Orchestrates auth-path load while intermittently restarting Redis (and optionally DB)
# to validate requireAuth latency/error stability during dependency degradation.

BASE_URL="${BASE_URL:-http://localhost:3001}"
TEST_TOKEN="${TEST_TOKEN:-}"
DEGRADED_RATIO="${DEGRADED_RATIO:-0.25}"
FLAP_REDIS="${FLAP_REDIS:-1}"
FLAP_DB="${FLAP_DB:-0}"
FLAP_ITERATIONS="${FLAP_ITERATIONS:-3}"
FLAP_DOWN_SECONDS="${FLAP_DOWN_SECONDS:-8}"
FLAP_UP_SECONDS="${FLAP_UP_SECONDS:-15}"

if [[ -z "${TEST_TOKEN}" ]]; then
  echo "ERROR: TEST_TOKEN is required"
  echo "Usage: TEST_TOKEN=<jwt> BASE_URL=http://localhost:3001 ./loadtest/auth_degradation_redis_db.sh"
  exit 2
fi

if ! command -v k6 >/dev/null 2>&1; then
  echo "ERROR: k6 is required in PATH"
  exit 2
fi

flap_service() {
  local svc="$1"
  for i in $(seq 1 "${FLAP_ITERATIONS}"); do
    echo "[chaos] ${svc}: stop (${i}/${FLAP_ITERATIONS})"
    docker compose stop "${svc}" >/dev/null
    sleep "${FLAP_DOWN_SECONDS}"
    echo "[chaos] ${svc}: start (${i}/${FLAP_ITERATIONS})"
    docker compose up -d "${svc}" >/dev/null
    sleep "${FLAP_UP_SECONDS}"
  done
}

if [[ "${FLAP_REDIS}" == "1" ]]; then
  flap_service redis &
  REDIS_PID=$!
else
  REDIS_PID=""
fi

if [[ "${FLAP_DB}" == "1" ]]; then
  flap_service db &
  DB_PID=$!
else
  DB_PID=""
fi

set +e
k6 run loadtest/auth_degradation.js \
  -e BASE_URL="${BASE_URL}" \
  -e TEST_TOKEN="${TEST_TOKEN}" \
  -e DEGRADED_RATIO="${DEGRADED_RATIO}"
K6_EXIT=$?
set -e

[[ -n "${REDIS_PID}" ]] && wait "${REDIS_PID}" || true
[[ -n "${DB_PID}" ]] && wait "${DB_PID}" || true

exit ${K6_EXIT}
