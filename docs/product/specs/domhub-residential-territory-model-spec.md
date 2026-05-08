# DomHub — Residential Territory Model Specification

Дата: 2026-05-05
Статус: рабочая source-of-truth спецификация
Назначение: зафиксировать единую продуктовую и техническую модель DomHub для ЖК, клубных домов, коттеджных посёлков и других закрытых жилых территорий.

---

## 1. Цель документа

Этот документ нужен, чтобы DomHub развивался как платформа управления закрытым жилым объектом, а не как приложение, жёстко привязанное только к квартирному ЖК.

Документ определяет:
- какие типы жилых объектов поддерживает DomHub;
- как единая структура объекта мапится на ЖК и коттеджные посёлки;
- какие термины должны использоваться в продукте, API, UI и импортах;
- какие access, guard и service workflows являются обязательными для каждого типа объекта;
- где проходит граница v1-модели и когда можно расширять БД отдельными `streets`, `land_plots` или `property_areas`.

---

## 2. Продуктовое определение

DomHub должен позиционироваться как:

> платформа управления закрытой жилой территорией: ЖК, клубный дом, коттеджный посёлок, закрытая резиденция или портфель таких объектов.

Базовая формула:

`residential territory platform = access + checkpoint operations + resident service + staff workflow + contractor control + communications + portfolio governance`

Это означает:
- resident app важен, но не является центром продукта;
- центр продукта - ежедневная эксплуатация объекта;
- для ЖК критичны подъезды, квартиры, заявки, посылки и объявления;
- для посёлка критичны КПП, автомобили, участки/дома, подрядчики, сервисные зоны и журнал въезда/выезда;
- оба сценария должны работать на одной tenant, role/scope, audit и access-policy модели.

---

## 3. Поддерживаемые property modes

`properties.property_type` является основным переключателем продуктового режима.

| `property_type` | Рыночный смысл | Primary address model | Primary operations focus |
|---|---|---|---|
| `residential_complex` | ЖК / многокорпусный объект | корпус -> подъезд -> квартира | заявки, гостевые пропуска, посылки, подъездной доступ |
| `club_house` | клубный дом / премиальный малый объект | корпус / секция -> апартамент | консьерж, строгий гостевой доступ, сервисные сценарии |
| `cottage_community` | коттеджный посёлок / закрытая территория | сектор / улица -> дом / участок | КПП, авто-доступ, постоянные гости, подрядчики, территория |

Правило: `property_type` не должен менять tenant isolation, auth, audit или базовые contracts. Он меняет labels, onboarding templates, default policies, guard workflows and UI emphasis.

---

## 4. Каноническая структура

Текущая v1-структура остаётся:

- `property`
- `building`
- `entrance`
- `unit`

Но продуктовый смысл `unit` шире, чем "квартира".

`unit` - это адресуемая жилая или эксплуатационная единица внутри объекта:
- квартира;
- апартамент;
- таунхаус;
- дом;
- участок;
- коммерческое помещение;
- служебная / utility единица.

Поддерживаемые `unit_type`:
- `apartment`
- `townhouse`
- `house`
- `commercial`
- `utility`

### 4.1 ЖК

Для `residential_complex` структура читается буквально:

`property -> building -> entrance -> unit`

UI labels:
- `building` = корпус;
- `entrance` = подъезд;
- `unit` = квартира / помещение.

### 4.2 Клубный дом

Для `club_house` структура может быть упрощённой:

`property -> building/section -> entrance/lobby -> unit`

UI labels:
- `building` = корпус / секция;
- `entrance` = вход / лобби;
- `unit` = апартамент / квартира.

### 4.3 Коттеджный посёлок

Для `cottage_community` v1 использует ту же физическую схему, но с property-type-aware labels:

`property -> area/street placeholder -> checkpoint/sector placeholder -> unit`

Рекомендуемая v1-модель:
- создать 1 или несколько `building` как "сектор", "улица", "очередь" или "территория";
- создать 1 `entrance` внутри каждого такого узла как "основной контур" или "сектор";
- хранить дом/участок как `unit` с `unit_type='house'` или `unit_type='townhouse'`;
- `unit_number` использовать как отображаемый номер дома/участка;
- не показывать resident/staff пользователю слово "подъезд" для `cottage_community`.

Важно: виртуальные `building` / `entrance` являются внутренним способом совместимости v1, а не продуктовой концепцией для посёлка.

---

## 5. Access topology

Access-модель должна быть общей для всех типов объектов:

- `access_zone` - логическая зона;
- `access_point` - физическая точка доступа;
- `access_policy` - правило допуска;
- `pass` / `access_request` - основание доступа;
- `visit_log` - фактическое событие;
- `access_incident` - спорная или запрещённая ситуация.

### 5.1 Типовые зоны для ЖК

- периметр;
- подъезд;
- паркинг;
- гостевой паркинг;
- общественная зона;
- техническая зона;
- сервисная зона.

### 5.2 Типовые зоны для коттеджного посёлка

- периметр;
- КПП;
- улица;
- сектор;
- гостевой паркинг;
- резидентский паркинг;
- сервисная зона;
- хозяйственная зона;
- общественная территория;
- техническая зона.

### 5.3 Типовые точки доступа

- КПП;
- шлагбаум;
- ворота;
- калитка;
- подъездная дверь;
- паркинг;
- сервисный въезд;
- домофонная панель;
- турникет, если объект его использует.

---

## 6. Guard and checkpoint workflows

Для `cottage_community` guard console должен быть vehicle-first and checkpoint-first.

Обязательные сценарии:
- поиск по номеру авто;
- поиск по ФИО;
- поиск по дому/участку;
- поиск по гостю или подрядчику;
- ожидаемые гости;
- постоянные гости;
- resident vehicles;
- contractor/service vehicles;
- admit / deny;
- manual override;
- blacklist/watchlist hits;
- access incident creation;
- журнал въезда и выезда.

Для `residential_complex` guard console остаётся pass-first, но должен поддерживать vehicle flows:
- QR гостя;
- гостевой авто-пропуск;
- доступ курьера;
- подрядчик / сервисный специалист;
- подъезд / паркинг / service entrance;
- incident on invalid QR, expired pass, blacklist hit.

---

## 7. Requests and operations by object type

### 7.1 ЖК

Типовые категории:
- сантехника;
- электрика;
- лифт;
- подъезд;
- паркинг;
- посылки;
- клининг;
- общедомовые зоны;
- документы и обращения в УК.

### 7.2 Коттеджный посёлок

Типовые категории:
- КПП / въезд;
- шлагбаум / ворота;
- дороги;
- освещение территории;
- вывоз мусора;
- вода / скважина / насосная;
- электрика;
- благоустройство;
- охрана;
- подрядчики / сервисные работы;
- общая территория;
- аварийные ситуации.

Правило: requests module не должен считать, что каждая заявка привязана к квартире. Для посёлка заявка может быть привязана к дому, участку, зоне, дороге, КПП или общей территории.

---

## 8. UI labels and product language

UI должен зависеть от `property_type`.

### 8.1 Labels

| Сущность | ЖК | Клубный дом | Коттеджный посёлок |
|---|---|---|---|
| `building` | Корпус | Корпус / секция | Сектор / улица / территория |
| `entrance` | Подъезд | Вход / лобби | Контур / сектор |
| `unit` | Квартира | Апартамент / квартира | Дом / участок |
| `access_point` | Вход / дверь / шлагбаум | Вход / лобби / паркинг | КПП / ворота / шлагбаум |
| `vehicle_access` | Авто-пропуск | Авто-пропуск | Въезд / авто-доступ |

### 8.2 UI rule

Нельзя показывать жителям коттеджного посёлка:
- "подъезд", если это технический placeholder;
- "квартира", если `unit_type='house'` или `townhouse`;
- многоквартирные labels в guard console, если primary search должен быть "дом/участок/авто".

### 8.3 API rule

API может продолжать отдавать `building_id`, `entrance_id`, `unit_id`.

Frontend обязан:
- получать `property_type`;
- применять label map;
- строить display address через property-type-aware formatter;
- не хардкодить "квартира", "подъезд", "корпус" в общих компонентах.

---

## 9. Onboarding and import

DomHub должен иметь разные onboarding templates.

### 9.1 ЖК CSV baseline

Обязательные поля:
- корпус;
- подъезд;
- квартира;
- этаж, если есть;
- ФИО резидента;
- телефон;
- тип резидента;
- авто, если есть.

### 9.2 Коттеджный посёлок CSV baseline

Обязательные поля:
- сектор / улица;
- номер дома / участка;
- тип единицы (`house`, `townhouse`, `utility`);
- ФИО собственника / резидента;
- телефон;
- резидентский тип;
- автомобили;
- постоянные гости, если применимо;
- service access notes, если применимо.

### 9.3 Provisioning rule

Новый `cottage_community` tenant не считается полноценно подготовленным, пока не созданы:
- хотя бы один checkpoint / gate access point in planning data;
- resident/house import template;
- vehicle baseline;
- guard console mode;
- default policies for resident vehicle, guest vehicle, courier and contractor access.

---

## 10. Data model boundaries

### 10.1 Что делаем в v1

- используем существующие `building`, `entrance`, `unit`;
- используем `property_type` как mode switch;
- используем `unit_type='house'` / `townhouse` для посёлков;
- используем `vehicles` как first-class сущность;
- используем `access_zone` / `access_point` для КПП, ворот и шлагбаумов;
- не ломаем текущие `/api/v1/*` contracts.

### 10.2 Что не делаем без пилотного требования

Не добавляем отдельные таблицы:
- `streets`;
- `land_plots`;
- `houses`;
- `checkpoints`;
- `roads`;
- `territory_sections`.

Исключение: реальный пилот показывает, что v1-мэппинг через `building/entrance/unit` создаёт операционные ошибки или сильно усложняет импорт, UI, reporting или access policies.

### 10.3 Возможное v2-расширение

Если нужно, v2 может добавить:
- `property_areas` для секторов, улиц, очередей и зон посёлка;
- `land_plots` для юридически значимых участков;
- `unit_address_aliases` для альтернативных отображений адреса;
- `access_checkpoint_profiles` для КПП с правилами lanes, directions and guard posts.

Эти сущности не должны менять базовый смысл `resident`, `vehicle`, `pass`, `visit_log`, `access_policy` and `audit_log`.

---

## 11. MVP для коттеджного посёлка

Первый продаваемый scope:
- property with `property_type='cottage_community'`;
- реестр домов/участков через `units`;
- resident/owner/family members;
- resident vehicles;
- permanent resident vehicle access;
- guest vehicle pass;
- courier access;
- contractor/service access;
- security checkpoint workspace;
- lookup by plate, resident name, house/plot;
- whitelist/blacklist;
- visit logs;
- access incidents;
- announcements and urgent notifications;
- requests for territory operations.

Не входит в первый scope:
- ANPR-first automation;
- full SKUD vendor integration;
- face recognition;
- smart parking occupancy;
- billing/payments;
- legal land-cadastre integration.

---

## 12. Acceptance criteria

Residential territory model считается проработанной, если:
- master product docs называют ЖК, клубные дома and cottage communities first-class markets;
- `property_type` определяет labels, onboarding templates and guard defaults;
- `unit` documented as addressable dwelling/asset, not only apartment;
- cottage-community UI does not expose apartment-only terminology;
- guard workspace can run vehicle-first checkpoint flows;
- access policies can express checkpoint, vehicle, guest, courier and contractor flows;
- onboarding can import resident homes/plots and vehicles without custom code;
- future land/area extensions have a documented path without breaking v1 contracts.

---

## 13. Связанные source-of-truth документы

Primary:
- `domhub-final-product-plan.md`
- `domhub-access-platform-final-plan.md`
- `domhub-access-data-model-spec.md`
- `domhub-access-policy-spec.md`
- `platform-v1/units-spec.md`

Supporting:
- `domhub-parking-module-spec.md`
- `domhub-skud-vendor-priority-spec.md`
- `domhub-deployment-and-tenant-ops-spec.md`
- `domhub-analytics-metric-definitions.md`
