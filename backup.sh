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
# SEC [AUDIT #5]: раньше дампилась только legacy `residenze` БД.  С переходом
# на platform-v1 multi-tenant архитектуру обязательно бекапить:
#   - residenze — legacy данные (пока жива)
#   - platform — registry (список tenant'ов, platform_admins, audit_log)
#   - zamoskv — per-tenant данные первого production клиента
# Список БД управляется через env BACKUP_DATABASES (разделитель — пробел).
# При добавлении нового tenant'а достаточно допиcать slug в compose env.
#
# Переменные окружения (задаются в docker-compose):
#   PGPASSWORD        — пароль PostgreSQL (обязателен)
#   KEEP_DAYS         — сколько дней хранить бэкапы (по умолчанию 7)
#   BACKUP_DIR        — директория для бэкапов (по умолчанию /backups)
#   DB_HOST           — хост PostgreSQL (по умолчанию db)
#   DB_USER           — пользователь PostgreSQL (по умолчанию residenze)
#   BACKUP_DATABASES  — список БД через пробел (по умолчанию "residenze platform zamoskv")

set -e

BACKUP_DIR="${BACKUP_DIR:-/backups}"
KEEP_DAYS="${KEEP_DAYS:-7}"
DB_HOST="${DB_HOST:-db}"
DB_USER="${DB_USER:-residenze}"
# SEC [AUDIT #5]: legacy дефолт DB_NAME сохранён для обратной совместимости,
# но если BACKUP_DATABASES задан, он имеет приоритет.
BACKUP_DATABASES="${BACKUP_DATABASES:-${DB_NAME:-residenze} platform zamoskv}"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"

# SEC [AUDIT #5]: per-database цикл — упадёт на первой ошибке (set -e), но
# каждая БД бекапится в отдельный файл чтобы восстановление было гранулярным.
FAILURES=0
for DB in $BACKUP_DATABASES; do
  FNAME="${BACKUP_DIR}/${DB}_${DATE}.sql.gz"
  echo "[backup] $(date '+%Y-%m-%d %H:%M:%S') — starting backup of ${DB}@${DB_HOST}..."

  # Отдельный if/else на БД, чтобы продолжить цикл при сбое одной
  # (иначе set -e убил бы скрипт и оставил частичные данные за день).
  if pg_dump -h "$DB_HOST" -U "$DB_USER" "$DB" 2>/tmp/pg_dump.err | gzip > "$FNAME"; then
    SIZE=$(du -sh "$FNAME" 2>/dev/null | cut -f1 || echo "?")
    echo "[backup] saved: $FNAME ($SIZE)"
    # "latest" симлинк — runbook'и rollback-сценариев ссылаются на *_latest.dump.
    ln -sf "${DB}_${DATE}.sql.gz" "${BACKUP_DIR}/${DB}_latest.sql.gz"
  else
    echo "[backup] ERROR: pg_dump ${DB} failed! $(cat /tmp/pg_dump.err)" >&2
    rm -f "$FNAME"
    FAILURES=$((FAILURES + 1))
  fi
done

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
