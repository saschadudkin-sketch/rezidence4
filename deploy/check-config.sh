#!/bin/bash
# check-config.sh — Pre-flight checklist для production deploy.
#
# Проверяет .env на:
#   • Существование + chmod 600
#   • Все required vars заполнены (не placeholders)
#   • JWT_SECRET ≥ 32 chars и ≠ PLATFORM_JWT_SECRET
#   • SMSRU_API_ID не STUB
#   • NODE_ENV=production
#   • DATABASE_URL имеет sslmode=require (если PG_SSL_REQUIRED ≠ 0)
#   • Не используются CI dummy values
#
# Использование:
#   cd /opt/domhub
#   bash deploy/check-config.sh
#
# Exit codes:
#   0 — всё ок, готов к docker compose up
#   1 — найдены critical issues, deploy будет fail/insecure

set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ERRORS=0
WARNINGS=0

red() { echo -e "\033[31m$1\033[0m"; }
yellow() { echo -e "\033[33m$1\033[0m"; }
green() { echo -e "\033[32m$1\033[0m"; }

err() { red "  ❌ $1"; ERRORS=$((ERRORS+1)); }
warn() { yellow "  ⚠️  $1"; WARNINGS=$((WARNINGS+1)); }
ok() { green "  ✓ $1"; }

echo "=== DomHub production pre-flight check ==="
echo ""

# ─── 1. .env existence + permissions ─────────────────────────────────────────
echo "[1] .env file:"
if [ ! -f .env ]; then
  err ".env not found. Copy from deploy/.env.production.template и заполни."
  echo ""
  echo "Cannot continue without .env. Exiting."
  exit 1
fi
ok ".env exists"

PERMS=$(stat -c "%a" .env 2>/dev/null || stat -f "%Lp" .env)
if [ "$PERMS" != "600" ] && [ "$PERMS" != "400" ]; then
  warn ".env permissions = $PERMS (рекомендуется 600). Fix: chmod 600 .env"
else
  ok ".env permissions = $PERMS"
fi

# Загружаем .env в shell scope
set -a
source .env 2>/dev/null
set +a

# ─── 2. NODE_ENV ─────────────────────────────────────────────────────────────
echo ""
echo "[2] NODE_ENV:"
if [ "${NODE_ENV:-}" = "production" ]; then
  ok "NODE_ENV=production"
else
  err "NODE_ENV=${NODE_ENV:-<unset>} (должно быть 'production')"
fi

# ─── 3. Required secrets ─────────────────────────────────────────────────────
echo ""
echo "[3] Required secrets:"

# Проверка placeholder'ов из template
check_placeholder() {
  local var="$1"
  local val="${!var:-}"
  if [ -z "$val" ]; then
    err "$var не задан"
    return
  fi
  if echo "$val" | grep -qE "^__GENERATE_|^__REAL_|^__VAPID_"; then
    err "$var всё ещё placeholder ($val) — заполни реальным значением"
    return
  fi
  if echo "$val" | grep -qE "^ci-dummy-|ci-build-only|ci-e2e-|ci-nightly-"; then
    err "$var = '$val' (CI dummy values из ops/ci-dummy.env — НЕ для prod!)"
    return
  fi
  ok "$var задан (длина ${#val})"
}

check_placeholder DB_PASSWORD
check_placeholder REDIS_PASSWORD
check_placeholder JWT_SECRET
check_placeholder PLATFORM_JWT_SECRET
check_placeholder UPLOAD_SIGNING_SECRET

# ─── 4. JWT secrets length + uniqueness ──────────────────────────────────────
echo ""
echo "[4] JWT secret rules:"

if [ -n "${JWT_SECRET:-}" ] && [ ${#JWT_SECRET} -lt 32 ]; then
  err "JWT_SECRET длина ${#JWT_SECRET} < 32 chars (security audit #SEC). openssl rand -hex 32"
elif [ -n "${JWT_SECRET:-}" ]; then
  ok "JWT_SECRET ≥ 32 chars"
fi

if [ -n "${PLATFORM_JWT_SECRET:-}" ] && [ ${#PLATFORM_JWT_SECRET} -lt 32 ]; then
  err "PLATFORM_JWT_SECRET длина ${#PLATFORM_JWT_SECRET} < 32 chars"
elif [ -n "${PLATFORM_JWT_SECRET:-}" ]; then
  ok "PLATFORM_JWT_SECRET ≥ 32 chars"
fi

if [ -n "${JWT_SECRET:-}" ] && [ -n "${PLATFORM_JWT_SECRET:-}" ] && \
   [ "$JWT_SECRET" = "$PLATFORM_JWT_SECRET" ]; then
  err "JWT_SECRET == PLATFORM_JWT_SECRET (security audit #3 — должны быть разные)"
else
  ok "JWT_SECRET ≠ PLATFORM_JWT_SECRET"
fi

# ─── 5. URLs ─────────────────────────────────────────────────────────────────
echo ""
echo "[5] Public URLs:"

if [ -z "${FRONTEND_URL:-}" ]; then
  err "FRONTEND_URL не задан"
elif echo "$FRONTEND_URL" | grep -qE "localhost|127\.0\.0\.1"; then
  warn "FRONTEND_URL=$FRONTEND_URL содержит localhost — для prod подставь реальный домен"
else
  ok "FRONTEND_URL=$FRONTEND_URL"
fi

if [ -z "${YOUR_DOMAIN:-}" ]; then
  err "YOUR_DOMAIN не задан"
else
  ok "YOUR_DOMAIN=$YOUR_DOMAIN"
fi

# ─── 6. SMS provider ─────────────────────────────────────────────────────────
echo ""
echo "[6] SMS provider:"
if [ "${SMSRU_API_ID:-STUB}" = "STUB" ]; then
  warn "SMSRU_API_ID=STUB — OTP не будут отправляться через SMS (только в логи). OK для testing, для prod заменить."
else
  ok "SMSRU_API_ID задан"
fi

# ─── 7. PG SSL ───────────────────────────────────────────────────────────────
echo ""
echo "[7] PostgreSQL SSL:"
if [ "${PG_SSL_REQUIRED:-1}" = "0" ]; then
  warn "PG_SSL_REQUIRED=0 (SSL gate выключен — OK только для self-hosted dev)"
else
  if [ -n "${DATABASE_URL:-}" ] && ! echo "$DATABASE_URL" | grep -qE 'sslmode=(require|verify-ca|verify-full)'; then
    warn "DATABASE_URL не содержит sslmode=require — OK для embedded postgres в docker-compose, но fail если external DB"
  fi
fi

# ─── 8. Refresh legacy fallback ──────────────────────────────────────────────
echo ""
echo "[8] Auth flags:"
if [ "${REFRESH_LEGACY_FALLBACK_ENABLED:-0}" = "1" ]; then
  warn "REFRESH_LEGACY_FALLBACK_ENABLED=1 (только для migration window — выключи после)"
else
  ok "REFRESH_LEGACY_FALLBACK_ENABLED=0"
fi

# ─── 9. Docker daemon ────────────────────────────────────────────────────────
echo ""
echo "[9] Docker daemon:"
if ! command -v docker >/dev/null 2>&1; then
  err "Docker не установлен. Install: curl -fsSL https://get.docker.com | sh"
elif ! docker info >/dev/null 2>&1; then
  err "Docker daemon недоступен. Start: sudo systemctl start docker"
else
  ok "Docker $(docker --version | head -1)"
fi

if ! docker compose version >/dev/null 2>&1; then
  err "Docker Compose v2 недоступен"
else
  ok "Compose $(docker compose version --short)"
fi

# ─── 10. ops/ci-dummy.env safety ─────────────────────────────────────────────
echo ""
echo "[10] CI artifacts (must NOT be in prod):"
if [ -f ops/ci-dummy.env ]; then
  warn "ops/ci-dummy.env существует — это CI-only file. Если он используется как .env источник — security compromise!"
fi
if [ -f .env ] && [ -f ops/ci-dummy.env ]; then
  if cmp -s .env ops/ci-dummy.env 2>/dev/null; then
    err ".env идентичен ops/ci-dummy.env — это CI dummy creds, НЕ prod!"
  fi
fi

# ─── Финал ───────────────────────────────────────────────────────────────────
echo ""
echo "=========================================="
if [ $ERRORS -gt 0 ]; then
  red "❌ ERRORS: $ERRORS, WARNINGS: $WARNINGS"
  echo "Не запускай docker compose up до фикса критичных issues выше."
  exit 1
elif [ $WARNINGS -gt 0 ]; then
  yellow "⚠️  WARNINGS: $WARNINGS (нет critical errors)"
  echo "Можно запускать docker compose up, но проверь warnings."
  exit 0
else
  green "✓ Все проверки пройдены."
  echo ""
  echo "Запустить stack:  docker compose up -d"
  echo "Логи backend:     docker compose logs -f backend"
  exit 0
fi
