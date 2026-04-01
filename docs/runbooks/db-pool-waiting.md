# Runbook: DB pool waiting

## Trigger
`RezidenceDbPoolWaiting`

## Что значит
Очередь ожидания в пуле подключений к БД держится высокой, растут латентность и таймауты API.

## Проверки
1. Проверить текущие значения `dbPool.total`, `dbPool.idle`, `dbPool.waiting`.
2. Проверить долгие SQL (pg_stat_activity/pg_stat_statements).
3. Проверить лимиты пула в приложении и лимиты на стороне PostgreSQL.
4. Проверить, нет ли всплеска трафика/фоновых джоб.

## Смягчение
- Увеличить pool size (осторожно, в рамках лимитов БД).
- Убрать/оптимизировать долгие запросы.
- Временно снизить нагрузку (rate limit, отключение non-critical задач).

## Escalation
- Primary owner: `team-backend`
- Secondary: `team-platform`
