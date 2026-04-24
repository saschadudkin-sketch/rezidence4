'use strict';

// platform-v1 notification templates service — Spec: notification-templates-v2-spec.md
// Phase: 6 (legacy content migration).
//
// Единая точка рендеринга текстов для outbox уведомлений.  До Phase 6 title/body
// были зашиты в коде сервисов (packages.js и пр.), что блокировало
// кастомизацию от УК и перевод.  Теперь сервисы вызывают:
//
//   const rendered = await renderTemplate(db, 'package.received', variables);
//   // rendered = { subject: 'Вам посылка', body: '…', url: '/packages/…' }
//
// и складывают rendered.* в outbox payload.  Адаптеры (web_push/sms/telegram)
// продолжают читать payload.title / payload.body — семантика не меняется.
//
// Шаблонный движок — минимальный mustache:
//   {{var}}              — подстановка String(variables[var]), пустая строка
//                          если переменная не задана или null/undefined.
//   {{#var}}...{{/var}}  — включить фрагмент, если variables[var] truthy.
//   {{^var}}...{{/var}}  — включить фрагмент, если variables[var] falsy.
//
// Почему не взять handlebars/mustache npm-пакет: 20-строчный movie-режиссёр
// покрывает текущий use case, не тянет runtime-зависимость и не выполняет
// произвольный JS (XSS-safe для SSR-рендера в уведомлениях).  При появлении
// need для partials/helpers — поднимемся до полноценного mustache (~1kb).
//
// db контракт: принимаем pool ИЛИ pg client (любой объект с .query()).
// В коллере packages.js рендер вызывается внутри транзакции, и мы передаём
// туда tx-client, чтобы read был consistent с остальными мутациями.  Но если
// шаблоны читаются вне транзакции (например из worker'а) — передача pool'а
// тоже валидна.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Класс ошибки, бросаемой renderTemplate когда шаблон не найден.  Worker при
 * ловле этого кода в outbox-pipeline пометит строку failed и залогирует —
 * не retry'ит, т.к. это отсутствующая конфигурация, а не транзиентная ошибка.
 */
class TemplateNotFoundError extends Error {
  constructor(templateKey, channel, locale) {
    super(`Notification template not found: ${templateKey} (channel=${channel}, locale=${locale})`);
    this.name = 'TemplateNotFoundError';
    this.code = 'TEMPLATE_NOT_FOUND';
    this.templateKey = templateKey;
    this.channel = channel;
    this.locale = locale;
  }
}

/**
 * interpolate — движок рендера шаблона с простым mustache-синтаксисом.
 *
 * Порядок обработки важен: сначала секции (которые могут содержать вложенные
 * {{var}}), затем плоские подстановки.  Если в секции встречается та же
 * переменная — её значение подставится вторым проходом.
 *
 * @param {string} template
 * @param {Object<string,any>} variables
 * @returns {string}
 */
function interpolate(template, variables) {
  if (typeof template !== 'string') return '';
  const vars = variables || {};

  // 1a. Truthy-секции: {{#key}}...{{/key}}
  let result = template.replace(
    /\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
    (_, key, inner) => (vars[key] ? inner : ''),
  );

  // 1b. Falsy-секции: {{^key}}...{{/key}}  (inverted)
  result = result.replace(
    /\{\{\^(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
    (_, key, inner) => (vars[key] ? '' : inner),
  );

  // 2. Плоские подстановки: {{key}}
  result = result.replace(
    /\{\{(\w+)\}\}/g,
    (_, key) => (vars[key] != null ? String(vars[key]) : ''),
  );

  return result;
}

/**
 * renderTemplate — найти шаблон по ключу и отрендерить с переменными.
 *
 * Fallback-цепочка (priority, high→low):
 *   1. (template_key, channel=X, locale=Y)
 *   2. (template_key, channel=NULL, locale=Y)
 *   3. (template_key, channel=X, locale='ru')
 *   4. (template_key, channel=NULL, locale='ru')
 *
 * Если ничего не найдено → бросает TemplateNotFoundError.
 *
 * @param {{query: Function}} db       pool ИЛИ pg client (.query обязателен)
 * @param {string} templateKey         e.g. 'package.received'
 * @param {Object<string,any>} [variables]  ключи для интерполяции
 * @param {Object} [opts]
 * @param {?string} [opts.channel]      web_push|sms|telegram|webhook|email|null
 * @param {string}  [opts.locale='ru']
 * @returns {Promise<{subject: ?string, body: string, url: ?string, templateKey: string, channel: ?string, locale: string}>}
 */
async function renderTemplate(db, templateKey, variables = {}, opts = {}) {
  if (!db || typeof db.query !== 'function') {
    throw new Error('renderTemplate: db parameter must expose .query()');
  }
  if (typeof templateKey !== 'string' || !templateKey.trim()) {
    throw new Error('renderTemplate: templateKey required');
  }
  const channel = opts.channel || null;
  const locale = opts.locale || 'ru';

  // Одним запросом тащим все кандидатов для fallback'а и сортируем по
  // приоритету — это дешевле цепочки 4 SELECT'ов.  ORDER BY с CASE даёт
  // нужный приоритет: exact match первым.
  //
  // Примечания:
  //  - `channel = $2` учитывает ТОЛЬКО когда $2 не NULL.  `channel IS NULL`
  //    — отдельный fallback-кандидат.  WHERE ниже пропускает обоих.
  //  - locale: или exact, или 'ru' как базовый.
  //  - is_active = TRUE: отключённые шаблоны не используются.
  const { rows } = await db.query(
    `SELECT template_key, channel, locale, subject, body, url_template
       FROM notification_templates_v2
      WHERE template_key = $1
        AND is_active = TRUE
        AND (channel = $2 OR channel IS NULL)
        AND (locale = $3 OR locale = 'ru')
      ORDER BY
        CASE WHEN channel = $2 THEN 0 ELSE 1 END ASC,
        CASE WHEN locale  = $3 THEN 0 ELSE 1 END ASC
      LIMIT 1`,
    [templateKey, channel, locale],
  );

  const tpl = rows[0];
  if (!tpl) throw new TemplateNotFoundError(templateKey, channel, locale);

  return {
    subject: tpl.subject ? interpolate(tpl.subject, variables) : null,
    body: interpolate(tpl.body, variables),
    url: tpl.url_template ? interpolate(tpl.url_template, variables) : null,
    templateKey: tpl.template_key,
    channel: tpl.channel,
    locale: tpl.locale,
  };
}

/**
 * listTemplates — admin-view всех шаблонов объекта.  Для будущего
 * template-editor UI (Phase 7+).  Здесь экспортируется сразу, чтобы route
 * /api/v1/notification-templates мог его использовать без дублирования SQL.
 *
 * @param {{query: Function}} db
 * @param {Object} [filters]
 * @param {?string} [filters.templateKey]
 * @param {?boolean} [filters.isActive]
 */
async function listTemplates(db, filters = {}) {
  const where = [];
  const params = [];
  if (filters.templateKey) {
    params.push(filters.templateKey);
    where.push(`template_key = $${params.length}`);
  }
  if (typeof filters.isActive === 'boolean') {
    params.push(filters.isActive);
    where.push(`is_active = $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { rows } = await db.query(
    `SELECT id, template_key, channel, locale, subject, body, url_template,
            description, is_active, created_at, updated_at
       FROM notification_templates_v2
       ${whereSql}
       ORDER BY template_key ASC, locale ASC, channel NULLS FIRST`,
    params,
  );
  return rows;
}

/**
 * getTemplateById — admin-view одного шаблона.
 * @param {{query: Function}} db
 * @param {string} id UUID
 */
async function getTemplateById(db, id) {
  if (typeof id !== 'string' || !UUID_RE.test(id)) return null;
  const { rows } = await db.query(
    `SELECT id, template_key, channel, locale, subject, body, url_template,
            description, is_active, created_at, updated_at
       FROM notification_templates_v2
      WHERE id = $1`,
    [id],
  );
  return rows[0] || null;
}

module.exports = {
  renderTemplate,
  interpolate,
  listTemplates,
  getTemplateById,
  TemplateNotFoundError,
};
