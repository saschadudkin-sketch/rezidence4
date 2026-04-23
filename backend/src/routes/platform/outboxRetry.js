'use strict';

// platform-v1 superadmin — cross-tenant force-retry для notifications_outbox.
// Spec: notifications-outbox-spec.md §4.5 (operator escape-hatch, platform-wide).
//
// Принципиальное решение: superadmin retry всегда скоупится ОДНИМ tenant'ом
// через `property_slug` в body.  НЕ делаем «retry во всех tenants сразу» —
// это почти всегда не то, что нужно on-call'у: он диагностирует одну
// проблему (например, Telegram-адаптер упал на конкретном ЖК), и хочет
// конкретный fix, а не «реаним платформе».  Массовый revival по N tenants
// легко устраивается отдельным скриптом на стороне on-call'а.
//
// Response shape полностью совпадает с per-tenant ручкой + добавляем
// `property_slug` для аудита: superadmin логи отдельно, и нужно видеть,
// на каком ЖК был retry.

const express = require('express');
const platformAuth = require('../../middleware/platformAuth');
const { getPlatformDb } = require('../../db');
const { getPropertyPool } = require('../../middleware/propertyDb');
const { resurrectOutboxRows } = require('../../v1/services/outboxRetry');
const defaultLogger = require('../../logger');

/**
 * resolvePropertyBySlug — SELECT в platform registry по slug'у.  Возвращает
 * null, если property отсутствует или is_active=false.  is_active=false:
 * если УК отключили ЖК, retry должен быть осознанным actом (через
 * re-активацию в admin SPA), а не через skip-флаг в API.
 */
async function resolvePropertyBySlug(platformDb, slug) {
  const { rows } = await platformDb.query(
    `SELECT id, slug, db_connection_url
       FROM properties
      WHERE slug = $1 AND is_active = true
      LIMIT 1`,
    [slug],
  );
  return rows[0] || null;
}

function createRouter(deps = {}) {
  const {
    getPlatformDb:       _getPlatformDb       = getPlatformDb,
    getPropertyPool:     _getPropertyPool     = getPropertyPool,
    resolvePropertyBySlug: _resolvePropertyBySlug = resolvePropertyBySlug,
    resurrectOutboxRows: _resurrectOutboxRows = resurrectOutboxRows,
    platformAuth:        _platformAuth        = platformAuth,
    logger               = defaultLogger,
  } = deps;

  const router = express.Router();
  router.use(_platformAuth);

  // POST /platform/api/v1/notifications/outbox/retry
  //
  // Body:
  //   property_slug:  required — какой tenant реанимируем
  //   ids:            optional — точечный retry (max 1000)
  //   status:         optional — 'dead' | 'failed', для bulk
  //   limit:          optional — cap на bulk (default 100, hard 1000)
  router.post('/', async (req, res) => {
    const body = req.body || {};
    const slug = typeof body.property_slug === 'string' ? body.property_slug.trim() : '';
    if (!slug) {
      return res.status(400).json({ error: 'property_slug is required' });
    }

    let property;
    try {
      property = await _resolvePropertyBySlug(_getPlatformDb(), slug);
    } catch (err) {
      logger.error({ err, slug }, '[platform-outbox-retry] platform registry query failed');
      return res.status(503).json({
        ok: false,
        error: err && err.message ? err.message : 'platform registry unavailable',
      });
    }
    if (!property) {
      return res.status(404).json({ error: 'property not found or inactive' });
    }

    let pool;
    try {
      pool = _getPropertyPool(property);
    } catch (err) {
      logger.error({ err, slug }, '[platform-outbox-retry] getPropertyPool failed');
      return res.status(503).json({ ok: false, error: err.message });
    }

    try {
      const out = await _resurrectOutboxRows(pool, {
        ids:    body.ids,
        status: body.status,
        limit:  body.limit,
      });
      logger.info(
        {
          admin: req.platformAdmin && req.platformAdmin.id,
          property_slug: slug,
          revived: out.revived,
          mode: body.ids ? 'ids' : 'bulk',
        },
        '[platform-outbox-retry] rows revived',
      );
      return res.json({ ok: true, property_slug: slug, ...out });
    } catch (err) {
      if (err instanceof TypeError) {
        return res.status(400).json({ error: err.message });
      }
      logger.error({ err, slug }, '[platform-outbox-retry] update failed');
      return res.status(503).json({ ok: false, error: err.message });
    }
  });

  return router;
}

module.exports = createRouter();
module.exports.createRouter = createRouter;
module.exports.resolvePropertyBySlug = resolvePropertyBySlug;
