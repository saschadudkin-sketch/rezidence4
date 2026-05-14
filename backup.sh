#!/bin/sh
# backup.sh — резервное копирование PostgreSQL внутри Docker backup-контейнера.
#
# FIX [AUDIT]: этот скрипт вызывается через busybox crond (не sleep-цикл).
# Расписание задаётся в docker-compose entrypoint: "0 3 * * *" = 03:00 UTC каждый день.
#
# Преимущество перед sleep 86400:
#   - При рестарте контейнера следующий запуск будет в ближайшее 03:00, не через 24ч.
#   - cron устойчив к перезапускам: не теряет день при падении в 23:59.
#
# SEC [AUDIT #5]: default backup discovery reads active tenant DBs from the
# platform registry. BACKUP_DATABASES remains as an explicit override for
# break-glass/manual runs (space-separated database names).
#
# Переменные окружения (задаются в docker-compose):
#   PGPASSWORD        — пароль PostgreSQL (обязателен)
#   KEEP_DAYS         — сколько дней хранить бэкапы (по умолчанию 7)
#   BACKUP_DIR        — директория для бэкапов (по умолчанию /backups)
#   DB_HOST           — хост PostgreSQL (по умолчанию db)
#   DB_USER           — пользователь PostgreSQL (по умолчанию residenze)
#   BACKUP_DATABASES  — optional explicit DB names; when empty, discover tenants
#                       from platform.properties where active

set -e

BACKUP_DIR="${BACKUP_DIR:-/backups}"
KEEP_DAYS="${KEEP_DAYS:-7}"
DB_HOST="${DB_HOST:-db}"
DB_USER="${DB_USER:-residenze}"
PLATFORM_DB_URL="${PLATFORM_DB_URL:-postgresql://${DB_USER}:${PGPASSWORD}@${DB_HOST}:5432/platform}"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"

discover_backup_targets() {
  if [ -n "${BACKUP_DATABASES:-}" ]; then
    for DB in $BACKUP_DATABASES; do
      echo "${DB}|${DB}"
    done
    return
  fi

  # Always include legacy/global and platform registry DBs.
  echo "${DB_NAME:-residenze}|${DB_NAME:-residenze}"
  echo "platform|platform"

  psql "$PLATFORM_DB_URL" -At -F '|' \
    -c "SELECT slug, db_connection_url FROM properties WHERE COALESCE(is_active, true) = true AND COALESCE(status, 'active') <> 'terminated' ORDER BY slug" \
    2>/tmp/psql_properties.err || {
      echo "[backup] ERROR: cannot discover tenant DBs from platform registry: $(cat /tmp/psql_properties.err)" >&2
      return 1
    }
}

backup_one() {
  LABEL="$1"
  TARGET="$2"
  SAFE_LABEL=$(echo "$LABEL" | tr -c 'A-Za-z0-9_.-' '_')
  FNAME="${BACKUP_DIR}/${SAFE_LABEL}_${DATE}.sql.gz"
  TMP_SQL="/tmp/backup_${SAFE_LABEL}_$$.sql"
  echo "[backup] $(date '+%Y-%m-%d %H:%M:%S') — starting backup of ${LABEL}@${DB_HOST}..."

  if echo "$TARGET" | grep -q '://'; then
    pg_dump "$TARGET" > "$TMP_SQL" 2>/tmp/pg_dump.err
    DUMP_STATUS=$?
  else
    pg_dump -h "$DB_HOST" -U "$DB_USER" "$TARGET" > "$TMP_SQL" 2>/tmp/pg_dump.err
    DUMP_STATUS=$?
  fi

  if [ "$DUMP_STATUS" -eq 0 ]; then
    gzip -c "$TMP_SQL" > "$FNAME"
    rm -f "$TMP_SQL"
    SIZE=$(du -sh "$FNAME" 2>/dev/null | cut -f1 || echo "?")
    echo "[backup] saved: $FNAME ($SIZE)"
    LATEST="${BACKUP_DIR}/${SAFE_LABEL}_latest.sql.gz"
    rm -f "$LATEST"
    cp "$FNAME" "$LATEST"
    return 0
  fi

  echo "[backup] ERROR: pg_dump ${LABEL} failed! $(cat /tmp/pg_dump.err)" >&2
  rm -f "$TMP_SQL"
  rm -f "$FNAME"
  return 1
}

# SEC [AUDIT #5]: per-database цикл — упадёт на первой ошибке (set -e), но
# каждая БД бекапится в отдельный файл чтобы восстановление было гранулярным.
FAILURES=0
TARGETS_FILE="/tmp/backup_targets.$$"
if discover_backup_targets > "$TARGETS_FILE"; then
  while IFS='|' read -r LABEL TARGET; do
    [ -n "$LABEL" ] || continue
    if ! backup_one "$LABEL" "$TARGET"; then
      FAILURES=$((FAILURES + 1))
    fi
  done < "$TARGETS_FILE"
else
  FAILURES=$((FAILURES + 1))
fi
rm -f "$TARGETS_FILE"

# Ротация: удаляем файлы старше KEEP_DAYS дней (по всем БД сразу)
DELETED=$(find "$BACKUP_DIR" -name "*.sql.gz" -mtime "+${KEEP_DAYS}" -print)
if [ -n "$DELETED" ]; then
  find "$BACKUP_DIR" -name "*.sql.gz" -mtime "+${KEEP_DAYS}" -delete
  echo "[backup] rotation: removed old backups older than ${KEEP_DAYS} days"
fi

TOTAL=$(find "$BACKUP_DIR" -name "*.sql.gz" | wc -l)
echo "[backup] done — ${TOTAL} backup(s) stored in ${BACKUP_DIR}, failures: ${FAILURES}"

# Non-zero exit если хоть одна БД не сбекапилась — cron логи покажут
[ "$FAILURES" -eq 0 ] || exit 1
