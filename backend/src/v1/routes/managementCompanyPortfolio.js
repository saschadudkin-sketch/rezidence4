'use strict';

// DH-36 /api/v1/management-company/portfolio.
// Route stays thin: auth, query validation, current-company scope resolution;
// aggregation and tenant fan-out live in services/managementCompanyPortfolio.js.

const express = require('express');
const { getPlatformDb } = require('../../db');
const logger = require('../../logger');
const requireAuth = require('../../middleware/auth');
const { requireCapability } = require('../lib/authz');
const { parsePeriod } = require('../services/operationsDashboard');
const {
  getManagementCompanyPortfolio,
} = require('../services/managementCompanyPortfolio');

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$/;

function parsePropertySlugFilter(query) {
  const raw = query.property_slug ?? query.property_slugs;
  if (raw === undefined || raw === null || raw === '') return [];

  const values = (Array.isArray(raw) ? raw : [raw])
    .flatMap((value) => String(value).split(','))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  const invalid = values.find((value) => !SLUG_RE.test(value));
  if (invalid) {
    const err = new Error('property_slug has invalid format');
    err.statusCode = 400;
    err.code = 'INVALID_PROPERTY_SLUG';
    throw err;
  }

  return [...new Set(values)];
}

function parseBooleanFilter(raw, fieldName) {
  if (raw === undefined || raw === null || raw === '') return false;
  const value = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes'].includes(value)) return true;
  if (['0', 'false', 'no'].includes(value)) return false;
  const err = new Error(`${fieldName} must be boolean`);
  err.statusCode = 400;
  err.code = 'INVALID_BOOLEAN';
  throw err;
}

function resolveManagementCompanyId(req) {
  return req.property?.management_company_id
    || req.property?.managementCompanyId
    || req.user?.management_company_id
    || req.user?.managementCompanyId
    || null;
}

function createRouter(deps = {}) {
  const {
    getPlatformDb: resolvePlatformDb = getPlatformDb,
    getPortfolio = getManagementCompanyPortfolio,
    authMiddleware = requireAuth,
    routeLogger = logger,
  } = deps;

  const router = express.Router();
  router.use(authMiddleware);

  const requirePortfolioRead = requireCapability(
    'portfolio.dashboard.read',
    { message: 'Management company admin only' },
  );

  router.get('/', requirePortfolioRead, async (req, res) => {
    let period;
    let propertySlugs;
    let includeInactive;
    try {
      period = parsePeriod(req.query.period);
      propertySlugs = parsePropertySlugFilter(req.query);
      includeInactive = parseBooleanFilter(req.query.include_inactive, 'include_inactive');
    } catch (err) {
      return res.status(err.statusCode || 400).json({
        ok: false,
        code: err.code || 'VALIDATION_ERROR',
        error: err.message || 'invalid portfolio query',
      });
    }

    const managementCompanyId = resolveManagementCompanyId(req);
    if (!managementCompanyId) {
      return res.status(400).json({
        ok: false,
        code: 'MANAGEMENT_COMPANY_REQUIRED',
        error: 'current property is not assigned to a management company',
      });
    }

    try {
      const portfolio = await getPortfolio({
        platformDb: resolvePlatformDb(),
        managementCompanyId,
        period,
        propertySlugs,
        includeInactive,
      });
      return res.json({ ok: true, portfolio });
    } catch (err) {
      if (err.statusCode && err.statusCode < 500) {
        return res.status(err.statusCode).json({
          ok: false,
          code: err.code || 'PORTFOLIO_ERROR',
          error: err.message,
          details: err.details || undefined,
        });
      }
      routeLogger.error({ err }, '[v1/management-company/portfolio] aggregation failed');
      return res.status(503).json({
        ok: false,
        code: 'PORTFOLIO_UNAVAILABLE',
        error: err.message || 'portfolio unavailable',
      });
    }
  });

  return router;
}

module.exports = createRouter();
module.exports.createRouter = createRouter;
