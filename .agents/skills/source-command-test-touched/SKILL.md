---
name: "source-command-test-touched"
description: "Прогнать jest только для файлов, изменённых с последнего коммита (включая unstaged и staged)."
---

# source-command-test-touched

Use this skill when the user asks to run the migrated source command `test-touched`.

## Command Template

Прогоняй тесты только для тех backend-файлов, которые я сейчас трогаю.

1. Получи список изменённых файлов в backend:
   `git diff --name-only HEAD -- backend/src/`
   и
   `git diff --cached --name-only -- backend/src/`
   Объедини без дубликатов.

2. Для каждого изменённого файла определи соответствующий тест:
   - `backend/src/v1/services/<name>.js` → `backend/src/__tests__/v1<Name>.test.js` (CamelCase).
   - `backend/src/<name>.js` → `backend/src/__tests__/<name>.test.js`.
   - Если тестовый файл сам изменён — просто включи его.
   - Если соответствующий тест не существует — предупреди и не включай.

3. Запусти:
   ```
   cd backend && npx jest <list-of-test-paths> --runInBand
   ```
   (используй `--runInBand` для стабильности на Windows).

4. Если тестовых файлов > 10 — спроси подтверждение перед запуском (может быть долго).

5. Если тестовых файлов 0 — скажи «ничего не изменилось в `backend/src/` с тестами» и завершись.

6. По окончании — краткое резюме: X passed, Y failed, какие именно упали.

Не предлагай git commit — только тесты.
