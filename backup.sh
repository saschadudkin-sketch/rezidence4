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
# Переменные окружения (задаются в docker-compose):
#   PGPASSWORD  — пароль PostgreSQL (обязателен)
#   KEEP_DAYS   — сколько дней хранить бэкапы (по умолчанию 7)
#   BACKUP_DIR  — директория для бэкапов (по умолчанию /backups)
#   DB_HOST     — хост PostgreSQL (по умолчанию db)
#   DB_USER     — пользователь PostgreSQL (по умолчанию residenze)
#   DB_NAME     — имя БД (по умолчанию residenze)

set -e

BACKUP_DIR="${BACKUP_DIR:-/backups}"
KEEP_DAYS="${KEEP_DAYS:-7}"
DB_HOST="${DB_HOST:-db}"
DB_USER="${DB_USER:-residenze}"
DB_NAME="${DB_NAME:-residenze}"
DATE=$(date +%Y%m%d_%H%M%S)
FNAME="${BACKUP_DIR}/db_${DATE}.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "[backup] $(date '+%Y-%m-%d %H:%M:%S') — starting backup of ${DB_NAME}@${DB_HOST}..."

if pg_dump -h "$DB_HOST" -U "$DB_USER" "$DB_NAME" | gzip > "$FNAME"; then
  SIZE=$(du -sh "$FNAME" 2>/dev/null | cut -f1 || echo "?")
  echo "[backup] saved: $FNAME ($SIZE)"
else
  echo "[backup] ERROR: pg_dump failed! Removing partial file."
  rm -f "$FNAME"
  exit 1
fi

# Ротация: удаляем файлы старше KEEP_DAYS дней
DELETED=$(find "$BACKUP_DIR" -name "db_*.sql.gz" -mtime "+${KEEP_DAYS}" -print)
if [ -n "$DELETED" ]; then
  find "$BACKUP_DIR" -name "db_*.sql.gz" -mtime "+${KEEP_DAYS}" -delete
  echo "[backup] rotation: removed old backups older than ${KEEP_DAYS} days"
fi

TOTAL=$(find "$BACKUP_DIR" -name "db_*.sql.gz" | wc -l)
echo "[backup] done — ${TOTAL} backup(s) stored in ${BACKUP_DIR}"
