# Alert runbook

## RezAuthRefreshFailuresHigh

1. Check application logs for refresh errors (`rez_auth_refresh_failed_total`) and top failing endpoints.
2. Verify DB/Redis connectivity and token signing configuration in the backend.
3. If issue started after a deploy, rollback and compare auth-related changes.

## RezAuthLegacyFallbackUsed

1. Confirm `REFRESH_LEGACY_FALLBACK_ENABLED` is still required for an active migration.
2. Identify accounts/services still using legacy refresh rows.
3. Plan cleanup and switch `REFRESH_LEGACY_FALLBACK_ENABLED=0` after `increase(rez_auth_refresh_legacy_fallback_total[1d]) == 0` for a full day.

## RezDbPoolWaitingHigh

1. Check DB load and long-running queries.
2. Verify backend connection pool size and current traffic.
3. Scale backend/database or tune query/index performance to reduce `rez_db_pool_waiting`.

## RezPackageSlaRunnerStuck

Gauge `package_sla_awaiting_pickup_over_14d > 0` means there are packages in
`awaiting_pickup` status with `received_at` older than 14 days — the SLA runner
should have flipped them to `returned` automatically once per hour.

1. Check `NOTIFICATIONS_OUTBOX_ENABLED=true` in backend env — without the flag
   `startPackageSlaRunner` exits early in `disabled` state.
2. Look at backend logs for `[package-sla]` entries in the last hour.
   Expected cadence: one tick per hour per tenant. Missing ticks = stopped
   runner (check process uptime / `gracefulShutdown` triggered?).
3. Per-tenant errors logged as `[package-sla] tick failed for property
   slug=<x>`. Single-tenant failures are isolated; fix the specific property.
4. Manual unblock: `POST /api/v1/packages/:id/return` with admin auth for each
   overdue package while runner is being repaired.

## RezPackageRemindersNotFlowing

Gauge `package_sla_reminders_sent_24h == 0` while `package_sla_awaiting_pickup_over_7d > 0`
means candidates exist but not a single `package.pickup_reminder` outbox row
was created in the last 24 hours.

1. Check the SLA runner is running (see `RezPackageSlaRunnerStuck` step 1–2).
2. Check the outbox runner — without it, reminders stay as `pending` forever.
3. Query `/api/v1/admin/outbox?event_type=package.pickup_reminder` and verify
   rows exist but are stuck in `pending` or `failed` — then the issue is in
   channel adapters, not the SLA runner.
4. If rows don't exist at all, `findRemindCandidates` is either skipping them
   (check `returnDays > remindDays` guard) or the idempotency `NOT EXISTS`
   query keeps matching stale rows — inspect outbox for the package ids.

## RezOutboxPendingStuck

`notifications_outbox_oldest_pending_age_seconds > 600` means the oldest
pending row has been waiting >10 minutes — outbox worker or the target
channel is lagging.

1. Check outbox worker logs for `[outbox-worker]` entries with the stuck row id.
2. Verify worker is running and not stuck on advisory lock (`pg_locks`).
3. Check the per-channel error pattern in `/api/v1/admin/outbox` — if all
   stuck rows are on one channel (sms/telegram/web_push), the upstream
   provider is the culprit.
4. Manual requeue: `POST /api/v1/admin/outbox/:id/requeue` for individual rows.

## RezOutboxDeadRowsRising

`increase(notifications_outbox_dead[1h]) > 20` — more than 20 rows moved to
`dead` in the last hour. Usually a broken channel configuration, not organic
failure.

1. Group dead rows by channel in the admin UI — one channel dominating →
   provider issue (VAPID misconfig, SMS account frozen, etc.).
2. Check last `last_error` field on dead rows for the common failure reason.
3. Fix the root cause, then `POST /api/v1/admin/outbox/:id/requeue` to
   resurrect recently-killed rows (only dead/failed are requeue-able).
