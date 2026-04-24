'use strict';

// platform-v1 superadmin — cross-tenant notifications outbox dashboard.
// Spec: notifications-outbox-spec.md §4.5 (в части «platform-wide introspection»).
//
// Зачем отдельная ручка (а не расширение per-tenant endpoint'а):
//   Per-tenant health хорош для админа одного ЖК, но не решает задачу on-call
//   инженера платформы: «на всех ли ЖК outbox работает? где висит reaper?
//   какая очередь глубже всего?».  Superadmin эндпоинт смотрит на ВСЕ
//   активные properties одновременно — пулим platform registry, пробегаем
//   per-tenant health и возвращаем: per-tenant snapshot + rollup + errors[].
//
// Поведение при частичных сбоях:
//   Один кривой pool НЕ должен ронять весь ответ.  Per-tenant try/catch:
//     - успех → `tenants[i] = { slug, counts, stuck_in_flight, age }`
//     - ошибка → `tenants[i] = { slug, error: '...' }` + попадает в errors_count
//   Ответ всегда 200, пока жив сам platform DB.  platform DB упал →
//   listActiveProperties reject → 503 (это настоящая blackbox-paging
//   ситуация — без platform registry мы не можем даже оценить scope).
//
// Безопасность:
//   - platformAuth middleware проверяет PLATFORM_JWT_SECRET bearer token.
//   - Никакой теnант-скоп req.db — все пулы берутся через getPropertyPool.
//   - Не логируем content payload'ов, только counts и slug'и — outbox_rows
//     могут содержать PII (номера, email'ы residents).

const express = require('express');
const platformAuth = require('../../middleware/platformAuth');
const { getPlatformDb } = require('../../db');
const { getPropertyPool } = require('../../middleware/propertyDb');
const { listActiveProperties } = require('../../v1/workers/outboxRunner');
const { fetchTenantOutboxHealth, aggregateSnapshots } = require('../../v1/services/outboxHealth');
const { isOutboxEnabled } = require('../../v1/services/notificationOutbox');
const defaultLogger = require('../../logger');

/**
 * createRouter — фабрика с DI.
 *
 * В проде все deps по умолчанию резолвятся из production-модулей.  В тестах
 * передаём моки напрямую, не трогая require-кэш — это чище, чем jest.mock на
 * четыре модуля сразу.
 *
 * @param {object} [deps]
 * @param {Function} [deps.getPlatformDb]   () => pg Pool (platform registry)
 * @param {Function} [deps.getPropertyPool] (property) => pg Pool (per-tenant)
 * @param {Function} [deps.listActiveProperties] (platformDb) => Promise<property[]>
 * @param {Function} [deps.fetchTenantOutboxHealth] (pool) => Promise<snapshot>
 * @param {object}   [deps.logger]
 */
function createRouter(deps = {}) {
  const {
    getPlatformDb:       _getPlatformDb       = getPlatformDb,
    getPropertyPool:     _getPropertyPool     = getPropertyPool,
    listActiveProperties: _listActiveProperties = listActiveProperties,
    fetchTenantOutboxHealth: _fetchTenant     = fetchTenantOutboxHealth,
    platformAuth:        _platformAuth        = platformAuth,
    logger               = defaultLogger,
  } = deps;

  const router = express.Router();
  router.use(_platformAuth);

  // GET /platform/api/v1/notifications/outbox/health
  router.get('/', async (_req, res) => {
    let properties;
    try {
      properties = await _listActiveProperties(_getPlatformDb());
    } catch (err) {
      // Platform registry недоступна — без него невозможно даже перечислить
      // tenants, поэтому 503.  Не next(err): у /platform-ручек есть
      // собственный контракт (см. остальные routes/platform/*).
      logger.error({ err }, '[platform-outbox-health] platform registry query failed');
      return res.status(503).json({
        ok: false,
        error: err && err.message ? err.message : 'platform registry unavailable',
      });
    }

    // Параллельно опрашиваем все tenants.  Promise.allSettled не даёт
    // одному падению зарубить всех остальных, и экономит ~(N-1)×RTT
    // по сравнению с последовательным for-of.
    const results = await Promise.allSettled(
      properties.map(async (p) => {
        const pool = _getPropertyPool(p);
        const snapshot = await _fetchTenant(pool);
        return { slug: p.slug, ...snapshot };
      }),
    );

    const tenants = [];
    let errorsCount = 0;
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const slug = properties[i].slug;
      if (r.status === 'fulfilled') {
        tenants.push(r.value);
      } else {
        errorsCount++;
        logger.error(
          { err: r.reason && r.reason.message, slug },
          '[platform-outbox-health] tenant query failed',
        );
        tenants.push({ slug, error: r.reason && r.reason.message || String(r.reason) });
      }
    }

    // rollup — суммы counts + max возраста.  Ошибочные tenants исключаются
    // (их нечего суммировать, мы о них знаем из errors_count).
    const rollup = aggregateSnapshots(tenants);

    return res.json({
      ok: true,
      feature_enabled: isOutboxEnabled(),
      tenants_total:   properties.length,
      errors_count:    errorsCount,
      rollup,
      tenants,
      ts: new Date().toISOString(),
    });
  });

  return router;
}

module.exports = createRouter();
module.exports.createRouter = createRouter;
