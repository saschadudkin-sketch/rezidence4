# Phase 1 UX DoD Checklist (Login + State Pattern)

Дата: 2026-04-02

## Цель
Сделать закрытие Phase 1 измеримым: не только «внесли правки в UI», но и зафиксировали обязательные проверки, артефакты и критерии приемки.

## Обязательные CI проверки
1. `frontend-test` job должен проходить:
   - `npm test -- --watchAll=false`
   - `npm run test:ux-critical:report`
   - `npm run build`
2. `login-e2e-smoke` job должен проходить:
   - `npm run test:e2e:preflight`
   - `npm run test:e2e -- e2e/login-flow.spec.js --project=chromium`
3. В каждом прогоне `frontend-test` публикуется артефакт:
   - `ux-critical-vitest-report` (`artifacts/ux-critical-vitest.json`)

## UX-critical suite (минимальный охват)
- `src/views/Login.test.js`
- `src/views/Dashboard.smoke.test.js`
- `src/views/VisitLogView.test.js`
- `src/views/ResidentView.test.js`
- `src/views/AdminView.test.js`
- `src/views/SecurityConciergeViews.test.js`
- `src/views/BlacklistView.test.js`
- `src/perms/PermsList.smoke.test.js`

## Phase 1 DoD
Phase 1 считается закрытой только если одновременно выполнены условия:
1. Все тесты из UX-critical suite зелёные.
2. Артефакт `ux-critical-vitest.json` приложен в CI.
3. Login flow smoke (`e2e/login-flow.spec.js`) проходит в CI-окружении с установленными browser/system deps.
4. Mobile/desktop badge parity и StateBlock rollout не имеют открытых P1 регрессий по QA чеклисту.

## Локальная проверка перед PR
```bash
npm --prefix frontend run test:ux-critical
npm --prefix frontend run build
npm run test:e2e:preflight
npm run test:e2e -- --list
```
