# DomHub — SKUD Vendor Priority Specification

Дата: 2026-04-21  
Статус: рабочая vendor-priority specification  
Назначение: определить, с какими классами и вендорами СКУД DomHub должен интегрироваться в первую очередь и по какой модели.

---

## 1. Цель документа

Документ нужен, чтобы:
- не распыляться на весь рынок сразу;
- выбрать правильную последовательность интеграций;
- увязать roadmap интеграций с продуктовой стратегией DomHub;
- определить, что считается MVP-support, v2-support и advanced-support по каждому вендорскому направлению.

---

## 2. Ключевой принцип

DomHub не должен начинать интеграционный roadmap с десятков вендоров.  
Сначала платформа должна стабильно покрывать:
- внутреннюю access model;
- policy layer;
- guard workflow;
- vehicle access;
- incident layer.

Только после этого интеграции со СКУД становятся ценными и управляемыми.

---

## 3. Приоритеты по классам систем

### P0 — классы систем, которые надо закрывать первыми

- шлагбаумы / ворота
- калитки / подъездные двери
- QR-based visitor access systems
- vehicle allowlist systems
- inbound allow/deny event sources

### P1 — второй слой

- домофонные системы
- card/BLE-based access systems
- turnstile access
- mixed gate + video linked systems

### P2 — более поздний слой

- full face-recognition integrations
- ANPR-first ecosystems
- complex enterprise building-security stacks

---

## 4. Рекомендуемый вендорный приоритет для РФ

## 4.1 Wave 1 — базовый приоритет

### Hikvision

Почему приоритетный:
- часто встречается на объектах;
- покрывает видео и access-related scenarios;
- релевантен для ЖК и посёлков;
- хороший кандидат для входа в реальные объекты.

### Sigur

Почему приоритетный:
- сильный российский СКУД-игрок;
- подходит для серьёзных объектов;
- логичный кандидат для B2B-платформы доступа.

### Bolid / Орион

Почему приоритетный:
- распространённый класс российских access/security installations;
- важен для реального рынка объектов и охраны.

### Parsec

Почему приоритетный:
- заметный классический СКУД-сценарий на рынке;
- релевантен для зрелых access integrations.

### PERCo

Почему приоритетный:
- распространённые турникеты, контроллеры и PERCo-Web installations;
- важен для объектов с классической бюро-пропускной моделью;
- хорошо ложится на HTTP/JSON integration layer.

## 4.2 Wave 2 — следующий слой

### RusGuard

Почему приоритетный:
- российский СКУД-игрок с собственным ПО и контроллерами;
- встречается на коммерческих объектах, стройках и гос/корпоративных площадках;
- нужен как типовой adapter для российских контроллерных инсталляций.

### IronLogic

Почему приоритетный:
- массовый класс автономных и сетевых контроллеров / Guard SaaS сценариев;
- важен для бюджетных КПП, калиток и малых объектов;
- поддержка должна начинаться с event/import/template integration, не с глубокого device management.

### Домофонные/IP-панельные экосистемы

Приоритет не по бренду, а по классу систем:
- IP-домофоны;
- подъездные панели;
- мобильное открытие двери;
- калитки и входные группы.

### TRASSIR-linked access ecosystems

Приоритетен как video + access link layer, не как единственная access system.

## 4.3 Wave 3 — advanced layer

### ANPR / plate ecosystems

Нужны для:
- коттеджных посёлков;
- premium access flows;
- high-volume vehicle entry scenarios.

### Face / BLE / card unified abstraction

Нужны позже, когда DomHub already stable as operations/access platform.

---

## 5. Что считается поддержкой вендора

### Level A — Basic Support

Поддерживаем:
- регистрацию интеграции на объект;
- привязку `access_point`;
- отправку базовых access commands or allowlist data;
- получение inbound allow/deny events;
- basic error logging.

### Level B — Operational Support

Дополнительно:
- vehicle allowlist sync;
- guard console context;
- incident creation on integration conflicts;
- richer audit mapping;
- status visibility and retries.

### Level C — Advanced Support

Дополнительно:
- richer policy sync;
- device/group mapping;
- camera/video linkages;
- advanced telemetry;
- operational dashboards per integration.

---

## 6. Recommended rollout matrix

| Вендор / класс | MVP | v2 | v3 |
|---|---|---|---|
| Hikvision | Нет | Basic/Operational | Advanced |
| Sigur | Нет | Basic/Operational | Advanced |
| Bolid / Орион | Нет | Basic | Operational/Advanced |
| Parsec | Нет | Basic | Operational/Advanced |
| PERCo | Нет | Basic | Operational/Advanced |
| RusGuard | Нет | Basic | Operational/Advanced |
| IronLogic | Нет | Basic | Operational/Advanced |
| Домофонные системы | Нет | Basic | Operational/Advanced |
| TRASSIR-linked video layer | Нет | Partial | Operational/Advanced |
| ANPR ecosystems | Нет | Нет | Operational/Advanced |
| Face/BLE/card unified | Нет | Нет | Advanced |

---

## 7. Product rule

Ни один вендор не должен определять внутреннюю модель DomHub.

Всегда:
- сначала внутренняя модель;
- потом mapping;
- потом adapter.

Нельзя строить:
- `Hikvision-first data model`
- `Bolid-first policy model`
- `Parsec-first access states`

Внутренняя модель должна быть vendor-neutral.

---

## 8. Acceptance criteria для первой волны интеграций

Интеграция считается реально полезной, если она умеет:
- привязаться к property and access_point;
- принимать и отправлять базовые access events;
- логировать ошибки;
- не ломать tenant isolation;
- быть операционно видимой для staff/admin;
- корректно работать с retries and idempotency.

---

## 9. Следующие документы

Этот документ зависит от:
- `domhub-integration-architecture-spec.md`
- `domhub-access-data-model-spec.md`

Следующий смежный документ:
- `domhub-video-integration-spec.md`

