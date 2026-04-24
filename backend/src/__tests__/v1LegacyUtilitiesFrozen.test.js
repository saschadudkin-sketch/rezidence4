'use strict';

/**
 * v1LegacyUtilitiesFrozen.test.js — Phase 6 P4: проверяем, что четыре legacy-
 * модуля (meters/billing/bookings/chat) по умолчанию заморожены на платформе.
 *
 * Контракт:
 *   1. В регистре feature-flags есть ключ `legacy_utilities_enabled`
 *      с `default: false`.  Это инвариант — Замоскворечье го-лайвит с
 *      замороженными модулями, и любой случайный truthy-override на
 *      granular per-module flag не должен разморозить модуль.
 *   2. Middleware requireFeature('legacy_utilities_enabled') отвечает 404
 *      FEATURE_DISABLED, когда флаг явно false, и пропускает, когда true.
 *   3. registerApiRoutes.js обвязал /api/v1/chat, /api/v1/meter-readings,
 *      /api/v1/billing, /api/v1/spaces, /api/v1/bookings этим гейтом сверх
 *      любых существующих per-module requireFeature.
 *
 * Тесты не поднимают полный Express-app — нам нужен smoke-контракт, что
 * middleware и регистр согласованы.  Sanity на реальные маршруты — через
 * существующие endpoint-suites, которые прогоняются в составе backend suite.
 */

const { describe, test, expect } = require('@jest/globals');
const path = require('path');
const fs = require('fs');
const {
  FEATURE_FLAGS,
  resolveFlags,
} = require('../config/featureFlags');
const requireFeature = require('../middleware/requireFeature');

describe('legacy_utilities_enabled — flag-registry contract', () => {
  test('key exists in registry', () => {
    expect(FEATURE_FLAGS.legacy_utilities_enabled).toBeDefined();
  });

  test('default is false (frozen at platform-level until post-release)', () => {
    expect(FEATURE_FLAGS.legacy_utilities_enabled.default).toBe(false);
  });

  test('not locked — admin может разморозить per-property', () => {
    // Локаут означал бы "никогда нельзя включить", что ломает use case
    // BACKLOG §"разморозка" + единичных property с отдельным планом.
    expect(FEATURE_FLAGS.legacy_utilities_enabled.locked).not.toBe(true);
  });

  test('resolveFlags возвращает false когда свойство не задавало override', () => {
    const out = resolveFlags({});
    expect(out.legacy_utilities_enabled).toBe(false);
  });

  test('resolveFlags honours explicit true override от admin', () => {
    const out = resolveFlags({ legacy_utilities_enabled: true });
    expect(out.legacy_utilities_enabled).toBe(true);
  });
});

describe('requireFeature(\'legacy_utilities_enabled\') — middleware behaviour', () => {
  const gate = requireFeature('legacy_utilities_enabled');

  function runGate({ resolvedFlags }) {
    return new Promise((resolve) => {
      const req = { property: resolvedFlags ? { resolvedFlags } : null };
      const res = {
        statusCode: null,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; resolve({ res: this, nextCalled: false }); return this; },
      };
      const next = () => resolve({ res, nextCalled: true });
      gate(req, res, next);
    });
  }

  test('404 FEATURE_DISABLED когда legacy_utilities_enabled=false', async () => {
    const { res, nextCalled } = await runGate({
      resolvedFlags: { legacy_utilities_enabled: false },
    });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(404);
    expect(res.body.error.code).toBe('FEATURE_DISABLED');
    expect(res.body.error.message).toMatch(/legacy_utilities_enabled/);
  });

  test('next() когда legacy_utilities_enabled=true', async () => {
    const { nextCalled } = await runGate({
      resolvedFlags: { legacy_utilities_enabled: true },
    });
    expect(nextCalled).toBe(true);
  });

  test('next() при отсутствии property-контекста (platform routes)', async () => {
    // Platform-level endpoints не имеют property-resolver'а и должны проходить
    // без изменений — middleware это гарантирует.
    const { nextCalled } = await runGate({ resolvedFlags: null });
    expect(nextCalled).toBe(true);
  });
});

describe('registerApiRoutes.js wiring contract', () => {
  // Грубая, но дешёвая проверка: читаем сорц-файл и убеждаемся, что гейт
  // legacyUtilitiesGate применён к каждому замороженному модулю.  Это не
  // заменяет интеграционный тест, но ловит регресс «кто-то убрал гейт».
  const src = fs.readFileSync(
    path.resolve(__dirname, '../app/registerApiRoutes.js'),
    'utf8',
  );

  test('gate объявлен через requireFeature("legacy_utilities_enabled")', () => {
    expect(src).toMatch(/const\s+legacyUtilitiesGate\s*=\s*requireFeature\(['"]legacy_utilities_enabled['"]\)/);
  });

  test('/api/v1/chat проходит через gate', () => {
    expect(src).toMatch(/app\.use\(['"]\/api\/v1\/chat['"]\s*,\s*legacyUtilitiesGate/);
  });

  test('/api/v1/meter-readings проходит через gate', () => {
    expect(src).toMatch(/app\.use\(['"]\/api\/v1\/meter-readings['"]\s*,\s*legacyUtilitiesGate/);
  });

  test('/api/v1/billing проходит через gate', () => {
    expect(src).toMatch(/app\.use\(['"]\/api\/v1\/billing['"]\s*,\s*legacyUtilitiesGate/);
  });

  test('/api/v1/spaces проходит через gate', () => {
    expect(src).toMatch(/app\.use\(['"]\/api\/v1\/spaces['"]\s*,\s*legacyUtilitiesGate/);
  });

  test('/api/v1/bookings проходит через gate (и main, и root-mount)', () => {
    // Главный mount /api/v1/bookings
    expect(src).toMatch(/app\.use\(['"]\/api\/v1\/bookings['"]\s*,\s*legacyUtilitiesGate/);
    // Root mount для POST /spaces/:spaceId/bookings — тоже за гейтом
    expect(src).toMatch(/app\.use\(['"]\/api\/v1['"]\s*,\s*legacyUtilitiesGate\s*,\s*bookingsRouter\)/);
  });

  test('legacy /api/chat (deprecate) тоже за гейтом', () => {
    expect(src).toMatch(/app\.use\(['"]\/api\/chat['"]\s*,\s*deprecate\s*,\s*legacyUtilitiesGate/);
  });
});
