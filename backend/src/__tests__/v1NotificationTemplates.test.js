'use strict';

/**
 * Phase 6 (platform-v1) — notificationTemplates service unit tests.
 * Spec: docs/product/specs/platform-v1/notification-templates-v2-spec.md
 *
 * Pattern: mock pg client ({query}) with scripted responders, same helper style
 * как v1PackagesService.test.js.  No Postgres needed.
 *
 * Coverage:
 *   • interpolate()                    — {{var}}, {{#var}}..{{/var}}, {{^var}}..{{/var}}
 *   • renderTemplate                   — lookup, fallback priority, TemplateNotFoundError
 *   • renderTemplate + package.received tpl — строка точно как buildPackageReceivedBody (regression)
 *   • listTemplates                    — filters
 *   • getTemplateById                  — UUID guard, row shape
 */

const { describe, test, expect } = require('@jest/globals');

const {
  renderTemplate,
  interpolate,
  listTemplates,
  getTemplateById,
  TemplateNotFoundError,
} = require('../v1/services/notificationTemplates');

const UUID = '11111111-2222-3333-4444-555555555555';

// Минимальный pg-like db mock с декларативными responders.  Первый responder,
// matching sql substring, вызывается.  Остальные игнорируются.
function makeDb(responders = []) {
  const calls = [];
  return {
    calls,
    async query(sql, args) {
      calls.push({ sql, args });
      for (const [match, fn] of responders) {
        if (typeof match === 'string' && sql.includes(match)) return fn(sql, args);
        if (match instanceof RegExp && match.test(sql)) return fn(sql, args);
      }
      return { rows: [] };
    },
  };
}

// Стартовая копия package.received body из миграции 022 — используем для
// regression-тестов: гарантируем что рендер даёт тот же вывод, что прежний
// buildPackageReceivedBody в packages.js (удалён в Phase 6).
const PACKAGE_RECEIVED_BODY_TPL =
  'Посылка{{#sender_name}} от {{sender_name}}{{/sender_name}}' +
  '{{#carrier}} ({{carrier}}){{/carrier}}' +
  '{{#storage_location}} — хранение: {{storage_location}}{{/storage_location}}' +
  '{{^storage_location}} ожидает на ресепшн.{{/storage_location}}';

// ══════════════════════════════════════════════════════════════════════════════
// interpolate — template engine primitive
// ══════════════════════════════════════════════════════════════════════════════

describe('interpolate', () => {
  test('simple {{var}} substitution', () => {
    expect(interpolate('hello {{name}}', { name: 'World' })).toBe('hello World');
  });

  test('missing var → empty string', () => {
    expect(interpolate('hello {{name}}', {})).toBe('hello ');
    expect(interpolate('hello {{name}}', { name: null })).toBe('hello ');
    expect(interpolate('hello {{name}}', { name: undefined })).toBe('hello ');
  });

  test('zero value → "0" string (not empty)', () => {
    expect(interpolate('count {{n}}', { n: 0 })).toBe('count 0');
  });

  test('truthy section {{#var}}..{{/var}} included when truthy', () => {
    expect(interpolate('{{#has}}yes{{/has}}', { has: true })).toBe('yes');
    expect(interpolate('{{#has}}yes{{/has}}', { has: 'X' })).toBe('yes');
    expect(interpolate('{{#has}}yes{{/has}}', { has: 0 })).toBe('');
    expect(interpolate('{{#has}}yes{{/has}}', { has: null })).toBe('');
    expect(interpolate('{{#has}}yes{{/has}}', {})).toBe('');
  });

  test('falsy section {{^var}}..{{/var}} included when falsy', () => {
    expect(interpolate('{{^has}}no{{/has}}', { has: true })).toBe('');
    expect(interpolate('{{^has}}no{{/has}}', {})).toBe('no');
    expect(interpolate('{{^has}}no{{/has}}', { has: '' })).toBe('no');
    expect(interpolate('{{^has}}no{{/has}}', { has: 0 })).toBe('no');
  });

  test('nested var inside section is interpolated', () => {
    expect(interpolate('{{#name}}hi {{name}}{{/name}}', { name: 'Ivan' }))
      .toBe('hi Ivan');
  });

  test('empty template → empty', () => {
    expect(interpolate('', { x: 'Y' })).toBe('');
  });

  test('non-string template → empty', () => {
    expect(interpolate(null, { x: 'Y' })).toBe('');
    expect(interpolate(undefined, { x: 'Y' })).toBe('');
  });

  test('multiple sections same key', () => {
    // Первое вхождение включается (truthy), второе (^) пропускается.
    expect(interpolate('{{#x}}A{{/x}}-{{^x}}B{{/x}}', { x: 1 })).toBe('A-');
    expect(interpolate('{{#x}}A{{/x}}-{{^x}}B{{/x}}', { x: 0 })).toBe('-B');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// renderTemplate — lookup + fallback + interpolation
// ══════════════════════════════════════════════════════════════════════════════

describe('renderTemplate', () => {
  test('throws on missing db', async () => {
    await expect(renderTemplate(null, 'x', {})).rejects.toThrow(/db.*query/);
    await expect(renderTemplate({}, 'x', {})).rejects.toThrow(/db.*query/);
  });

  test('throws on empty templateKey', async () => {
    await expect(renderTemplate(makeDb(), '', {})).rejects.toThrow(/templateKey/);
    await expect(renderTemplate(makeDb(), '   ', {})).rejects.toThrow(/templateKey/);
  });

  test('TemplateNotFoundError when no row', async () => {
    const db = makeDb([[/FROM notification_templates_v2/, () => ({ rows: [] })]]);
    try {
      await renderTemplate(db, 'nope', {});
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TemplateNotFoundError);
      expect(err.code).toBe('TEMPLATE_NOT_FOUND');
      expect(err.templateKey).toBe('nope');
    }
  });

  test('renders subject / body / url with interpolation', async () => {
    const db = makeDb([[/FROM notification_templates_v2/, () => ({
      rows: [{
        template_key: 'package.received',
        channel: null,
        locale: 'ru',
        subject: 'Посылка для {{package_id}}',
        body: 'Тело: {{sender_name}}',
        url_template: '/packages/{{package_id}}',
      }],
    })]]);
    const out = await renderTemplate(db, 'package.received', {
      package_id: 'PKG123',
      sender_name: 'Иван',
    });
    expect(out.subject).toBe('Посылка для PKG123');
    expect(out.body).toBe('Тело: Иван');
    expect(out.url).toBe('/packages/PKG123');
    expect(out.templateKey).toBe('package.received');
    expect(out.locale).toBe('ru');
  });

  test('null subject / url → null in output', async () => {
    const db = makeDb([[/FROM notification_templates_v2/, () => ({
      rows: [{
        template_key: 'x', channel: null, locale: 'ru',
        subject: null, body: 'Только тело', url_template: null,
      }],
    })]]);
    const out = await renderTemplate(db, 'x', {});
    expect(out.subject).toBeNull();
    expect(out.body).toBe('Только тело');
    expect(out.url).toBeNull();
  });

  test('passes channel + locale to SQL filter', async () => {
    let capturedArgs = null;
    const db = makeDb([[/FROM notification_templates_v2/, (_sql, args) => {
      capturedArgs = args;
      return { rows: [{
        template_key: 'x', channel: 'sms', locale: 'en',
        subject: null, body: 'OK', url_template: null,
      }] };
    }]]);
    await renderTemplate(db, 'x', {}, { channel: 'sms', locale: 'en' });
    expect(capturedArgs).toEqual(['x', 'sms', 'en']);
  });

  test('fallback priority: SQL ORDER BY CASE works (unit-covered at SQL level)', async () => {
    // Этот тест проверяет, что ORDER BY отдаёт exact match первым — на уровне
    // вызова это значит, что мы просто берём rows[0], а порядок сортировки
    // делегирован PostgreSQL.  Здесь убеждаемся что мок возвращающий rows[]
    // с правильным «победителем» в [0] обрабатывается корректно.
    const db = makeDb([[/FROM notification_templates_v2/, () => ({
      rows: [
        // «выигравший» вариант (exact match) — pg сам выдаёт только 1 row из-за LIMIT 1,
        // моделируем это правилом: мок вернёт только 1 row.
        {
          template_key: 'x', channel: 'sms', locale: 'en',
          subject: 'SMS EN', body: 'SMS EN body', url_template: null,
        },
      ],
    })]]);
    const out = await renderTemplate(db, 'x', {}, { channel: 'sms', locale: 'en' });
    expect(out.channel).toBe('sms');
    expect(out.locale).toBe('en');
    expect(out.body).toBe('SMS EN body');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// regression: package.received body matches legacy buildPackageReceivedBody
// ══════════════════════════════════════════════════════════════════════════════

describe('package.received regression (Phase 6 behavior-preserving)', () => {
  const tplRow = {
    template_key: 'package.received', channel: null, locale: 'ru',
    subject: 'Вам посылка',
    body: PACKAGE_RECEIVED_BODY_TPL,
    url_template: '/packages/{{package_id}}',
  };
  const db = makeDb([[/FROM notification_templates_v2/, () => ({ rows: [tplRow] })]]);

  test('no sender/carrier/storage → "Посылка ожидает на ресепшн."', async () => {
    const out = await renderTemplate(db, 'package.received', {
      sender_name: null, carrier: null, storage_location: null, package_id: 'p1',
    });
    expect(out.body).toBe('Посылка ожидает на ресепшн.');
    expect(out.subject).toBe('Вам посылка');
    expect(out.url).toBe('/packages/p1');
  });

  test('sender + carrier, no storage → "Посылка от X (Y) ожидает на ресепшн."', async () => {
    const out = await renderTemplate(db, 'package.received', {
      sender_name: 'Иванов', carrier: 'CDEK', storage_location: null, package_id: 'p1',
    });
    expect(out.body).toBe('Посылка от Иванов (CDEK) ожидает на ресепшн.');
  });

  test('storage location present → "Посылка ... — хранение: Z"', async () => {
    const out = await renderTemplate(db, 'package.received', {
      sender_name: 'X', carrier: 'Y', storage_location: 'shelf-A', package_id: 'p1',
    });
    expect(out.body).toBe('Посылка от X (Y) — хранение: shelf-A');
  });

  test('carrier only, no sender', async () => {
    const out = await renderTemplate(db, 'package.received', {
      sender_name: null, carrier: 'CDEK', storage_location: null, package_id: 'p1',
    });
    expect(out.body).toBe('Посылка (CDEK) ожидает на ресепшн.');
  });

  test('sender only, no carrier', async () => {
    const out = await renderTemplate(db, 'package.received', {
      sender_name: 'Иванов', carrier: null, storage_location: null, package_id: 'p1',
    });
    expect(out.body).toBe('Посылка от Иванов ожидает на ресепшн.');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// listTemplates — admin view
// ══════════════════════════════════════════════════════════════════════════════

describe('listTemplates', () => {
  test('no filters → plain SELECT', async () => {
    const db = makeDb([[/FROM notification_templates_v2/, () => ({ rows: [{ id: UUID }] })]]);
    const rows = await listTemplates(db);
    expect(rows).toEqual([{ id: UUID }]);
    expect(db.calls[0].sql).toContain('ORDER BY template_key');
    expect(db.calls[0].args).toEqual([]);
  });

  test('template_key filter', async () => {
    const db = makeDb([[/FROM notification_templates_v2/, () => ({ rows: [] })]]);
    await listTemplates(db, { templateKey: 'package.received' });
    const { sql, args } = db.calls[0];
    expect(sql).toContain('template_key = $1');
    expect(args).toEqual(['package.received']);
  });

  test('is_active filter', async () => {
    const db = makeDb([[/FROM notification_templates_v2/, () => ({ rows: [] })]]);
    await listTemplates(db, { isActive: false });
    const { sql, args } = db.calls[0];
    expect(sql).toContain('is_active = $1');
    expect(args).toEqual([false]);
  });

  test('combined filters → $1 + $2', async () => {
    const db = makeDb([[/FROM notification_templates_v2/, () => ({ rows: [] })]]);
    await listTemplates(db, { templateKey: 'x', isActive: true });
    const { sql, args } = db.calls[0];
    expect(sql).toContain('template_key = $1');
    expect(sql).toContain('is_active = $2');
    expect(args).toEqual(['x', true]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// getTemplateById — UUID guard
// ══════════════════════════════════════════════════════════════════════════════

describe('getTemplateById', () => {
  test('null on non-UUID id (no query)', async () => {
    const db = makeDb();
    expect(await getTemplateById(db, 'not-a-uuid')).toBeNull();
    expect(db.calls.length).toBe(0);
  });

  test('null on miss', async () => {
    const db = makeDb([[/FROM notification_templates_v2/, () => ({ rows: [] })]]);
    expect(await getTemplateById(db, UUID)).toBeNull();
  });

  test('returns row on hit', async () => {
    const row = { id: UUID, template_key: 'x' };
    const db = makeDb([[/FROM notification_templates_v2/, () => ({ rows: [row] })]]);
    expect(await getTemplateById(db, UUID)).toEqual(row);
  });
});
