'use strict';

// platform-v1 SKUD integration routes — /api/v1/skud.
// DH-42 keeps HTTP thin: external providers post inbound events with a
// provider-specific secret, while authenticated admins can exercise pass sync.

const express = require('express');
const db = require('../../db');
const logger = require('../../logger');
const requireAuth = require('../../middleware/auth');
const { canInPropertyScope } = require('../lib/authz');
const {
  ingestProviderAccessEvent,
  isSkudIntegrationServiceError,
  syncPassAccess,
} = require('../services/skudIntegrationService');

const router = express.Router();
const getDb = (req) => req.db || db;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

function resolvePropertyId(req) {
  return req.property?.id || req.property?.property_id || req.body?.property_id || null;
}

function sendKnownError(res, err) {
  if (!isSkudIntegrationServiceError(err)) return false;
  res.status(err.status).json({ error: err.message });
  return true;
}

// External provider endpoint: no user session, authenticated by provider secret.
router.post('/providers/:providerConfigId/events', async (req, res, next) => {
  try {
    const propertyId = resolvePropertyId(req);
    const { providerConfigId } = req.params;
    if (!isValidUuid(propertyId)) return res.status(400).json({ error: 'property_id must be resolved' });
    if (!isValidUuid(providerConfigId)) return res.status(400).json({ error: 'Invalid provider config id' });

    const result = await ingestProviderAccessEvent(getDb(req), {
      propertyId,
      providerConfigId,
      rawEvent: req.body || {},
      providedSecret: req.headers['x-skud-secret'] || req.headers['x-integration-secret'] || null,
      requireSecret: true,
    });

    res.status(result.idempotent ? 200 : 201).json({
      idempotent: result.idempotent,
      normalized_event: result.normalized_event,
      integration_event: result.integration_event,
      visit_log: result.visit_log,
    });
  } catch (err) {
    if (sendKnownError(res, err)) return;
    logger.error({ err }, '[v1/skud] inbound event failed');
    next(err);
  }
});

router.use(requireAuth);

router.post('/providers/:providerConfigId/sync-pass', async (req, res, next) => {
  try {
    const propertyId = resolvePropertyId(req);
    const { providerConfigId } = req.params;
    const { pass_id: passId, action = 'provision' } = req.body || {};

    if (!isValidUuid(propertyId)) return res.status(400).json({ error: 'property_id must be resolved' });
    if (!isValidUuid(providerConfigId)) return res.status(400).json({ error: 'Invalid provider config id' });
    if (!isValidUuid(passId)) return res.status(400).json({ error: 'pass_id must be UUID' });
    if (!canInPropertyScope(req, 'access.policy.write', propertyId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const result = await syncPassAccess(getDb(req), {
      propertyId,
      providerConfigId,
      passId,
      action,
    });

    res.status(202).json({
      pass_id: result.pass.id,
      provider_config_id: result.provider_config.id,
      integration_event: result.integration_event,
    });
  } catch (err) {
    if (sendKnownError(res, err)) return;
    logger.error({ err }, '[v1/skud] sync-pass failed');
    next(err);
  }
});

module.exports = router;
