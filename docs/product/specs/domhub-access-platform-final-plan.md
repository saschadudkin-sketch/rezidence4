# DomHub — Итоговая спецификация и план разработки платформы управления доступом

Дата: 2026-04-21  
Статус: рабочий master-plan  
Назначение: единый документ для развития DomHub как платформы управления доступом для ЖК, клубных домов и коттеджных посёлков.

---

## 1. Цель документа

Этот документ фиксирует:
- каким должен быть DomHub как конечный access-control продукт;
- какие функции обязательны для выхода на рынок;
- какие сущности, роли и процессы нужны;
- в каком порядке разрабатывать продукт;
- что входит в `MVP`, `Strong v2` и `Market-leading`;
- по каким критериям принимать каждый этап.

Документ дополняет общую платформенную стратегию, но фокусируется именно на доступе, охране, пропусках, подрядчиках, транспорте, инцидентах и интеграциях со СКУД.

---

## 2. Видение продукта

**DomHub Access Platform** — это не просто система пропусков и не просто resident app.

Это платформа, которая управляет полным жизненным циклом доступа на закрытом жилом объекте:
- кто получает доступ;
- на каком основании;
- в какие зоны;
- на какой срок;
- кто согласовал;
- кто фактически пропустил;
- какие события произошли на точках доступа;
- какие инциденты возникли;
- как это контролируется на уровне объекта и управляющей компании.

Итоговая формула продукта:

`access platform = passes + zones + policies + guard operations + contractor/service access + vehicle access + audit + integrations`

---

## 3. Для кого строится продукт

### 3.1 Основные клиенты

- управляющие компании;
- девелоперы;
- операторы жилых комплексов;
- управляющие премиальными и business-class объектами;
- управляющие коттеджными посёлками и закрытыми территориями.

### 3.2 Основные пользователи

- resident;
- security;
- concierge;
- technician;
- contractor;
- property_admin;
- management_company_admin;
- platform_admin.

### 3.3 Где продукт особенно силён

- закрытые ЖК;
- клубные дома;
- объекты с охраной и КПП;
- объекты с подрядчиками и сервисным персоналом;
- посёлки с шлагбаумами и пропускным режимом;
- портфель УК с несколькими объектами.

---

## 4. Ключевое позиционирование

DomHub конкурирует не как "ещё одна СКУД" и не как "ещё одно приложение жителя".

Правильное позиционирование:

> **DomHub — платформа оркестрации доступа и операционного контроля для жилых объектов.**

Что это означает:
- доступ связывается с resident experience;
- доступ связывается с работой охраны;
- доступ связывается с заявками и подрядчиками;
- доступ связывается с инцидентами и аудитом;
- доступ связывается с управлением несколькими объектами.

---

## 5. Что обязательно должно быть в конечном продукте

### 5.1 Доменные сущности

#### Структура объекта

- `management_company`
- `property`
- `building`
- `entrance`
- `unit`

`unit` является универсальной адресуемой единицей: квартира, апартамент, таунхаус, дом, участок, коммерческое или служебное помещение. Для коттеджных посёлков `building` / `entrance` могут использоваться как внутренние v1-узлы совместимости, но UI обязан показывать property-type-aware labels: сектор/улица, дом/участок, КПП.

#### Доступ и участники

- `resident`
- `staff_user`
- `contractor_company`
- `contractor_user`
- `vehicle`
- `pass`
- `qr_pass`
- `access_request`
- `access_approval`
- `access_policy`
- `access_zone`
- `access_point`
- `visit_log`
- `access_incident`
- `access_override`

#### Контроль и интеграции

- `notification`
- `audit_log`
- `integration`
- `integration_event`
- `provider_config`

### 5.2 Основные типы доступа

В продукте должны быть first-class сценарии:
- постоянный доступ жителя;
- временный доступ гостя;
- доступ на автомобиль;
- въезд через КПП;
- доступ курьера;
- доступ подрядчика;
- доступ сервисного персонала;
- доступ бригады;
- доступ по расписанию;
- recurring access;
- emergency access / override.

### 5.3 Зональная модель

Должна существовать полноценная модель:
- `access_point` — конкретная точка доступа;
- `access_zone` — зона, куда можно дать доступ;
- `access_policy` — правило доступа.

Примеры точек и зон:
- КПП;
- шлагбаум;
- калитка;
- входная дверь / подъезд;
- паркинг;
- улица / сектор коттеджного посёлка;
- техническое помещение;
- общественная зона;
- сервисная зона.

### 5.4 Policy Engine

Платформа должна уметь отвечать на вопросы:
- кто имеет право прохода;
- куда именно;
- в какое время;
- на какой срок;
- каким методом доступа;
- на каком основании;
- кем был согласован доступ;
- кто может отозвать доступ.

### 5.5 Security / Guard Operations

У DomHub должен быть полноценный `security workspace`, а не просто экран сканирования.

Он должен включать:
- ожидаемых гостей;
- активные пропуска;
- поиск по ФИО, QR, авто, unit / адресу, подрядчику;
- последние события доступа;
- спорные проходы;
- blacklist hits;
- ручной admit / deny;
- emergency override;
- incident creation.

### 5.6 Contractor / Service Access

Подрядчики и техспециалисты должны быть встроены в access-domain:
- доступ к объекту;
- доступ к зоне;
- ограничение по времени;
- привязка к заявке;
- привязка к service window;
- доступ бригады;
- автоотзыв доступа после окончания работ.

### 5.7 Vehicle Access

Это обязательный блок для ЖК и посёлков.

Нужны:
- карточка авто;
- номер;
- тип транспорта;
- связь с resident/guest/contractor;
- whitelist / blacklist;
- период действия допуска;
- журнал въездов и выездов;
- поиск по номеру.

### 5.8 Incident Layer

Нужны access-инциденты:
- отказ во въезде;
- невалидный QR;
- проход по истёкшему доступу;
- попытка прохода вне временного окна;
- несанкционированная попытка;
- ручной override охраной;
- блокировка пользователя/авто;
- конфликт между DomHub и внешней СКУД.

### 5.9 Audit & Forensics

Платформа должна сохранять:
- кто создал доступ;
- кто согласовал;
- кто отозвал;
- кто изменил условия доступа;
- кто сделал ручной override;
- что пришло из внешней СКУД;
- кто фактически прошёл;
- полную ленту событий по объекту и человеку.

### 5.10 Integrations

В зрелой версии продукта обязательно нужны:
- интеграции со шлагбаумами;
- интеграции с воротами и домофонами;
- QR scan integration;
- журнал обмена с внешней СКУД;
- retry/error handling;
- mapping внутренних access policies на внешние системы.

---

## 6. Ролевая модель для access-platform

### 6.1 Resident

- создаёт гостевые и авто-пропуска;
- видит свои активные доступы;
- получает уведомления;
- может отозвать временный доступ, если политика это позволяет.

### 6.2 Security

- видит активные доступы;
- обрабатывает QR/поиск;
- фиксирует admit/deny;
- делает manual override при наличии прав;
- создаёт access incidents;
- работает с blacklist/watchlist.

### 6.3 Concierge

- помогает создавать и подтверждать доступы;
- маршрутизирует сервисные визиты;
- работает с resident support cases;
- взаимодействует с охраной.

### 6.4 Technician

- получает доступ к объекту и зонам по своим работам;
- может видеть связанные service-access сценарии;
- подтверждает факт выполнения работ.

### 6.5 Contractor

- видит только назначенные access/service задачи;
- получает только минимально необходимый доступ;
- не видит лишних resident data;
- не управляет глобальными настройками.

### 6.6 Property Admin

- управляет access policies объекта;
- видит все access events и incidents;
- назначает staff/contractor access;
- контролирует blacklist/override/exception cases;
- управляет контуром доступа в рамках объекта.

### 6.7 Management Company Admin

- видит несколько объектов;
- контролирует портфельный уровень access KPI;
- видит общие проблемы и инциденты;
- управляет шаблонами и стандартами доступа.

### 6.8 Platform Admin

- управляет всей платформой;
- контролирует platform-level configuration;
- не участвует в ежедневной охранной операционке клиента.

---

## 7. Продуктовые принципы

### 7.1 DomHub не должен быть только "системой QR"

Если продукт ограничится:
- гостевым QR;
- экраном сканирования;
- журналом проходов,

то это будет хороший модуль доступа, но не полноценная платформа.

### 7.2 Access = operations

Доступ должен быть связан с:
- заявками;
- подрядчиками;
- инцидентами;
- объектной структурой;
- охраной;
- правилами и политиками;
- аналитикой для УК.

### 7.3 Не конкурировать шириной экосистемы раньше времени

Нельзя до доказанного core уходить в:
- smart-home шоукейс ради шоукейса;
- lifestyle-сервисы;
- биллинг;
- бронирование;
- AI-модули.

Сначала нужен сильный access core.

---

## 8. Этапы разработки

## Stage 1 — Access MVP

### Цель

Сделать продаваемый продукт управления доступом для одного объекта.

### Scope

- multi-tenant foundation;
- property-type-aware address model;
- resident profile;
- guest pass;
- vehicle pass baseline;
- QR pass;
- public pass page;
- scan/admit/deny;
- visit logs;
- resident notifications;
- property admin baseline;
- security workspace baseline;
- audit baseline;
- onboarding baseline.

### Что считается результатом

- resident может оформить доступ;
- security может проверить и обработать доступ;
- property admin может контролировать основные события;
- объект может быть ЖК, club house или cottage community без schema fork;
- объект можно подключить по repeatable сценариям.

### Exit Criteria

- есть end-to-end flow для guest access;
- есть end-to-end flow для vehicle access baseline;
- security может обрабатывать поток доступа без внешних таблиц;
- журнал событий прозрачен;
- роли и permission model не дырявые.

---

## Stage 2 — Strong v2 Access Platform

### Цель

Превратить продукт из access MVP в сильную операционную access-platform.

### Scope

- access types expansion;
- contractor/service access;
- technician-related access;
- approval workflow;
- expanded security workspace;
- access incidents;
- blacklist/watchlist;
- access_point / access_zone;
- access policy baseline;
- richer vehicle model;
- management company baseline;
- object-level access analytics.

### Что считается результатом

- доступ управляется не только через QR, а через типы, зоны и правила;
- подрядчики и сервисные сценарии встроены;
- у security и property admin есть полноценный operational console.

### Exit Criteria

- есть policy-controlled access;
- contractor access работает в ограниченном контуре;
- vehicle access покрывает реальный сценарий ЖК/посёлка;
- incident workflow существует;
- access analytics доступны объекту.

---

## Stage 3 — Market-Leading Access Platform

### Цель

Сделать DomHub конкурентной зрелой платформой для доступа и access operations.

### Scope

- full policy engine;
- SKUD integrations baseline;
- gate/barrier integration;
- access integration logs;
- conflict resolution between DomHub and external systems;
- advanced audit trail;
- management company portfolio analytics;
- contractor and security performance analytics;
- automation rules;
- emergency workflows;
- enterprise-grade export/reporting.

### Что считается результатом

- DomHub может управлять доступом как цифровой слой над объектом и внешними access systems;
- УК получает портфельную прозрачность;
- продукт готов к более сильной конкуренции на рынке.

### Exit Criteria

- работают интеграции хотя бы с базовым классом access systems;
- есть управление ошибками и retry;
- audit trail пригоден для разбора конфликтов и спорных кейсов;
- management company видит cross-property KPI.

---

## 9. Что входит в V1 / V2 / V3

### V1 — продаваемое ядро

- resident access;
- guest passes;
- QR passes;
- vehicle baseline;
- visit logs;
- resident notifications;
- security screen baseline;
- property admin baseline;
- audit baseline;
- onboarding.

### V2 — зрелый access core

- all major access types;
- access zones and points;
- approval workflows;
- contractor/service access;
- access incidents;
- blacklist/watchlist;
- vehicle model maturity;
- management company baseline;
- analytics baseline.

### V3 — зрелая конкурентная платформа

- integrations with real access systems;
- policy engine maturity;
- automation;
- advanced analytics;
- enterprise reporting;
- portfolio control at UK level.

---

## 10. Приоритеты по реализации

### P0 — обязательно

- guest access;
- QR flow;
- vehicle baseline;
- security workspace baseline;
- property admin baseline;
- visit logs;
- role/scope enforcement;
- audit trail baseline.

### P1 — критично после запуска ядра

- contractor access;
- service access;
- approval workflow;
- access incidents;
- access zones;
- access points;
- policy baseline;
- management company analytics baseline.

### P2 — после подтверждения ценности

- SKUD integrations;
- ANPR;
- richer automation;
- anomaly detection;
- advanced cross-property analytics;
- enterprise exports.

---

## 11. Инженерные потоки работ

### 11.1 Database

Нужно реализовать:
- access entities;
- vehicle model;
- access_point / access_zone / access_policy;
- access_incidents;
- audit and integration logs;
- role/scope mappings.

### 11.2 Backend/API

Нужно реализовать:
- access lifecycle APIs;
- pass creation and revocation;
- policy evaluation;
- security operations endpoints;
- incident endpoints;
- analytics endpoints;
- integrations and sync endpoints.

### 11.3 Frontend/UI

Нужно реализовать:
- resident access flows;
- guard console;
- property admin access console;
- contractor/service access flows;
- management company dashboards.

### 11.4 Tests

Нужно покрыть:
- role/scope security;
- end-to-end access flows;
- vehicle access;
- contractor access;
- conflict and incident cases;
- policy evaluation;
- audit correctness.

### 11.5 Docs

Нужно поддерживать:
- access product spec;
- guard/security guide;
- property admin guide;
- contractor guide;
- onboarding docs;
- incident and access-control policies.

---

## 12. Метрики успеха

### 12.1 Продуктовые

- число выданных доступов;
- доля успешно обработанных access flows;
- среднее время обработки пропуска охраной;
- доля resident self-service access without manual support.

### 12.2 Операционные

- число отказов;
- число manual overrides;
- число access incidents;
- среднее время решения инцидента;
- contractor access completion quality.

### 12.3 Управленческие

- access volume by property;
- access incidents by property;
- guard load;
- contractor/service access volume;
- vehicle traffic dynamics;
- problem hotspots across portfolio.

### 12.4 Технические

- integration success rate;
- sync failure rate;
- audit completeness;
- tenant isolation incidents;
- notification delivery rate for access-critical events.

---

## 13. Главные риски

### Продуктовые

- продукт останется "сервисом QR-пропусков";
- не будет полноценного guard console;
- vehicle access окажется вторичным, хотя для рынка он критичен;
- contractor/service layer будет недоразвит.

### Архитектурные

- zones/policies появятся слишком поздно;
- permission model станет хаотичной;
- integrations будут построены до формализации внутреннего access model;
- audit trail не будет достаточно детальным.

### Коммерческие

- попытка конкурировать с крупными экосистемами по ширине функций, а не по силе operational core;
- распыление на lifestyle-модули раньше времени.

---

## 14. Рекомендуемый порядок разработки

Правильная последовательность:

1. Сначала зафиксировать property/territory model: `property_type`, labels, `unit` as addressable dwelling/asset.
2. Затем собрать `Access MVP` для одного объекта.
3. Затем усилить guard, vehicle, contractor and incident layers.
4. Затем добавить zones, policies и company-level visibility.
5. После этого строить integrations со СКУД.
6. И только потом добавлять сложную automation и advanced analytics.

Неправильная последовательность:

1. Сначала интеграции и hardware-first roadmap.  
2. Потом попытка придумать внутреннюю модель доступа.  
3. Потом заплатки на roles, audit и incidents.

---

## 15. Итоговое определение готового продукта

DomHub как зрелая access-control платформа считается сформированной, когда:

- resident может сам оформить доступ в большинстве типовых сценариев;
- security работает в полноценном guard console;
- vehicle access и contractor access покрывают реальные кейсы объекта;
- property_admin управляет access policies и incidents;
- УК видит картину по нескольким объектам;
- audit trail пригоден для разбора спорных ситуаций;
- продукт может быть подключён к внешним access systems;
- новый объект можно запустить без ручного хаоса.

Итоговая формула:

> DomHub — это платформа, которая управляет не только пропуском, но и всем операционным контуром доступа на жилом объекте.
