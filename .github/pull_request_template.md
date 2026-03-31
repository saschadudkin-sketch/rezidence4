## Scope
- What is changed in this PR (short list)?
- Which subsystem(s) are affected?

## Changes summary table
| Падавший файл/ошибка | Причина | Точное изменение | Подтверждающий запуск |
| --- | --- | --- | --- |
| `<file or error>` | `<root cause>` | `<exact fix>` | `` `<exact command + key output>` `` |

## Explicitly out of scope
- Infrastructure changes are intentionally excluded from this PR.
- Mass/refactoring-only changes are intentionally excluded from this PR.

## Migration impact
- Any runtime/config/data migration impact?
- If none, explicitly state: `No migration impact`.

## Test commands
- [ ] `cd backend && npm test`
- [ ] `cd frontend && npm test -- --watchAll=false`

## Risks (only actually touched areas)
- Mention only risks in the code actually changed in this PR.
- For this type of fix, focus on test mocks behavior and avoid listing production runtime behavior unless it was directly changed.
