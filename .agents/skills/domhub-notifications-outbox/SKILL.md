---
name: domhub-notifications-outbox
description: Use when changing DomHub notifications, transactional outbox, notification templates, notification log, web-push delivery, subscription cleanup, retries, channel adapters, or runtime notification jobs.
license: project-local
metadata:
  domain: notifications
  project: DomHub
  source: project-local
---

# DomHub Notifications Outbox

Use this skill for notification persistence, delivery, templates, logs, and retry workers.

## Relevant Sources

- `docs/product/specs/platform-v1/notifications-outbox-spec.md`
- `docs/product/specs/platform-v1/notification-templates-v2-spec.md`
- `docs/product/specs/platform-v1/notification-log-v2-spec.md`
- `docs/runbooks/web-push-setup.md`
- backend notification services, outbox workers, web-push adapters, and runtime jobs.

## Rules

- Business transactions should enqueue notification intent in the outbox before async delivery.
- Delivery adapters must not own business state transitions.
- Keep template rendering deterministic and testable.
- Scope notification logs and subscriptions by property where applicable.
- Handle web-push dead endpoints: 404/410 should deactivate subscriptions.
- Retries need bounded attempts, timestamps, error capture, and operational visibility.

## Checks

- Run notification service, outbox, template, and runtime job tests for related changes.
- Run web-push setup/readiness checks when environment requirements change.
- Include API contract checks for admin notification log or outbox endpoints.

