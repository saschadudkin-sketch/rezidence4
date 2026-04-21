# DomHub — Access Policy Specification

Дата: 2026-04-21  
Статус: рабочая policy specification  
Назначение: формализовать правила доступа в DomHub для resident, guests, staff, contractors, vehicles и охраны.

---

## 1. Цель документа

Документ определяет:
- какие типы доступа существуют;
- как описываются зоны и точки доступа;
- как формулируется policy;
- какие approval modes поддерживаются;
- как работают blacklist, override и emergency access;
- как policy применяется к pass/access request.

Этот документ является source of truth для:
- backend policy engine;
- database constraints;
- API validation;
- security workspace;
- analytics и audit.

---

## 2. Базовые сущности policy layer

- `access_zone`
- `access_point`
- `access_policy`
- `access_request`
- `access_approval`
- `pass`
- `access_override`
- `access_incident`

---

## 3. Типы субъектов доступа

Поддерживаются следующие `subject_type`:
- `resident`
- `guest`
- `staff`
- `contractor`
- `vehicle`
- `courier`

### 3.1 Resident

Постоянный или долгосрочный доступ в рамках объекта проживания.

### 3.2 Guest

Временный персональный доступ, обычно инициируемый resident или staff.

### 3.3 Staff

Доступ сотрудника объекта в рамках роли и служебной зоны.

### 3.4 Contractor

Временный или связанный с работой доступ внешнего исполнителя.

### 3.5 Vehicle

Доступ, привязанный к номеру автомобиля и владельцу/основанию.

### 3.6 Courier

Специальный упрощённый временный доступ для доставки или сервисного визита.

---

## 4. Типы доступа

Поддерживаются следующие `request_type` / `pass_type` сценарии:

- `guest_access`
- `vehicle_access`
- `contractor_access`
- `courier_access`
- `service_access`
- `temporary_resident_access`
- `resident_permanent_access`
- `staff_operational_access`
- `emergency_access`

---

## 5. Зоны доступа

`access_zone` описывает логическую область объекта.

Поддерживаемые `zone_type`:
- `perimeter`
- `residential_entry`
- `parking`
- `public_area`
- `technical_area`
- `service_area`

### Примеры зон

- внешний периметр
- основной въезд
- гостевой паркинг
- подземный паркинг
- подъезд 1
- техническое помещение
- хозяйственная зона
- клубная зона / общественная территория

---

## 6. Точки доступа

`access_point` описывает конкретный барьер доступа.

Поддерживаемые `point_type`:
- `gate`
- `barrier`
- `door`
- `turnstile`
- `wicket`
- `intercom`

### Примеры точек

- шлагбаум КПП 1
- калитка A
- дверь подъезда 2
- ворота сервисного въезда
- турникет паркинга

---

## 7. Access Policy

`access_policy` — это правило, которое определяет, имеет ли субъект право на доступ.

### 7.1 Обязательные атрибуты policy

- `subject_type`
- `subject_role` или специализация, если применимо
- `zone_id` и/или `point_id`
- `access_method`
- `approval_mode`
- `schedule_json`
- `duration_minutes`
- `is_recurring`
- `is_active`

### 7.2 Что policy должна определять

Policy должна отвечать на вопросы:
- кому доступ разрешён;
- куда доступ разрешён;
- каким способом;
- требуется ли согласование;
- в какие временные окна доступ действует;
- как долго длится доступ;
- может ли доступ быть многоразовым;
- допускается ли auto-approval.

---

## 8. Методы доступа

Поддерживаемые `access_method`:
- `qr`
- `manual`
- `plate`
- `ble`
- `card`
- `face`
- `pin`

### Правила по методу доступа

- `qr` — основной метод для временных guest/service flows
- `plate` — основной метод для vehicle access
- `manual` — fallback или guard override flow
- `ble/card/face/pin` — интеграционный уровень для зрелой версии платформы

---

## 9. Approval modes

Поддерживаемые `approval_mode`:
- `auto`
- `required`
- `security_only`
- `admin_only`

### 9.1 `auto`

Заявка одобряется автоматически, если проходит policy validation.

### 9.2 `required`

Нужно явное согласование по бизнес-правилу объекта.

### 9.3 `security_only`

Охрана принимает решение по факту или до активации доступа.

### 9.4 `admin_only`

Только `property_admin` или уполномоченный staff может согласовать.

---

## 10. Временные правила

### 10.1 Одноразовый доступ

- применяется к guest/courier/service flows;
- обычно имеет чёткий `valid_from` и `valid_until`;
- может становиться `used` после первого прохода.

### 10.2 Многоразовый доступ

- применяется к residents, staff, части contractors;
- допускает множественные проходы в пределах временного окна;
- должен быть явно разрешён policy.

### 10.3 Scheduled access

- действует только в заданные часы/дни;
- если субъект пытается пройти вне окна, создаётся incident или deny event.

### 10.4 Recurring access

- разрешён только для заранее согласованных ролей;
- должен иметь ограниченный срок жизни или отдельный revoke control.

---

## 11. Vehicle policy rules

### 11.1 Основные поля

Vehicle access должен учитывать:
- номер авто;
- владельца;
- тип транспорта;
- whitelist/blacklist status;
- окно действия;
- связанную зону/точку.

### 11.2 Базовые правила

- blacklisted vehicle не может auto-pass;
- whitelist может использоваться только если policy позволяет;
- vehicle pass должен быть привязан к property boundary;
- один и тот же номер не может одновременно принадлежать разным субъектам в одном объекте без явной бизнес-логики.

---

## 12. Contractor / service access rules

### 12.1 Contractor access

Contractor access должен:
- быть ограничен по времени;
- быть связан с объектом работ;
- по возможности быть связан с request/service task;
- не открывать доступ вне нужных зон;
- автоматически истекать после завершения работ или срока.

### 12.2 Crew access

Если допуск оформляется на бригаду:
- доступ должен быть оформлен на каждого члена бригады либо на явно разрешённый grouped flow;
- групповая модель не должна ломать auditability.

---

## 13. Blacklist / watchlist rules

### 13.1 Blacklist

Если субъект или авто в blacklist:
- auto-approval запрещён;
- access attempt должен фиксироваться;
- security получает явный сигнал;
- создаётся deny или incident по policy.

### 13.2 Watchlist

Если субъект в watchlist:
- доступ может не блокироваться автоматически;
- но охрана должна видеть повышенное внимание и историю.

---

## 14. Override rules

`access_override` допускается только для уполномоченного staff.

Поддерживаемые типы:
- `manual_admit`
- `manual_deny`
- `temporary_whitelist`
- `temporary_block`

### 14.1 Требования к override

Override всегда требует:
- идентификации staff actor;
- причины;
- audit trail;
- связи с pass/incident при наличии;
- потенциального уведомления admin/security logs.

### 14.2 Когда override допустим

- технический сбой внешней СКУД;
- аварийный сценарий;
- подтверждённый ручной пропуск;
- исправление временной ошибки данных.

### 14.3 Когда override недопустим

- если staff не имеет нужной роли;
- если субъект явно заблокирован без права override;
- если нарушается policy объекта без чрезвычайного основания.

---

## 15. Incident creation rules

`access_incident` должен создаваться, если:
- использован невалидный QR;
- используется истёкший доступ;
- проход совершается вне временного окна;
- срабатывает blacklist;
- происходит manual override;
- есть конфликт между DomHub и внешней СКУД;
- есть подозрительные повторные попытки прохода.

---

## 16. Policy evaluation order

Каждая попытка доступа проходит по следующему порядку:

1. Проверка tenant/property boundary  
2. Проверка subject existence and active status  
3. Проверка blacklist/block flags  
4. Проверка наличия valid pass/request context  
5. Проверка зоны/точки доступа  
6. Проверка временного окна  
7. Проверка approval status  
8. Проверка метода доступа  
9. Принятие решения `allow / deny / escalate / incident`

---

## 17. Decision outcomes

Результат проверки policy должен быть одним из:
- `allow`
- `deny`
- `needs_approval`
- `needs_security_review`
- `incident_required`

### Значение результатов

- `allow` — доступ разрешён
- `deny` — доступ запрещён
- `needs_approval` — запрос не может быть активирован без согласования
- `needs_security_review` — охрана должна принять решение
- `incident_required` — событие должно быть оформлено как инцидент

---

## 18. Analytics-relevant policy events

Для аналитики policy layer должен порождать события:
- access request created
- access request approved
- access request rejected
- pass activated
- pass revoked
- pass expired
- access allowed
- access denied
- override performed
- incident created

---

## 19. Что должен сделать следующий документ

Следующим документом должен быть:
- `domhub-state-machines-spec.md`

Он должен зафиксировать:
- status transitions;
- allowed transitions;
- actor permissions per transition;
- side effects for analytics/audit/notifications.

