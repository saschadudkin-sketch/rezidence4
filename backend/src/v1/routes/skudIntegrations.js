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
  getProviderFailureDashboard,
  ingestProviderAccessEvent,
  isSkudIntegrationServiceError,
  listHardwareDevices,
  listHardwareManualControlEvents,
  recordFieldRolloutEvidence,
  recordHardwareManualControl,
  syncPassAccess,
  updateHardwareManualBoundary,
} = require('../services/skudIntegrationService');

const router = express.Router();
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

function sendKnownError(res, err) {
  if (isSkudIntegrationServiceError(err) || err?.name === 'GuardAuthorizedDeviceServiceError') {
    res.status(err.status).json({ error: err.message });
    return true;
  }
  return false;
}

function guardAuthorizedDevicesEnabled(req) {
  const flags = req.property?.resolvedFlags || req.property?.feature_flags || {};
  return flags.guard_authorized_devices === true;
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

router.get('/provider-failures', async (req, res, next) => {
  try {
    const propertyId = resolvePropertyId(req);
    if (!isValidUuid(propertyId)) return res.status(400).json({ error: 'property_id must be resolved' });
    if (!canInPropertyScope(req, 'hardware.device.read', propertyId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const dashboard = await getProviderFailureDashboard(getDb(req), {
      propertyId,
      windowHours: req.query.window_hours || req.query.windowHours || 24,
      limit: req.query.limit || 20,
    });
    res.json({ dashboard });
  } catch (err) {
    if (sendKnownError(res, err)) return;
    logger.error({ err }, '[v1/skud] provider failure dashboard failed');
    next(err);
  }
});

router.post('/field-rollout-evidence', async (req, res, next) => {
  try {
    const propertyId = resolvePropertyId(req);
    if (!isValidUuid(propertyId)) return res.status(400).json({ error: 'property_id must be resolved' });
    if (!canInPropertyScope(req, 'hardware.device.write', propertyId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const evidence = await recordFieldRolloutEvidence(getDb(req), {
      ...req.body,
      propertyId,
      actorUid: req.user?.uid || null,
    });
    res.status(201).json({ evidence });
  } catch (err) {
    if (sendKnownError(res, err)) return;
    logger.error({ err }, '[v1/skud] field rollout evidence failed');
    next(err);
  }
});

router.get('/hardware-devices', async (req, res, next) => {
  try {
    const propertyId = resolvePropertyId(req);
    if (!isValidUuid(propertyId)) return res.status(400).json({ error: 'property_id must be resolved' });
    if (!canInPropertyScope(req, 'hardware.device.read', propertyId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const providerConfigId = req.query.provider_config_id || null;
    const accessPointId = req.query.access_point_id || null;
    if (providerConfigId !== null && !isValidUuid(providerConfigId)) {
      return res.status(400).json({ error: 'provider_config_id must be UUID' });
    }
    if (accessPointId !== null && !isValidUuid(accessPointId)) {
      return res.status(400).json({ error: 'access_point_id must be UUID' });
    }

    const hardwareDevices = await listHardwareDevices(getDb(req), {
      propertyId,
      providerConfigId,
      accessPointId,
    });
    res.json({ hardware_devices: hardwareDevices });
  } catch (err) {
    if (sendKnownError(res, err)) return;
    logger.error({ err }, '[v1/skud] list hardware devices failed');
    next(err);
  }
});

router.patch('/hardware-devices/:hardwareDeviceId/boundary', async (req, res, next) => {
  try {
    const propertyId = resolvePropertyId(req);
    const { hardwareDeviceId } = req.params;
    if (!isValidUuid(propertyId)) return res.status(400).json({ error: 'property_id must be resolved' });
    if (!isValidUuid(hardwareDeviceId)) return res.status(400).json({ error: 'Invalid hardware device id' });
    if (!canInPropertyScope(req, 'hardware.device.write', propertyId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const result = await updateHardwareManualBoundary(getDb(req), {
      propertyId,
      hardwareDeviceId,
      ...req.body,
      actorUid: req.user?.uid || null,
      actorRole: req.user?.role || null,
      ipAddress: req.ip || null,
    });
    res.json(result);
  } catch (err) {
    if (sendKnownError(res, err)) return;
    logger.error({ err }, '[v1/skud] update hardware boundary failed');
    next(err);
  }
});

router.post('/hardware-devices/:hardwareDeviceId/manual-control', async (req, res, next) => {
  try {
    const propertyId = resolvePropertyId(req);
    const { hardwareDeviceId } = req.params;
    if (!isValidUuid(propertyId)) return res.status(400).json({ error: 'property_id must be resolved' });
    if (!isValidUuid(hardwareDeviceId)) return res.status(400).json({ error: 'Invalid hardware device id' });
    if (!canInPropertyScope(req, 'hardware.manual_control.execute', propertyId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const result = await recordHardwareManualControl(getDb(req), {
      propertyId,
      hardwareDeviceId,
      ...req.body,
      user: req.user,
      actorUid: req.user?.uid || null,
      actorRole: req.user?.role || null,
      ipAddress: req.ip || null,
      guardDeviceId: req.body?.guard_device_id || req.body?.guardDeviceId || req.headers['x-guard-device-id'] || null,
      deviceFingerprint: req.body?.device_fingerprint || req.body?.deviceFingerprint || req.headers['x-guard-device-fingerprint'] || null,
      enforceGuardAuthorizedDevice: guardAuthorizedDevicesEnabled(req),
    });
    res.status(201).json(result);
  } catch (err) {
    if (sendKnownError(res, err)) return;
    logger.error({ err }, '[v1/skud] manual hardware control failed');
    next(err);
  }
});

router.get('/hardware-devices/:hardwareDeviceId/manual-control-events', async (req, res, next) => {
  try {
    const propertyId = resolvePropertyId(req);
    const { hardwareDeviceId } = req.params;
    if (!isValidUuid(propertyId)) return res.status(400).json({ error: 'property_id must be resolved' });
    if (!isValidUuid(hardwareDeviceId)) return res.status(400).json({ error: 'Invalid hardware device id' });
    if (!canInPropertyScope(req, 'hardware.device.read', propertyId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const events = await listHardwareManualControlEvents(getDb(req), {
      propertyId,
      hardwareDeviceId,
      limit: req.query.limit,
    });
    res.json({ manual_control_events: events });
  } catch (err) {
    if (sendKnownError(res, err)) return;
    logger.error({ err }, '[v1/skud] list hardware manual control events failed');
    next(err);
  }
});

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
