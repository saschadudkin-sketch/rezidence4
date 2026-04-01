# Runbook: Refresh fail spike

## Trigger
`RezidenceRefreshFailSpike`

## Что значит
Резко выросло число ошибок refresh token. Пользователи могут массово разлогиниваться.

## Проверки
1. Проверить статус `/api/health` и `/api/health/detailed`.
2. Проверить ошибки в backend логах по `/api/auth/refresh`.
3. Проверить срок жизни и подпись JWT (`JWT_SECRET`, ротации ключей).
4. Проверить Redis/DB доступность, если refresh зависит от revoke/сессий.

## Смягчение
- Временно увеличить ретраи на клиенте.
- Откатить последний релиз auth-компонентов.
- При необходимости перевести трафик на стабильный инстанс.

## Escalation
- Primary owner: `team-platform`
- Secondary: `team-backend`
