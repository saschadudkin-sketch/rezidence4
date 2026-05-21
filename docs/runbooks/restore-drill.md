# Restore Drill Runbook (DATA-1)

**BACKLOG:** `DATA-1` (P0 — обязательно до go-live Замоскворечья)
**Скрипты:** [`scripts/restore-drill-preflight.cjs`](../../scripts/restore-drill-preflight.cjs), [`scripts/restore-drill.cjs`](../../scripts/restore-drill.cjs), legacy shell drill [`scripts/restore-drill.sh`](../../scripts/restore-drill.sh)
**Связанный runbook:** [`go-live-zamoskv-runbook.md §6 Rollback`](../product/specs/platform-v1/go-live-zamoskv-runbook.md)
**Backup script:** [`backup.sh`](../../backup.sh) (расписание — `0 3 * * *` UTC внутри backup-контейнера)

---

## Зачем

Ежедневные `pg_dump` бэкапы пишутся в `./backups/` через busybox crond (см. `backup.sh`), но **никогда не проверялись на восстанавливаемость**. Backup без drill'a — не backup, а файл на диске. До go-live Замоскворечья — обязательное upcoming P0.

## Когда запускать

| Случай | Частота |
|---|---|
| **До go-live** (one-shot baseline) | один раз — установить RTO baseline |
| **Pre-prod CI** (на staging VPS) | еженедельно |
| **После изменений в backup.sh** | сразу после merge |
| **После апгрейда postgres** | в течение 24h |
| **На production** | **никогда** — drill потребляет ресурсы и параллельная нагрузка искажает latency сервиса. |

## Предусловия

1. Docker daemon доступен (`docker info` отвечает).
2. В `./backups/` есть `*_latest.sql.gz` для всех БД из `BACKUP_DATABASES`. Если нет — запустить вручную:
   ```bash
   docker compose run --rm --entrypoint sh backup -c "tr -d '\r' < /backup.sh > /tmp/backup.sh && sh /tmp/backup.sh"
   ls -la backups/*_latest.sql.gz
   ```
3. ~500 MB свободного диска (pristine postgres data + restored БД).

## Запуск

### Preflight

```bash
npm run tenant:restore-drill:preflight
```

Проверяет до запуска pristine Postgres:
- наличие `residenze_latest.sql.gz`, `platform_latest.sql.gz`, `zamoskv_latest.sql.gz`;
- что файлы не пустые, имеют gzip header и свежее `48h`;
- что Docker daemon доступен.

Custom limits:

```bash
BACKUP_DIR=/tmp/staging-backups \
npm run tenant:restore-drill:preflight -- --max-age-hours 24 --min-bytes 1024
```

В CI без реальных backup'ов разрешён только synthetic gate с
`--skip-docker`; реальный staging/prod-candidate drill должен запускать полный
restore.

### Базовый (defaults)

```bash
npm run tenant:restore-drill
```

Команда сначала выполняет preflight, затем проверяет три БД (`residenze`,
`platform`, `zamoskv`), последние snapshots, на pristine `postgres:16-alpine`,
port `15432`.

### Backup refresh + evidence helper

Для staging/prod-candidate release packet можно одним helper'ом обновить
backup, прогнать preflight/drill и записать runtime artifacts в
`artifacts/release-gates/`:

```bash
npm run tenant:backup-restore:evidence -- \
  --write \
  --refresh \
  --preflight \
  --drill \
  --environment staging \
  --backup-reference <backup-set-uri-or-id> \
  --restore-target <restore-drill-target>
```

Helper пишет:

- `artifacts/release-gates/tenant-restore-drill-preflight.json`
- `artifacts/release-gates/tenant-restore-drill.json`

Если backup refresh или preflight падает, helper останавливается до drill. Для
диагностики failing evidence можно добавить `--write-failed`, но такой artifact
должен оставлять release gate красным.

Полный release packet можно запускать через `npm run pilot:release-packet`,
который вызовет этот helper как один из шагов перед финальным
`russia:readiness -- --require-live`.

### Customisation

```bash
# Только одна БД
BACKUP_DATABASES=zamoskv bash scripts/restore-drill.sh

# Другая директория с backup'ами (например, копия с staging VPS)
BACKUP_DIR=/tmp/staging-backup bash scripts/restore-drill.sh

# Специфичная версия postgres (для проверки upgrade-compat)
PG_IMAGE=postgres:17-alpine bash scripts/restore-drill.sh
```

### Что проверяется

**Invariants после restore:**

| БД | Запрос | Минимум |
|---|---|---|
| `residenze` | `SELECT COUNT(*) FROM users` | ≥ 1 |
| `platform` | `SELECT COUNT(*) FROM properties` | ≥ 1 |
| `zamoskv` | `SELECT COUNT(*) FROM schema_migrations WHERE id LIKE 'v1_%'` | ≥ 25 (все v1_001..v1_025) |

Дополнительные кастомные invariants можно добавить в `scripts/restore-drill.sh` функцией `check_count`.

## Что считается успехом

- Exit code 0
- Все три БД восстанавливаются без `ON_ERROR_STOP` errors
- Invariants пройдены
- Total wall-clock RTO **< 5 минут** для baseline размеров (Замоскворечье на старте — единицы MB, должно быть < 30s)

## Что делать при сбое

| Exit | Что произошло | Действие |
|---|---|---|
| 1 | Backup файлы отсутствуют | Запустить `docker compose run --rm --entrypoint sh backup -c "tr -d '\r' < /backup.sh > /tmp/backup.sh && sh /tmp/backup.sh"`; проверить cron в backup-контейнере |
| 2 | `pg_restore` failure | Прочитать `/tmp/restore_<db>.log`; чаще всего — несовместимость version postgres (drill image vs prod) |
| 3 | Invariant check failed | Backup есть, restore прошёл, но в БД пусто/мало данных. **Срочно**: проверить prod backup-контейнер логи (`docker compose logs backup`) — возможно, уже неделю пишет пустые dump'ы |
| 4 | Docker недоступен | Запустить Docker Desktop (Windows/Mac) или `sudo systemctl start docker` (Linux) |

## Что записывать в operational journal

После каждого drill'а — одна строка:

```
2026-04-27 | local | residenze 12s, platform 8s, zamoskv 18s | total 38s | OK | invariant residenze.users=15
```

Эскалация:
- Total RTO > 60s → задумайся об оптимизации (PITR, parallel restore, размер dump'а)
- Total RTO > 5 min → P1 backlog item: восстановление за такое время неприемлемо для go-live SLA
- Любой failure (exit ≠ 0) → P0 incident: backup невалиден, до фикса prod-backup сломан

## Что НЕ делает этот drill (out of scope)

- **Point-in-Time Recovery (PITR)** — драйв на снапшот восстанавливает state на момент `pg_dump`. WAL-archiving не настроен (см. `BACKLOG.md DATA-4`).
- **Cross-version restore** — drill использует ту же мажорную версию postgres что и prod (16). Upgrade-drill (16 → 17) — отдельная процедура.
- **Off-site backup** — `./backups/` локальный disk. S3/Backblaze — `BACKLOG.md DATA-3`, отложено.
- **Application-level smoke** — drill восстанавливает schema + data, но не запускает backend против восстановленной БД. Для full smoke — runbook `go-live-zamoskv-runbook.md §4`.

## Связанное

- [`backup.sh`](../../backup.sh) — что бэкапим (per-database, gzip, 7-day retention)
- [`docker-compose.yml`](../../docker-compose.yml) — backup сервис, расписание `0 3 * * *` UTC
- [`go-live-zamoskv-runbook.md §6.4`](../product/specs/platform-v1/go-live-zamoskv-runbook.md) — реальный rollback с восстановлением одной БД
- BACKLOG.md `DATA-1..DATA-4` — все backup-related backlog items
