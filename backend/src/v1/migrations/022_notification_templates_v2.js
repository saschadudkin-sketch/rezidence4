'use strict';

// platform-v1 property-DB migration 022 — notification_templates_v2 (Фаза 6).
// Spec: docs/product/specs/platform-v1/notification-templates-v2-spec.md
//
// Централизованное хранилище текстов (title/body/url) для всех уведомлений,
// отправляемых через notifications_outbox.  До этой миграции копия текстов
// была зашита в сервисах (services/packages.js — три локации + helper
// buildPackageReceivedBody).  Проблемы зашитой копии:
//   1. Менять текст = релиз backend'а (копирайтер не может).
//   2. Нет локализации — текст всегда в строке.
//   3. Нет аудита изменений — кто и когда поменял уведомление?
//   4. Нет per-property override (premium-объект хочет свой тон).
//
// Шаблоны хранятся в property DB (а не в platform DB), так как:
//   - УК хочет per-property кастомизацию;
//   - outbox сам по себе per-property;
//   - seed из миграции даёт каждому объекту одинаковый стартовый набор,
//     а дальше каждый УК правит независимо.
//
// Структура template_key соответствует outbox.event_type 1-к-1
// (e.g. 'package.received').  Нарушать соответствие нельзя: producer
// вызывает renderTemplate(event_type) без дополнительного mapping'а.
//
// Интерполяция — мини-mustache (см. services/notificationTemplates.js):
//   {{var}}              — подстановка, пустая строка если переменная не задана
//   {{#var}}...{{/var}}  — включить фрагмент, если var truthy
//   {{^var}}...{{/var}}  — включить фрагмент, если var falsy
//
// Fallback-цепочка при рендере:
//   1. (template_key, channel=X, locale=Y)  — точное совпадение
//   2. (template_key, channel=NULL, locale=Y) — любой канал, нужный язык
//   3. (template_key, channel=X, locale='ru') — нужный канал, fallback ru
//   4. (template_key, channel=NULL, locale='ru') — полный fallback
// Если ничего нет — ошибка TEMPLATE_NOT_FOUND (worker потом пометит outbox row
// как failed с этим кодом).
//
// Инварианты §2:
//   body NOT NULL (хоть одна строка должна быть)
//   subject может быть NULL (SMS/telegram без темы)
//   channel NULL означает "применимо к любому каналу"
//   Уникальность: (template_key, COALESCE(channel,'__any__'), locale)

module.exports = {
  id: 'v1_022_notification_templates_v2',
  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS notification_templates_v2 (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        template_key   VARCHAR(80) NOT NULL,
        channel        VARCHAR(20)
                         CHECK (channel IS NULL OR channel IN (
                           'web_push','sms','telegram','webhook','email'
                         )),
        locale         VARCHAR(10) NOT NULL DEFAULT 'ru',
        subject        TEXT,
        body           TEXT NOT NULL,
        url_template   TEXT,
        description    TEXT,
        is_active      BOOLEAN NOT NULL DEFAULT TRUE,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT notification_templates_v2_body_nonempty
          CHECK (length(trim(body)) > 0),
        CONSTRAINT notification_templates_v2_key_nonempty
          CHECK (length(trim(template_key)) > 0)
      )
    `);

    // Уникальность шаблонов: expression-index для корректной обработки NULL
    // channel ('__any__' sentinel эквивалентно "любому каналу").  ON CONFLICT
    // DO NOTHING в seed'е ниже опирается на этот индекс.
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_templates_v2_key_channel_locale
        ON notification_templates_v2 (template_key, COALESCE(channel, '__any__'), locale)
    `);

    // Lookup index для renderTemplate: активные шаблоны по ключу и локали,
    // channel fallback читается через COALESCE в WHERE.
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_notification_templates_v2_lookup
        ON notification_templates_v2 (template_key, locale)
        WHERE is_active = TRUE
    `);

    // Seed начального набора package.* шаблонов.  Текст совпадает с
    // ранее зашитой копией в services/packages.js, чтобы рефактор был
    // behavior-preserving.  Идемпотентность: ON CONFLICT DO NOTHING — повторный
    // запуск миграции (при ручном тестировании) не ломается.
    await client.query(`
      INSERT INTO notification_templates_v2
        (template_key, channel, locale, subject, body, url_template, description)
      VALUES
        (
          'package.received',
          NULL,
          'ru',
          'Вам посылка',
          'Посылка{{#sender_name}} от {{sender_name}}{{/sender_name}}{{#carrier}} ({{carrier}}){{/carrier}}{{#storage_location}} — хранение: {{storage_location}}{{/storage_location}}{{^storage_location}} ожидает на ресепшн.{{/storage_location}}',
          '/packages/{{package_id}}',
          'Уведомление резиденту о получении посылки на ресепшн (fan-out sms + web_push).'
        ),
        (
          'package.picked_up_confirmation',
          NULL,
          'ru',
          'Посылка получена',
          'Вы получили посылку — подтверждено на ресепшн.',
          '/packages/{{package_id}}',
          'Подтверждение резиденту после успешного pickup (только web_push).'
        ),
        (
          'package.pickup_reminder',
          NULL,
          'ru',
          'Напоминание: посылка ждёт вас',
          'Ваша посылка на ресепшн уже {{days_waiting}} дней. Пожалуйста, заберите.',
          '/packages/{{package_id}}',
          'Ручное напоминание администратора о неполученной посылке.'
        )
      ON CONFLICT DO NOTHING
    `);
  },
};
