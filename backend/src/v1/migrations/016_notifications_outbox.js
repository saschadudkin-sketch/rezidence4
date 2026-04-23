'use strict';

// platform-v1 property-DB migration 016 — notifications_outbox (Фаза 5 Content+Notifications).
// Spec: docs/product/specs/platform-v1/notifications-outbox-spec.md §2.
//
// Transactional outbox для доставки уведомлений.  Producer (route handler
// или service) INSERT'ит строку в этой же транзакции, что и бизнес-мутация:
// rollback — уведомление исчезает, commit — уведомление гарантированно
// попадёт к worker'у, даже если канал-адаптер временно недоступен.
//
// State machine (§3):
//   pending → in_flight → {sent, failed}
//   failed (attempt_count<max) → pending (через next_attempt_at + backoff)
//   failed (attempt_count>=max) → dead
//
// Индексы shaped под worker hot path (status + next_attempt_at) и под
// observability (correlation_id для «все уведомления по этой заявке»).

module.exports = {
  id: 'v1_016_notifications_outbox',
  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications_outbox (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id       UUID NOT NULL,
        event_type        VARCHAR(80) NOT NULL,
        channel           VARCHAR(20) NOT NULL
                            CHECK (channel IN (
                              'web_push','sms','telegram','webhook','email'
                            )),
        recipient_type    VARCHAR(20) NOT NULL
                            CHECK (recipient_type IN (
                              'resident','staff','contractor','vehicle','external'
                            )),
        recipient_id      UUID,
        recipient_address TEXT,
        payload           JSONB NOT NULL,
        status            VARCHAR(20) NOT NULL DEFAULT 'pending'
                            CHECK (status IN (
                              'pending','in_flight','sent','failed','dead'
                            )),
        attempt_count     SMALLINT NOT NULL DEFAULT 0,
        max_attempts      SMALLINT NOT NULL DEFAULT 6,
        next_attempt_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_attempted_at TIMESTAMPTZ,
        last_error        TEXT,
        sent_at           TIMESTAMPTZ,
        correlation_id    UUID,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT notifications_outbox_attempts_nonneg CHECK (attempt_count >= 0),
        CONSTRAINT notifications_outbox_max_positive    CHECK (max_attempts > 0),
        CONSTRAINT notifications_outbox_sent_audit CHECK (
          status <> 'sent' OR sent_at IS NOT NULL
        )
      )
    `);

    // Worker hot path: scan for pending/failed rows eligible for the next tick.
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_notifications_outbox_worker_queue
        ON notifications_outbox(next_attempt_at)
        WHERE status IN ('pending','failed')
    `);

    // Observability view (admin UI, Prometheus-exporter join on property).
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_notifications_outbox_property_time
        ON notifications_outbox(property_id, created_at DESC)
    `);

    // "Show all notifications for this business entity" (e.g. access_request).
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_notifications_outbox_correlation
        ON notifications_outbox(correlation_id)
        WHERE correlation_id IS NOT NULL
    `);
  },
};
