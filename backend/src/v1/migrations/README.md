# platform-v1 migrations — policy + conventions

Каждый файл здесь — module экспортирующий `{ id, up(client) }`. Все миграции запускаются `db.migrate()` (`backend/src/db.js`) в array order, после legacy `MIGRATIONS` из `dbMigrations.js`.

## Forward-only policy

**Down() rollbacks намеренно не реализованы.** Это не недосмотр — это обоснованное архитектурное решение.

### Почему не делаем `down()`

1. **Потеря данных при rollback неизбежна.** `down()` обычно удаляет таблицы/колонки. На свежей БД это безопасно; в production — это catastrophic data loss. Идеализированная «down() обратимость» создаёт ложное чувство безопасности.

2. **Drift между up и down.** При наличии down() кто-то правит `up()`, забывает синхронизировать `down()`. Через 6 месяцев down() пытается дропнуть колонку которая в текущем `up()` уже не создаётся. Грозит cascading errors.

3. **Реальная стратегия rollback ≠ down().** Когда мы хотим «откатить» поведение, мы пишем **новую forward-fix миграцию** которая возвращает схему в нужное состояние с явной обработкой данных. Это идемпотентно, code-reviewable, и имеет audit trail в commit history.

4. **Industry pattern.** Stripe, Square, GitHub, Linear используют forward-only migrations. Документировано в их engineering blogs (см. e.g. Stripe «Online migrations at scale», Linear «How we built our database migration system»).

### Что делать вместо down()

| Сценарий | Действие |
|----------|----------|
| Миграция упала на CI/dev | Пересоздать БД (`docker compose down -v && docker compose up -d`) |
| Миграция упала на staging | То же; staging не имеет ценных данных |
| Миграция упала на production | Не должно случаться — миграции тестируются на staging до prod. Если случилось — write **forward-fix migration** + restore from backup для пострадавших данных |
| Откат фичи (новой колонки) | Forward migration: оставить колонку, перестать писать в неё через app code; через несколько релизов — drop в отдельной миграции |
| Изменение типа колонки | Multi-step pattern: ADD new col → backfill → switch reads → switch writes → DROP old col (несколько миграций, каждая reversible-by-deployment) |

### Когда `down()` всё-таки уместен

Если на dev-машине идёт активная разработка одной миграции через много циклов «применил → ошибка → правлю → переприменяю», временный `down()` локально может ускорить cycle. Но **не commit'им** — нужный effect достигается `DROP TABLE IF EXISTS` в начале `up()` или пересозданием БД.

Любой merged migration file в этом каталоге — **append-only с момента релиза**. Если нужно изменить — следующая миграция фиксит, не правишь существующую.

## Naming + ID convention

Файлы: `NNN_short_name.js` с тремя цифрами (zero-padded) для сортировки. Идентификатор внутри: `v1_NNN_short_name`. Префикс `v1_` гарантирует отсутствие коллизий с legacy IDs в `schema_migrations`.

Текущий счётчик: см. `index.js` — последний элемент массива.

## Новая миграция — checklist

1. Создать файл `NNN_<feature>.js` (NNN = next number)
2. Экспорт: `module.exports = { id: 'v1_NNN_<feature>', async up(client) { ... } }`
3. Все `CREATE TABLE` — `IF NOT EXISTS` (идемпотентность при partial fail на CI)
4. Все `CREATE INDEX` — `CREATE INDEX IF NOT EXISTS` (то же)
5. `ALTER TABLE ... ADD COLUMN` — `IF NOT EXISTS`
6. **Не использовать non-IMMUTABLE функции в partial index predicates** (NOW(), CURRENT_TIMESTAMP, gen_random_uuid()). Ловится PG error 42P17. См. как мы наступили на эти грабли в migration 011 (`backend/src/dbMigrations.js`).
7. Добавить запись в `index.js` array (порядок определяет execution order)
8. Тест на новую таблицу/колонку в `__tests__/` если меняется shape того, что роутер возвращает

## Работа над `dbMigrations.js` (legacy)

Этот readme — про `backend/src/v1/migrations/`. Legacy-каталог `backend/src/dbMigrations.js` содержит миграции 001-013 от Phase-0..1. Те же правила применимы; legacy просто не разделён на отдельные файлы.

При новых фичах **не добавляем** в legacy — всегда новая v1-миграция.
