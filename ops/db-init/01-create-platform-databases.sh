#!/bin/bash
# Создаёт дополнительные базы данных для multi-tenant архитектуры.
#
# Запускается postgres docker-image автоматически при ПЕРВОМ старте
# контейнера (когда data dir пустой) — см. https://hub.docker.com/_/postgres
# раздел "Initialization scripts".  В prod это означает one-time setup
# при initial deployment; на CI — каждый run (т.к. db_data ephemeral).
#
# Если базы уже существуют (повторный init script run после restore из
# бэкапа) — psql падает с error, но скрипт игнорирует через `|| true`.
#
# - residenze: главная DB (single-tenant fallback) — создаётся через
#   POSTGRES_DB env var, здесь не нужна.
# - platform:  multi-tenant registry (PLATFORM_DB_URL).  Хранит таблицу
#   `properties` со всеми объектами и их per-property DSN.
# - zamoskv:   per-tenant DB для «Резиденций Замоскворечья» (первый
#   реальный объект).  Schema создаётся через property migrations.

set -u

psql -v ON_ERROR_STOP=0 -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<-EOSQL || true
  CREATE DATABASE platform;
EOSQL

psql -v ON_ERROR_STOP=0 -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<-EOSQL || true
  CREATE DATABASE zamoskv;
EOSQL

# Финальный verify — список БД для CI логов.  Если platform/zamoskv
# отсутствуют — psql вернёт пустой список и migrate.js упадёт явно.
psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\l" || true
