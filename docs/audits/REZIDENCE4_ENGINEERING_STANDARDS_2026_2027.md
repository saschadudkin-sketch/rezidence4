# Инженерные стандарты Rezidence4 на 2026–2027 годы

**Статус:** целевой стандарт для разработки; версии зависимостей нельзя считать установленными, пока их не закрепили в manifests/lockfiles и не подтвердили CI.  
**Дата проверки ориентиров:** 28 октября 2026.

## Принцип

Rezidence4 должен быть современным не за счёт количества библиотек, а благодаря понятной архитектуре, воспроизводимым сборкам, сильной типизации, автоматическим тестам, безопасности по умолчанию и измеримой производительности. Выбираем стабильные версии, которые подходят всему стеку; новые релизы сначала проходят compatibility spike и CI, затем становятся обязательными.

## 1. Целевая технологическая база

| Область | Цель | Правило принятия |
|---|---|---|
| Backend runtime | Node.js 24 LTS как консервативная базовая линия; проверять Node.js 26 в CI и переводить production после подтверждения статуса LTS и совместимости всех зависимостей | Версии закреплены в `.nvmrc`/toolchain config, Docker и CI; без плавающих `latest` |
| Backend architecture | TypeScript, модульный монолит, версионированный REST API, OpenAPI | Не дробить на микросервисы без доказанной необходимости |
| Backend framework | Сохранить Express, если аудит и тесты подтверждают его пригодность; обновлять до поддерживаемой версии, а не переписывать ради тренда | Решение о замене — отдельный ADR с затратами, рисками и измеримой пользой |
| Web | React 19.3+, TypeScript strict, Vite 8.x после проверки плагинов и CI | Устранить конфликт версий React между root/tooling и frontend app; не обновлять major без тестов |
| Mobile | Expo SDK 58 / React Native 0.88 как кандидат на целевую линию | SDK 58 стабилен с 15 октября 2026; до фиксации проверить все Expo modules, EAS/dev builds, Android и iOS. Не использовать beta/RC в production |
| Database | PostgreSQL 18 как кандидат после проверки драйверов, расширений и миграций; Redis — только для задач, которым он действительно нужен | Версия сервера, локального Compose и CI должна совпадать |
| API contracts | OpenAPI как source of truth; генерируемые TypeScript-типы и schema validation на границе | Не поддерживать вручную расходящиеся DTO для web и mobile |
| Package management | Сохранить текущий npm workflow на этапе baseline; затем отдельно принять решение о едином workspace/package manager | Не мигрировать npm → pnpm одновременно с backend refactor; все приложения имеют lockfile |
| Observability | Структурированные JSON-логи, correlation/request ID, метрики, трассировка через OpenTelemetry там, где есть реальная ценность | Не писать токены, OTP, QR secrets и лишние персональные данные |
| Security | OWASP ASVS 5.0.0 как проверяемый ориентир; SAST, dependency audit, secret scanning, SBOM и threat model | У каждого критического контроля есть автоматический тест или проверяемая процедура |

### Источники официальных версий

- Node.js release schedule: https://github.com/nodejs/Release
- Expo SDK 58 release notes: https://expo.dev/changelog/sdk-58
- React versions: https://react.dev/versions
- Vite supported releases: https://vite.dev/releases
- OWASP ASVS: https://owasp.org/www-project-application-security-verification-standard/

На 28 октября 2026 Node.js 26 находится в переходной точке релизного расписания; прежде чем объявлять его production baseline, подтвердить официальный статус и поддержку зависимостей. React 19.3 и Vite 8.x — актуальные ориентиры, но точные patch-версии должны быть закреплены lockfile и проверены CI.

## 2. Архитектура кода

- **Модульный монолит:** домены identity/sessions, tenants/properties, residents/units, passes/visits, guard verification, audit, notifications и integrations имеют явные границы.
- **Слои:** transport/controllers → application/use cases → domain rules → repositories/adapters. Не создавать слои только ради количества файлов; каждый слой должен защищать понятную границу.
- **Зависимости направлены внутрь:** доменная логика не зависит от Express, React, PostgreSQL или провайдера SMS.
- **Типизация:** TypeScript strict; запрет неограниченного `any`; проверка внешних данных runtime-схемами; единые error codes и API DTO.
- **Явные ошибки:** typed/domain errors переводятся в стабильные HTTP-коды на границе API; stack traces и внутренние детали не отправляются клиенту.
- **Конфигурация:** валидируется при старте; некорректная production-конфигурация останавливает процесс с безопасным сообщением.
- **Рефакторинг:** не менять форматирование, архитектуру и бизнес-правила одним гигантским PR. Каждая смена поведения сопровождается тестами.

## 3. Стандарт качества каждого PR

Обязательные проверки после того, как CI baseline приведён в рабочее состояние:

1. Format/lint.
2. Typecheck для backend, web и mobile.
3. Unit tests для доменной логики и валидации.
4. Integration tests с тестовой PostgreSQL/Redis там, где используются эти сервисы.
5. Contract tests на основе OpenAPI.
6. E2E для критических сценариев жильца и охраны.
7. Dependency/security scan и secret scan.
8. Production build для каждого приложения.
9. Миграции на пустой базе; повторный запуск проверяется там, где миграция заявлена как безопасно повторяемая.
10. Отчёт CI должен показывать реальный результат; отсутствие job не трактуется как успех.

Покрытие строк не является единственным критерием. Критические доменные правила и проверки прав должны иметь позитивные и негативные тесты. Порог покрытия задавать после baseline, не подменяя им качество тестов.

## 4. Безопасность как часть архитектуры

- Tenant context обязателен на каждом tenant-scoped запросе; отсутствие контекста означает отказ, а не fallback к общей базе.
- Авторизация выполняется на сервере для каждого ресурса и действия; скрытие кнопки на frontend не является защитой.
- Browser sessions: HttpOnly/Secure/SameSite cookies и CSRF-контроль в соответствии с текущим web-контрактом.
- Native sessions: отдельный контракт, короткоживущий access token, rotation/revocation refresh token, secure storage ОС; не хранить секреты в AsyncStorage.
- QR — случайный непрозрачный идентификатор, а не персональные данные и не самостоятельное разрешение на вход. Сервер проверяет статус, время, объект, точку, отзыв и политику повторного предъявления.
- Неуспешная или недоступная серверная проверка не превращается в разрешение прохода.
- Секреты поставляются через environment/secret manager, не коммитятся в Git; production не принимает stub SMS/provider режимы.
- Использовать OWASP ASVS 5.0.0 как checklist и документировать исключения.

## 5. Производительность и надёжность

- Установить budget для основных экранов и API после получения baseline: p95 latency, error rate, bundle size, cold start и время загрузки главного экрана.
- Измерять прежде, чем оптимизировать; не добавлять кеширование и очереди «на всякий случай».
- PostgreSQL: индексы обосновывать запросами/EXPLAIN; транзакции и уникальные ограничения для инвариантов; connection budget для tenant pools.
- Redis не является источником истины для статусов пропусков и разрешений.
- Таймауты, лимиты запросов, ограничение размера payload, безопасные retries и idempotency для операций, где повторы создают дубликаты.
- Backup/restore проверяется упражнением восстановления, а не только наличием backup-файла.
- Добавить health/readiness checks и алерты на ошибки, недоступность зависимостей, исчерпание соединений и истечение TLS.

## 6. Современный developer experience

- Одна проверенная инструкция запуска на чистой машине.
- Synthetic seed и предсказуемые test fixtures; никакой зависимости от реальных телефонов или production-секретов.
- PR template: цель, риск, тесты, миграции, screenshots/recording для UI, rollback/forward-fix plan.
- ADR для архитектурных решений с долгим сроком жизни.
- Автоматическое обновление зависимостей в отдельном PR с тестами; security fixes приоритизируются.
- Code owners и review для auth, tenant isolation, migrations, access decision и CI/release workflows.
- Минимум скрытых магических fallback-ов; явные контракты и понятные имена важнее «умного» кода.

## 7. Этапы внедрения стандарта

### Gate A — Baseline
- [ ] Инвентаризировать runtime, manifests, lockfiles, workflows и миграции.
- [ ] Получить воспроизводимые результаты backend/web tests и build.
- [ ] Устранить несоответствия README, Compose и env examples.
- [ ] Зафиксировать текущие версии и список блокеров.

### Gate B — Toolchain
- [ ] Утвердить Node baseline и совместимость Node 26.
- [ ] Выбрать согласованные React/Vite версии и привести manifests в порядок.
- [ ] Проверить Expo SDK 58 на совместимость native packages; собрать Android/iOS development builds.
- [ ] Выбрать PostgreSQL target после миграционного smoke test.
- [ ] Закрепить lockfiles и версии в CI/Docker.

### Gate C — Quality and security
- [ ] TypeScript strict для всех приложений поэтапно.
- [ ] OpenAPI contract checks и runtime validation.
- [ ] Tenant/role/QR negative tests.
- [ ] Security scans и ASVS checklist.
- [ ] Structured logs, request IDs и базовые метрики.

### Gate D — Product MVP
- [ ] Сквозной сценарий пропуска проходит на web.
- [ ] Resident flows работают на Android и iOS.
- [ ] Guard interface остаётся mobile-first и server-authoritative.
- [ ] Критические тесты и сборки зелёные.

### Gate E — Release readiness
- [ ] Backup restore, runbooks, monitoring, staging acceptance.
- [ ] Проверка требований к персональным данным и срокам хранения до загрузки настоящих данных.
- [ ] Отдельное go/no-go решение перед production.

## 8. Запрещённые анти-паттерны

- Переписывание работающего модуля только потому, что вышел новый framework.
- Плавающие версии `latest` в production.
- Микросервисы без доказанной потребности.
- Дублирование бизнес-правил в web/mobile/backend.
- Tenant fallback к общей базе.
- «Разрешить проход» при timeout/offline/unknown.
- Хранение native secrets в обычном persistent storage.
- Тесты, зависящие от реальных данных или внешнего SMS-провайдера.
- Считать созданный workflow доказательством прохождения CI.
- Обновлять framework, package manager, структуру проекта и бизнес-логику одним PR.

## Definition of done

Код можно считать готовым, когда он типизирован, протестирован, проверяет права на сервере, имеет согласованный контракт, воспроизводимо собирается и документирует свои ограничения. «Передовой» здесь означает поддерживаемый и измеримо качественный, а не просто самый новый номер версии.
