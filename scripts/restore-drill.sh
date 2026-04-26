#!/bin/bash
# scripts/restore-drill.sh — DATA-1: автоматизированный drill восстановления backup'ов.
#
# BACKLOG: DATA-1 «Первый restore drill» (P0 — до go-live Замоскворечья).
# Источник: backup.sh + go-live-zamoskv-runbook.md §6 rollback.
#
# Что делает:
#   1. Проверяет, что в ./backups/ есть актуальные *.sql.gz файлы для всех
#      БД из BACKUP_DATABASES (residenze platform zamoskv).
#   2. Поднимает изолированный postgres-контейнер на свободном порту
#      (домашняя сеть domhub_drill, name domhub-restore-drill-pg).
#   3. Восстанавливает каждую БД из последнего snapshot ($db_latest.sql.gz).
#   4. Проверяет invariants:
#       - residenze: SELECT COUNT(*) FROM users > 0
#       - platform:  SELECT COUNT(*) FROM properties >= 1
#       - zamoskv:   SELECT COUNT(*) FROM v1_property_migrations >= 22
#   5. Замеряет RTO для каждой БД + total wall-clock.
#   6. Чистит за собой контейнер и сеть.
#
# Exit codes:
#   0 — drill пройден, RTO в логи
#   1 — отсутствуют backup файлы
#   2 — pg_restore failure
#   3 — invariant check failed
#   4 — docker daemon недоступен
#
# Использование:
#   bash scripts/restore-drill.sh           # all defaults
#   BACKUP_DIR=./other bash scripts/restore-drill.sh
#   PG_IMAGE=postgres:16-alpine bash scripts/restore-drill.sh
#
# Запускается локально или в CI (на staging-VPS). На prod — никогда не
# запускать: контейнер потребляет ресурсы, и параллельная нагрузка может
# исказить latency сервиса.

set -u

# ─── Конфигурация ─────────────────────────────────────────────────────────
BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_DATABASES="${BACKUP_DATABASES:-residenze platform zamoskv}"
PG_IMAGE="${PG_IMAGE:-postgres:16-alpine}"
PG_PORT="${PG_PORT:-15432}"
PG_PASSWORD="${PG_PASSWORD:-drill_only_$RANDOM}"
PG_USER="${PG_USER:-residenze}"
NETWORK="${NETWORK:-domhub_drill}"
CONTAINER="${CONTAINER:-domhub-restore-drill-pg}"

# Color helpers (bash-only, безопасно если stdout не tty)
red()    { printf "\033[31m%s\033[0m\n" "$1"; }
yellow() { printf "\033[33m%s\033[0m\n" "$1"; }
green()  { printf "\033[32m%s\033[0m\n" "$1"; }

err()  { red "  ❌ $1"; }
warn() { yellow "  ⚠️  $1"; }
ok()   { green "  ✓ $1"; }

# ─── Cleanup hook ──────────────────────────────────────────────────────────
cleanup() {
  echo ""
  echo "[drill] cleanup..."
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
  ok "cleanup done"
}
trap cleanup EXIT

# ─── 1. Pre-flight ─────────────────────────────────────────────────────────
echo "=== DATA-1 Restore Drill — pristine docker ==="
echo "Backup dir:     $BACKUP_DIR"
echo "Databases:      $BACKUP_DATABASES"
echo "Postgres image: $PG_IMAGE"
echo ""

if ! docker info >/dev/null 2>&1; then
  err "Docker daemon недоступен. Запусти Docker Desktop / dockerd."
  exit 4
fi
ok "Docker daemon доступен"

# Проверяем backup файлы
MISSING=0
declare -A LATEST_FILES
for DB in $BACKUP_DATABASES; do
  LATEST="${BACKUP_DIR}/${DB}_latest.sql.gz"
  if [ ! -f "$LATEST" ]; then
    err "Не найден backup: $LATEST"
    MISSING=$((MISSING + 1))
  else
    SIZE=$(du -sh "$LATEST" 2>/dev/null | cut -f1 || echo "?")
    AGE_HOURS=$(( ( $(date +%s) - $(stat -c %Y "$LATEST" 2>/dev/null || stat -f %m "$LATEST") ) / 3600 ))
    if [ "$AGE_HOURS" -gt 48 ]; then
      warn "$LATEST: ${SIZE}, возраст ${AGE_HOURS}h (>48h — устаревший?)"
    else
      ok "$LATEST: ${SIZE}, возраст ${AGE_HOURS}h"
    fi
    LATEST_FILES[$DB]="$LATEST"
  fi
done

if [ "$MISSING" -gt 0 ]; then
  err "Отсутствуют ${MISSING} backup файлов. Запусти backup.sh сначала."
  exit 1
fi

# ─── 2. Поднимаем pristine postgres ─────────────────────────────────────────
echo ""
echo "[drill] starting pristine postgres on port $PG_PORT..."
docker network create "$NETWORK" >/dev/null 2>&1 || true

docker run -d \
  --name "$CONTAINER" \
  --network "$NETWORK" \
  -p "127.0.0.1:${PG_PORT}:5432" \
  -e "POSTGRES_USER=$PG_USER" \
  -e "POSTGRES_PASSWORD=$PG_PASSWORD" \
  -e "POSTGRES_DB=postgres" \
  "$PG_IMAGE" >/dev/null

# Ждём, пока БД станет доступна (max 30s)
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  if docker exec "$CONTAINER" pg_isready -U "$PG_USER" >/dev/null 2>&1; then
    ok "postgres ready after ${i}s"
    break
  fi
  sleep 1
  if [ "$i" -eq 15 ]; then
    err "postgres не поднялся за 15s"
    docker logs "$CONTAINER" | tail -20
    exit 2
  fi
done

# ─── 3. Создаём целевые БД ─────────────────────────────────────────────────
echo ""
echo "[drill] creating target databases..."
for DB in $BACKUP_DATABASES; do
  docker exec -e PGPASSWORD="$PG_PASSWORD" "$CONTAINER" \
    psql -U "$PG_USER" -d postgres -c "CREATE DATABASE $DB OWNER $PG_USER;" >/dev/null 2>&1 || true
  ok "DB $DB created"
done

# ─── 4. Restore + RTO measurement ───────────────────────────────────────────
echo ""
echo "[drill] restoring backups..."
TOTAL_START=$(date +%s)
declare -A RTO_PER_DB

for DB in $BACKUP_DATABASES; do
  LATEST="${LATEST_FILES[$DB]}"
  echo "[drill] $DB ← $LATEST"
  START=$(date +%s)

  if gunzip -c "$LATEST" | docker exec -i \
       -e PGPASSWORD="$PG_PASSWORD" "$CONTAINER" \
       psql -U "$PG_USER" -d "$DB" -v ON_ERROR_STOP=1 >/tmp/restore_${DB}.log 2>&1; then
    END=$(date +%s)
    RTO=$((END - START))
    RTO_PER_DB[$DB]="$RTO"
    ok "$DB restored in ${RTO}s"
  else
    err "$DB restore FAILED — см. /tmp/restore_${DB}.log"
    tail -10 /tmp/restore_${DB}.log
    exit 2
  fi
done

TOTAL_END=$(date +%s)
TOTAL_RTO=$((TOTAL_END - TOTAL_START))

# ─── 5. Invariant checks ────────────────────────────────────────────────────
echo ""
echo "[drill] invariant checks..."
INVARIANT_FAILURES=0

check_count() {
  local DB="$1"
  local QUERY="$2"
  local MIN="$3"
  local LABEL="$4"
  COUNT=$(docker exec -e PGPASSWORD="$PG_PASSWORD" "$CONTAINER" \
    psql -U "$PG_USER" -d "$DB" -tAc "$QUERY" 2>/dev/null | tr -d ' ')
  if [ -z "$COUNT" ] || [ "$COUNT" = "" ]; then
    err "$DB: $LABEL — query returned empty (table missing?)"
    INVARIANT_FAILURES=$((INVARIANT_FAILURES + 1))
  elif [ "$COUNT" -lt "$MIN" ]; then
    err "$DB: $LABEL — count=$COUNT (expected >= $MIN)"
    INVARIANT_FAILURES=$((INVARIANT_FAILURES + 1))
  else
    ok "$DB: $LABEL — count=$COUNT"
  fi
}

if echo "$BACKUP_DATABASES" | grep -qw residenze; then
  check_count residenze "SELECT COUNT(*) FROM users" 1 "users count"
fi
if echo "$BACKUP_DATABASES" | grep -qw platform; then
  check_count platform "SELECT COUNT(*) FROM properties" 1 "properties count"
fi
if echo "$BACKUP_DATABASES" | grep -qw zamoskv; then
  check_count zamoskv "SELECT COUNT(*) FROM v1_property_migrations" 22 "v1_property_migrations applied"
fi

# ─── 6. Финальный отчёт ─────────────────────────────────────────────────────
echo ""
echo "=========================================="
echo "RTO summary:"
for DB in $BACKUP_DATABASES; do
  printf "  %-12s %ss\n" "$DB" "${RTO_PER_DB[$DB]:-?}"
done
printf "  %-12s %ss (wall-clock)\n" "TOTAL" "$TOTAL_RTO"
echo ""

if [ "$INVARIANT_FAILURES" -gt 0 ]; then
  red "❌ DRILL FAILED — $INVARIANT_FAILURES invariant(s) violated"
  exit 3
fi

green "✅ DRILL PASSED — все БД восстановлены, инварианты выдержаны"
echo ""
echo "Запиши в operational journal: дата + RTO + размер backup'ов."
echo "Если total RTO > 5 минут — задумайся об оптимизации (PITR, parallel restore)."
exit 0
