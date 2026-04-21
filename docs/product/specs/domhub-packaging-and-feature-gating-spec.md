# DomHub — Packaging and Feature Gating Specification

Дата: 2026-04-21  
Статус: рабочая packaging specification  
Назначение: определить, как функции DomHub упаковываются в продуктовые пакеты и как включаются через feature flags.

---

## 1. Цель документа

Документ нужен, чтобы:
- отделить core product от growth modules;
- не тащить все функции во все объекты;
- управлять rollout and pricing logic;
- согласовать product, engineering and sales expectations.

---

## 2. Принципы упаковки

### 2.1 Не всё для всех

Не каждый объект должен получать все функции DomHub.

### 2.2 Core first

Все дополнительные модули строятся поверх ядра:
- tenant model
- access
- requests
- staff workspace
- notifications
- admin layer

### 2.3 Feature flag first

Рискованные, дорогие или клиент-специфичные модули должны включаться через feature flags.

---

## 3. Базовые продуктовые пакеты

## 3.1 Core Access

Подходит для:
- одного объекта;
- пилота;
- первых клиентов;
- access-first сценария.

Включает:
- resident profiles
- guest access
- QR passes
- security scan/admit/deny
- visit logs
- basic vehicle access
- announcements/documents
- basic notifications
- property admin baseline

## 3.2 Operations

Подходит для:
- объекта с активной staff operations;
- более зрелых клиентов.

Включает всё из Core Access плюс:
- requests
- assignment
- SLA
- packages
- technician workflow
- contractor workflow baseline
- incidents
- analytics baseline

## 3.3 Portfolio

Подходит для:
- управляющих компаний;
- multi-property operations.

Включает всё из Operations плюс:
- management company admin
- portfolio dashboards
- cross-property analytics
- shared templates/policies

## 3.4 Enterprise / Integrations

Подходит для:
- крупных клиентов;
- объектов с внешней СКУД;
- сложных rollout scenarios.

Включает всё из Portfolio плюс:
- integration layer
- webhooks
- access-system adapters
- advanced audit/reporting
- optional on-prem or special rollout assumptions if ever supported

---

## 4. Feature groups

### 4.1 Core feature group

Must be generally available:
- tenant model
- roles/scope
- access requests
- passes
- QR
- visit logs
- notifications baseline
- property admin baseline

### 4.2 Operations feature group

- requests
- technician workflow
- contractor workflow
- incidents
- packages
- analytics baseline

### 4.3 Portfolio feature group

- management company layer
- cross-property dashboards
- portfolio KPIs

### 4.4 Integrations feature group

- SMS provider variants
- Telegram integration
- webhooks
- access-system integrations
- ERP/1C integrations

### 4.5 Growth feature group

- meter readings
- OCR
- billing
- payments
- booking
- advanced automation
- AI features

---

## 5. Feature flag rules

### 5.1 What must be flaggable

Feature-flag candidates:
- risky new modules
- integrations
- tenant-specific rollouts
- premium/paid modules
- beta features

### 5.2 What should not be hidden behind complex flags

Core invariants should not depend on ad hoc feature flags:
- tenant isolation
- auth
- role enforcement
- audit baseline
- critical access security logic

### 5.3 Scope of flags

Flags should support:
- global default
- per-property override
- possibly per-management-company default in future

---

## 6. Recommended initial feature flags

### Core rollout flags

- `access_qr`
- `vehicle_access`
- `requests_module`
- `packages_module`
- `management_company_dashboard`

### Integration flags

- `sms_notifications`
- `telegram_notifications`
- `webhooks`
- `skud_adapter`
- `billing_sync`

### Growth flags

- `meter_readings`
- `ocr_hints`
- `payments`
- `space_booking`
- `automation_rules`

---

## 7. Packaging rules for engineering

Engineering must design modules so that:
- disabled module does not break core flows;
- UI hides unavailable features cleanly;
- APIs enforce feature availability consistently;
- analytics respects feature absence;
- onboarding/checklists reflect enabled modules only.

---

## 8. Packaging rules for sales and rollout

Sales should never promise:
- integrations not available for that package;
- modules hidden behind unready flags;
- features that require roadmap work without explicit statement.

Rollout must know:
- which flags are enabled for the tenant;
- which onboarding steps apply;
- which docs/guides are relevant.

---

## 9. Recommended commercial path

### Stage 1

Sell `Core Access` pilots.

### Stage 2

Upgrade validated customers into `Operations`.

### Stage 3

Sell `Portfolio` to УК with multiple properties.

### Stage 4

Offer `Enterprise / Integrations` selectively.

---

## 10. Non-goals

This document does not define:
- exact pricing;
- contract clauses;
- commercial discount policy.

It only defines product packaging logic and engineering gating logic.

---

## 11. Related documents

This document depends on:
- `domhub-final-product-plan.md`
- `domhub-access-platform-final-plan.md`
- `domhub-backlog-epics.md`
- `domhub-integration-architecture-spec.md`
- `domhub-analytics-metric-definitions.md`

