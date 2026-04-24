'use strict';

// platform-v1 property-DB migration 017 — notification_log_v2 (Фаза 5).
// Spec: docs/product/specs/platform-v1/notification-log-v2-spec.md §2.
//
// Журнал ФАКТОВ доставки уведомлений: строка появляется строго после
// финальной попытки worker'а (success либо последний fail перед dead).
// Промежуточные fail'ы остаются только в outbox.last_error — log_v2 —
// append-only история для аудита, диагностики и резидентского «мои
// уведомления».
//
// Связь с outbox: один outbox_id → ровно одна (или ноль) log-строк.
// UNIQUE partial index по outbox_id гарантирует 1-to-1.
//
// Инварианты §2:
//   sent  ⇒ error_code IS NULL AND error_message IS NULL
//   failed ⇒ error_code IS NOT NULL
//   external ⇒ recipient_id IS NULL (адрес только в recipient_address)
//   internal (resident/staff/contractor) ⇒ recipient_id IS NOT NULL

module.exports = {
  id: 'v1_017_notification_log_v2',
  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS notification_log_v2 (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id         UUID NOT NULL,
        outbox_id           UUID REFERENCES notifications_outbox(id) ON DELETE SET NULL,
        recipient_type      VARCHAR(20) NOT NULL
                              CHECK (recipient_type IN (
                                'resident','staff','contractor','external'
                              )),
        recipient_id        UUID,
        recipient_address   TEXT,
        channel             VARCHAR(20) NOT NULL
                              CHECK (channel IN (
                                'web_push','sms','telegram','webhook','email'
                              )),
        event_type          VARCHAR(60) NOT NULL,
        status              VARCHAR(20) NOT NULL
                              CHECK (status IN ('sent','failed')),
        payload             JSONB NOT NULL,
        error_code          VARCHAR(40),
        error_message       TEXT,
        provider_message_id TEXT,
        attempt_count       SMALLINT NOT NULL DEFAULT 1,
        sent_at             TIMESTAMPTZ NOT NULL,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT notification_log_v2_sent_clean CHECK (
          status <> 'sent' OR (error_code IS NULL AND error_message IS NULL)
        ),
        CONSTRAINT notification_log_v2_failed_coded CHECK (
          status <> 'failed' OR error_code IS NOT NULL
        ),
        CONSTRAINT notification_log_v2_external_no_id CHECK (
          recipient_type <> 'external' OR recipient_id IS NULL
        ),
        CONSTRAINT notification_log_v2_internal_has_id CHECK (
          recipient_type = 'external' OR recipient_id IS NOT NULL
        ),
        CONSTRAINT notification_log_v2_attempts_positive CHECK (attempt_count >= 1)
      )
    `);

    // Per-tenant timeline (admin view).
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_notification_log_v2_property_time
        ON notification_log_v2(property_id, created_at DESC)
    `);

    // «История для резидента X» (также покрывает /notification-log/mine).
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_notification_log_v2_recipient
        ON notification_log_v2(property_id, recipient_type, recipient_id, created_at DESC)
    `);

    // Metrics per event type.
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_notification_log_v2_event
        ON notification_log_v2(property_id, event_type, created_at DESC)
    `);

    // Delivery-rate per channel.
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_notification_log_v2_channel_status
        ON notification_log_v2(property_id, channel, status, created_at DESC)
    `);

    // 1-to-1 гарантия с outbox (один outbox-row → максимум одна log-запись).
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_log_v2_outbox
        ON notification_log_v2(outbox_id)
        WHERE outbox_id IS NOT NULL
    `);
  },
};
