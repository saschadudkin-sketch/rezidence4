# Runbook: Legacy fallback used

## Trigger
`RezidenceLegacyFallbackUsed`

## Что значит
Сработал legacy fallback путь. Обычно это сигнал о деградации основного пути или неполной миграции.

## Проверки
1. Найти лог-события, где инкрементируется `rezidence_legacy_fallback_total`.
2. Определить домен fallback (auth, realtime, storage).
3. Проверить доступность upstream зависимостей.
4. Проверить, не включены ли временные feature flags после инцидента.

## Смягчение
- Устранить причину отказа primary-path.
- Если fallback нежелателен, отключить проблемный endpoint/фичу до фикса.
- Создать задачу на удаление legacy-ветки, если миграция уже завершена.

## Escalation
- Primary owner: `team-backend`
