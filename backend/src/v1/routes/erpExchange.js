'use strict';

// platform-v1 ERP/1C exchange routes — /api/v1/erp.
// HTTP remains thin: service owns validation, mappings and sync job lifecycle.

const express = require('express');
const db = require('../../db');
const requireAuth = require('../../middleware/auth');
const { canInPropertyScope } = require('../lib/authz');
const {
  applyErpImport,
  createErpProviderConfig,
  exportErpDataset,
  getErpSyncJob,
  isErpExchangeServiceError,
  listErpProviderConfigs,
  previewErpImport,
} = require('../services/erpExchangeService');

const router = express.Router();
router.use(requireAuth);

const getDb = (req) => req.db || db;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

function resolvePropertyId(req) {
  return req.property?.id
    || req.property?.property_id
    || req.body?.property_id
    || req.body?.propertyId
    || req.query?.property_id
    || req.query?.propertyId
    || req.user?.property_id
    || req.user?.propertyId
    || null;
}

function requireErpScope(req, res, capability, propertyId) {
  if (!isValidUuid(propertyId)) {
    res.status(400).json({ error: 'property_id must be resolved' });
    return false;
  }
  if (!canInPropertyScope(req, capability, propertyId)) {
    res.status(403).json({ error: 'Forbidden' });
    return false;
  }
  return true;
}

function sendServiceError(res, err) {
  if (!isErpExchangeServiceError(err)) return false;
  res.status(err.status).json({ error: err.message });
  return true;
}

router.get('/providers', async (req, res, next) => {
  try {
    const propertyId = resolvePropertyId(req);
    if (!requireErpScope(req, res, 'erp.exchange.read', propertyId)) return;
    const providers = await listErpProviderConfigs(getDb(req), {
      propertyId,
      status: req.query.status || null,
    });
    res.json({ providers });
  } catch (err) {
    if (sendServiceError(res, err)) return;
    next(err);
  }
});

router.post('/providers', async (req, res, next) => {
  try {
    const propertyId = resolvePropertyId(req);
    if (!requireErpScope(req, res, 'erp.exchange.write', propertyId)) return;
    const provider = await createErpProviderConfig(getDb(req), {
      propertyId,
      input: req.body || {},
      user: req.user,
      ipAddress: req.ip || null,
    });
    res.status(201).json({ provider });
  } catch (err) {
    if (sendServiceError(res, err)) return;
    next(err);
  }
});

router.post('/providers/:providerConfigId/import/preview', async (req, res, next) => {
  try {
    const propertyId = resolvePropertyId(req);
    if (!requireErpScope(req, res, 'erp.exchange.import', propertyId)) return;
    if (!isValidUuid(req.params.providerConfigId)) {
      return res.status(400).json({ error: 'Invalid provider config id' });
    }
    const result = await previewErpImport(getDb(req), {
      propertyId,
      providerConfigId: req.params.providerConfigId,
      input: req.body || {},
      user: req.user,
      ipAddress: req.ip || null,
    });
    return res.status(202).json(result);
  } catch (err) {
    if (sendServiceError(res, err)) return;
    return next(err);
  }
});

router.post('/providers/:providerConfigId/import/apply', async (req, res, next) => {
  try {
    const propertyId = resolvePropertyId(req);
    if (!requireErpScope(req, res, 'erp.exchange.import', propertyId)) return;
    if (!isValidUuid(req.params.providerConfigId)) {
      return res.status(400).json({ error: 'Invalid provider config id' });
    }
    const result = await applyErpImport(getDb(req), {
      propertyId,
      providerConfigId: req.params.providerConfigId,
      input: req.body || {},
      user: req.user,
      ipAddress: req.ip || null,
    });
    return res.status(202).json(result);
  } catch (err) {
    if (sendServiceError(res, err)) return;
    return next(err);
  }
});

router.post('/providers/:providerConfigId/export', async (req, res, next) => {
  try {
    const propertyId = resolvePropertyId(req);
    if (!requireErpScope(req, res, 'erp.exchange.export', propertyId)) return;
    if (!isValidUuid(req.params.providerConfigId)) {
      return res.status(400).json({ error: 'Invalid provider config id' });
    }
    const result = await exportErpDataset(getDb(req), {
      propertyId,
      providerConfigId: req.params.providerConfigId,
      input: req.body || {},
      user: req.user,
      ipAddress: req.ip || null,
    });
    return res.status(202).json(result);
  } catch (err) {
    if (sendServiceError(res, err)) return;
    return next(err);
  }
});

router.get('/sync-jobs/:syncJobId', async (req, res, next) => {
  try {
    const propertyId = resolvePropertyId(req);
    if (!requireErpScope(req, res, 'erp.exchange.read', propertyId)) return;
    if (!isValidUuid(req.params.syncJobId)) {
      return res.status(400).json({ error: 'Invalid sync job id' });
    }
    const result = await getErpSyncJob(getDb(req), {
      propertyId,
      syncJobId: req.params.syncJobId,
    });
    return res.json(result);
  } catch (err) {
    if (sendServiceError(res, err)) return;
    return next(err);
  }
});

module.exports = router;
