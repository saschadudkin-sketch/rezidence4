'use strict';

const express = require('express');
const { getPlatformDb } = require('../../db');
const platformAuth = require('../../middleware/platformAuth');

function createRouter(deps = {}) {
  const {
    getPlatformDb: _getPlatformDb = getPlatformDb,
    platformAuth: _platformAuth = platformAuth,
    now = () => new Date(),
  } = deps;

  const router = express.Router();
  router.use(_platformAuth);

  async function listProperties() {
    const platformDb = _getPlatformDb();
    const { rows } = await platformDb.query(
      `SELECT id, slug, name, is_active, plan
         FROM properties
        ORDER BY name`,
    );
    return rows;
  }

  router.get('/overview', async (_req, res, next) => {
    try {
      const properties = await listProperties();
      const active = properties.filter((property) => property.is_active === true);
      res.json({
        ok: true,
        overview: {
          generated_at: now().toISOString(),
          properties_total: properties.length,
          properties_active: active.length,
          properties_inactive: properties.length - active.length,
          plans: active.reduce((acc, property) => {
            const plan = property.plan || 'unknown';
            acc[plan] = (acc[plan] || 0) + 1;
            return acc;
          }, {}),
        },
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/incidents', async (_req, res, next) => {
    try {
      const properties = await listProperties();
      res.json({
        ok: true,
        generated_at: now().toISOString(),
        incidents: [],
        properties_total: properties.length,
        note: 'Cross-tenant incident details are exposed through per-property v1 APIs until portfolio aggregation is materialized.',
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/property-health', async (_req, res, next) => {
    try {
      const properties = await listProperties();
      res.json({
        ok: true,
        generated_at: now().toISOString(),
        properties: properties.map((property) => ({
          id: property.id,
          slug: property.slug,
          name: property.name,
          is_active: property.is_active === true,
          health: property.is_active === true ? 'active' : 'inactive',
          plan: property.plan || null,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = createRouter();
module.exports.createRouter = createRouter;
