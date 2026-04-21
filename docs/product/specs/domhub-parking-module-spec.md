# DomHub Parking Module Specification

Дата: 2026-04-22  
Статус: рабочая спецификация модуля  
Назначение: зафиксировать, каким должен быть parking module в DomHub, где проходят границы MVP и как модуль связывается с access-platform и operations layer.

---

## 1. Цель модуля

Parking module в DomHub нужен не как отдельный бизнес-продукт “умной парковки”, а как управляемый слой автомобильного доступа и парковочного администрирования для жилого объекта.

Модуль должен закрывать три главные задачи:

- управление автомобилями и авто-доступом;
- управление парковочными местами и их назначением;
- поддержку охраны и администрации в сценариях въезда, допуска, инцидентов и контроля.

Итоговая формула модуля:

`parking module = vehicles + parking spots + parking access + guard validation + admin visibility + parking events`

---

## 2. Как parking module встроен в DomHub

Parking module не существует отдельно от DomHub.

Он должен быть встроен в:

- `resident experience`
- `security workspace`
- `property admin dashboard`
- `access policies`
- `visit logs / incidents / audit`
- интеграции со СКУД и whitelist/ANPR-слоем в зрелой фазе

Parking не должен жить как отдельный “мини-сервис сбоку”.

---

## 3. Продуктовое позиционирование

Parking module в DomHub — это:

- не просто список автомобилей;
- не просто гостевой авто-пропуск;
- не полноценная heavy-duty система автоматизации паркинга с датчиками и билетной логикой;
- а управляемый модуль автомобильного доступа для ЖК и коттеджных посёлков.

Он особенно нужен для:

- premium и business-class ЖК;
- объектов с подземным паркингом;
- объектов с гостевой парковкой;
- закрытых посёлков с КПП и контролируемым въездом;
- объектов, где важен контроль resident/service/guest vehicle access.

---

## 4. Что уже есть как база

В текущем проекте уже существует vehicle/garage baseline:

- список автомобилей у пользователя;
- добавление и редактирование машины;
- связь машины с resident;
- поиск машины для охраны;
- `parkingSpot` на уровне resident data;
- начальная БД-подготовка под парковочные атрибуты.

Эта база полезна, но это ещё не полноценный parking module.

---

## 5. Что обязательно должно быть в parking module

### 5.1 Основные сущности

- `vehicle`
- `parking_zone`
- `parking_level`
- `parking_spot`
- `parking_assignment`
- `vehicle_access`
- `parking_event`
- `parking_incident`

### 5.2 Связи

- `vehicle -> resident`
- `vehicle -> contractor_user` при необходимости
- `parking_spot -> property`
- `parking_spot -> parking_zone`
- `parking_assignment -> parking_spot + unit/resident`
- `vehicle_access -> vehicle + property + time window`
- `parking_event -> vehicle + access point + direction`
- `parking_incident -> vehicle + property + event context`

### 5.3 Типы парковочных мест

- `resident`
- `guest`
- `service`
- `accessible`
- `temporary`
- `blocked`

### 5.4 Статусы места

- `free`
- `assigned`
- `reserved`
- `occupied`
- `blocked`
- `maintenance`

### 5.5 Типы parking events

- `entry_allowed`
- `entry_denied`
- `exit_recorded`
- `manual_override`
- `blacklist_hit`
- `expired_access_attempt`
- `unknown_vehicle_attempt`

---

## 6. Основные сценарии продукта

### 6.1 Resident

- добавить автомобиль;
- отредактировать автомобиль;
- удалить автомобиль;
- создать гостевой авто-пропуск;
- увидеть активный авто-доступ;
- увидеть своё закреплённое парковочное место, если модель объекта это поддерживает.

### 6.2 Security

- искать автомобиль по номеру;
- видеть:
  - кто владелец;
  - квартира;
  - есть ли активный допуск;
  - есть ли blacklist flag;
  - есть ли закреплённое место;
- разрешить въезд;
- отклонить въезд;
- сделать manual override;
- создать parking incident.

### 6.3 Property Admin

- видеть список автомобилей по объекту;
- видеть parking spots;
- назначать место resident/unit;
- снимать назначение;
- блокировать/разблокировать авто;
- видеть parking events;
- видеть parking incidents;
- управлять базовыми parking rules.

### 6.4 Management Company

На уровне зрелой версии:

- видеть parking KPI по объектам;
- видеть проблемные объекты по vehicle access;
- видеть parking incident trends.

Это не часть первого parking MVP.

---

## 7. Parking access rules

Parking module должен подчиняться общему policy layer DomHub, но иметь свои правила.

Правила должны отвечать на вопросы:

- кто может въезжать;
- на какой объект;
- на какую парковочную зону;
- в каком временном окне;
- по какому основанию;
- есть ли лимит по числу машин;
- может ли гость использовать guest parking;
- может ли подрядчик въезжать на service parking;
- что происходит для blacklist vehicle;
- когда охрана имеет право на manual override.

---

## 8. Parking incidents

Parking module должен иметь отдельный incident layer для авто-сценариев.

Минимальные инциденты:

- неизвестный автомобиль;
- истёкший авто-допуск;
- blacklisted vehicle;
- въезд вне временного окна;
- ручной допуск охраной;
- конфликт между правилом и фактическим допуском;
- попытка въезда не в ту parking zone.

Каждый parking incident должен хранить:

- `vehicle_id` или plate snapshot;
- actor/security context;
- property context;
- timestamp;
- reason;
- resolution status;
- resolution notes.

---

## 9. Parking analytics

### MVP baseline

- число авто по объекту;
- число guest vehicle passes;
- число parking events;
- число deny events;
- число manual overrides;
- число parking incidents.

### После MVP

- traffic by day/hour;
- incident trends;
- resident vs guest vs service traffic;
- occupancy approximation where data model allows it;
- object-to-object comparison.

---

## 10. Integrations

### В MVP

- никакой тяжёлой интеграции как обязательного условия;
- допускается mock integration path;
- CSV onboarding для residents/vehicles/parking spots.

### В Strong v2

- whitelist sync;
- gate/barrier integration baseline;
- parking access point mapping;
- vehicle allow/deny event ingestion.

### В поздней фазе

- ANPR / plate recognition;
- richer parking automation;
- video evidence links;
- occupancy/sensor integrations only if market need is confirmed.

---

## 11. Что входит в Parking MVP

Parking MVP должен быть узким и продаваемым.

### Resident

- vehicle registry
- add/edit/delete vehicle
- guest vehicle pass
- vehicle access status

### Security

- vehicle lookup
- owner/unit visibility
- active access visibility
- allow/deny/manual override
- parking event logging

### Property Admin

- vehicle registry by property
- basic parking spots registry
- parking spot assignment
- blacklist/unblock vehicle
- parking event log
- parking incident list

### Domain

- `vehicle`
- `parking_spot`
- `parking_assignment`
- `vehicle_access`
- `parking_event`
- `parking_incident`

---

## 12. Что не входит в Parking MVP

- advanced occupancy sensors;
- smart routing inside the garage;
- billing and paid parking;
- booking/reservation marketplace;
- advanced guest parking monetization;
- deep ANPR automation as a hard MVP dependency;
- visual parking map editor;
- complex multi-level traffic optimization.

---

## 13. Parking Strong v2

После MVP модуль усиливается за счёт:

- parking zones and levels;
- stronger policy rules;
- richer admin controls;
- guest vs service vs resident parking scenarios;
- parking analytics;
- first real barrier/allowlist integrations.

---

## 14. Parking Market-Leading layer

Только после подтверждения market fit:

- ANPR-native flows;
- deeper gate automation;
- occupancy integrations;
- video-evidence linkage;
- richer portfolio analytics for УК;
- advanced parking compliance and policy automation.

---

## 15. Критерии готовности Parking MVP

Parking MVP считается готовым, когда:

- resident может управлять своими авто;
- resident может создать guest vehicle pass;
- security может найти авто и принять решение;
- parking events сохраняются;
- parking incidents создаются;
- property admin видит авто, места и назначения;
- существует базовый parking spot registry;
- хотя бы один полный happy path и один deny path проходят end-to-end.

---

## 16. Итог

Parking module в DomHub должен развиваться как часть access-platform, а не как отдельный “умный паркинг” продукт.

Правильный путь:

1. Vehicle/garage baseline
2. Parking spot assignment
3. Vehicle access and guard validation
4. Parking events and incidents
5. Parking policies and integrations

Именно такой порядок даёт полезный и продаваемый модуль без расползания scope.
