---
name: "source-command-backend-coverage-critical"
description: "Прогнать backend coverage-gate для критичных auth/request путей."
---

# source-command-backend-coverage-critical

Use this skill when the user asks to run the migrated source command `backend-coverage-critical`.

## Command Template

Запусти coverage-gate, который защищён CI (см. `backend/jest.coverage.critical.config.js`).

1. Выполни в `backend/`:
   ```
   npm run test:coverage:critical
   ```
2. Если coverage падает ниже threshold — покажи, какие именно файлы и строки не покрыты (из `coverage/lcov-report/*` или из stdout jest-coverage reporter).
3. Если всё зелёное — выведи краткий результат: branch/line/function coverage % для каждого из критичных модулей.
4. Не коммить ничего автоматически — только отчёт.

Это не замена `npm run test:ci`; это дополнительная проверка покрытия критичных путей.
