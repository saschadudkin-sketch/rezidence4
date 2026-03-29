#!/bin/bash
# backup.sh — резервное копирование PostgreSQL
# Добавьте в cron: 0 3 * * * /path/to/backup.sh
#
# Использование:
#   ./backup.sh                      — создаёт бэкап
#   ./backup.sh restore 20240115     — восстанавливает из бэкапа за 15 янв 2024

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/residenze}"
DB_CONTAINER="${DB_CONTAINER:-residenze_patched-db-1}"
DB_USER="${DB_USER:-residenze}"
DB_NAME="${DB_NAME:-residenze}"
KEEP_DAYS="${KEEP_DAYS:-7}"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/db_${DATE}.sql.gz"

mkdir -p "$BACKUP_DIR"

case "${1:-backup}" in
  backup)
    echo "[backup] Starting database backup..."
    docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" "$DB_NAME" \
      | gzip > "$BACKUP_FILE"
    echo "[backup] Saved to: $BACKUP_FILE ($(du -sh "$BACKUP_FILE" | cut -f1))"

    # Ротация: удаляем бэкапы старше KEEP_DAYS дней
    find "$BACKUP_DIR" -name "db_*.sql.gz" -mtime "+${KEEP_DAYS}" -delete
    REMAINING=$(find "$BACKUP_DIR" -name "db_*.sql.gz" | wc -l)
    echo "[backup] Rotation done, ${REMAINING} backups kept (last ${KEEP_DAYS} days)"
    ;;

  restore)
    TARGET_DATE="${2:-}"
    if [ -z "$TARGET_DATE" ]; then
      echo "Usage: $0 restore YYYYMMDD"
      echo "Available backups:"
      ls -1 "$BACKUP_DIR"/db_*.sql.gz 2>/dev/null || echo "  (none)"
      exit 1
    fi
    RESTORE_FILE=$(ls "${BACKUP_DIR}"/db_"${TARGET_DATE}"*.sql.gz 2>/dev/null | head -1)
    if [ -z "$RESTORE_FILE" ]; then
      echo "[restore] ERROR: No backup found for date ${TARGET_DATE}"
      exit 1
    fi
    echo "[restore] Restoring from: $RESTORE_FILE"
    echo "[restore] WARNING: This will overwrite the current database!"
    read -p "Continue? (yes/no): " confirm
    if [ "$confirm" != "yes" ]; then echo "Aborted."; exit 0; fi

    gunzip -c "$RESTORE_FILE" \
      | docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" "$DB_NAME"
    echo "[restore] Done."
    ;;

  list)
    echo "[list] Available backups in ${BACKUP_DIR}:"
    ls -lh "$BACKUP_DIR"/db_*.sql.gz 2>/dev/null || echo "  (none)"
    ;;

  *)
    echo "Usage: $0 {backup|restore YYYYMMDD|list}"
    exit 1
    ;;
esac
