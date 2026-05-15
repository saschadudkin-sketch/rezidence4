---
name: semgrep-gitleaks-security-ci
description: Use when changing DomHub security scanning, gitleaks configuration, semgrep scripts, dependency/security CI, secret handling, or security scan runbooks.
license: project-local
metadata:
  domain: security
  project: DomHub
  source: project-local
---

# Semgrep Gitleaks Security CI

Use this skill for secret scanning, SAST, security scripts, and CI security gates.

## Relevant Commands

- `npm run security:gitleaks`
- `npm run security:semgrep`
- `npm run security:scan`

## Rules

- Never commit real secrets, tokens, private keys, production DSNs, or credential-bearing URLs.
- `.gitleaksignore` entries must be narrow, justified, and avoid masking real secrets.
- Semgrep suppressions must explain why the finding is not exploitable or how it is otherwise mitigated.
- Keep security scans reproducible on Windows PowerShell and CI.
- Prefer fixing the unsafe pattern over suppressing it.
- Treat test fixtures containing fake secrets as clearly fake and scoped to tests.

## DomHub Focus Areas

- JWT and refresh tokens
- Signed upload URLs
- Redis and Postgres connection strings
- Sentry DSNs and event scrubbing
- Web-push VAPID keys
- Tenant isolation and authorization checks
- External provider credentials for SKUD, VMS/NVR, ERP/1C, SMS, Telegram, and webhooks.

