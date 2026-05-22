'use strict';

const express = require('express');
const db = require('../../db');
const requireAuth = require('../../middleware/auth');
const requireFeature = require('../../middleware/requireFeature');
const { canInPropertyScope } = require('../lib/authz');
const {
  createVideoProviderConfig,
  createVideoEvidenceReference,
  fetchAndAttachProviderEvidence,
  getVideoEvidenceReference,
  isVideoEvidenceServiceError,
  linkCameraVideoProvider,
  listAccessPointCameras,
  listVideoProviderConfigs,
  listIncidentVideoEvidence,
} = require('../services/videoEvidenceService');

const router = express.Router();
router.use(
  ['/video-evidence', '/video', '/access-incidents/:incidentId/video-evidence'],
  requireFeature('video_evidence'),
  requireAuth,
);

const getDb = (req) => req.db || db;

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

function requireVideoScope(req, res, capability, propertyId) {
  if (!canInPropertyScope(req, capability, propertyId)) {
    res.status(403).json({ error: 'Forbidden' });
    return false;
  }
  return true;
}

function sendServiceError(res, err) {
  if (!isVideoEvidenceServiceError(err)) return false;
  res.status(err.status).json({ error: err.message });
  return true;
}

router.get('/video-evidence/cameras', async (req, res, next) => {
  try {
    const propertyId = resolvePropertyId(req);
    if (!requireVideoScope(req, res, 'video.evidence.read', propertyId)) return;
    const cameras = await listAccessPointCameras(getDb(req), {
      propertyId,
      accessPointId: req.query.access_point_id || req.query.accessPointId || null,
    });
    res.json({ cameras });
  } catch (err) {
    if (sendServiceError(res, err)) return;
    next(err);
  }
});

router.get('/video/providers', async (req, res, next) => {
  try {
    const propertyId = resolvePropertyId(req);
    if (!requireVideoScope(req, res, 'video.provider.read', propertyId)) return;
    const providers = await listVideoProviderConfigs(getDb(req), {
      propertyId,
      status: req.query.status || null,
    });
    res.json({ providers });
  } catch (err) {
    if (sendServiceError(res, err)) return;
    next(err);
  }
});

router.post('/video/providers', async (req, res, next) => {
  try {
    const propertyId = resolvePropertyId(req);
    if (!requireVideoScope(req, res, 'video.provider.write', propertyId)) return;
    const provider = await createVideoProviderConfig(getDb(req), {
      propertyId,
      input: req.body || {},
      user: req.user,
    });
    res.status(201).json({ provider });
  } catch (err) {
    if (sendServiceError(res, err)) return;
    next(err);
  }
});

router.patch('/video/cameras/:cameraDeviceId/provider', async (req, res, next) => {
  try {
    const propertyId = resolvePropertyId(req);
    if (!requireVideoScope(req, res, 'video.provider.write', propertyId)) return;
    const result = await linkCameraVideoProvider(getDb(req), {
      propertyId,
      cameraDeviceId: req.params.cameraDeviceId,
      input: req.body || {},
      user: req.user,
      ipAddress: req.ip || null,
    });
    res.json(result);
  } catch (err) {
    if (sendServiceError(res, err)) return;
    next(err);
  }
});

router.get('/access-incidents/:incidentId/video-evidence', async (req, res, next) => {
  try {
    const propertyId = resolvePropertyId(req);
    if (!requireVideoScope(req, res, 'video.evidence.read', propertyId)) return;
    const evidence = await listIncidentVideoEvidence(getDb(req), {
      propertyId,
      incidentId: req.params.incidentId,
    });
    res.json({ evidence });
  } catch (err) {
    if (sendServiceError(res, err)) return;
    next(err);
  }
});

router.post('/access-incidents/:incidentId/video-evidence/fetch', async (req, res, next) => {
  try {
    const propertyId = resolvePropertyId(req);
    if (!requireVideoScope(req, res, 'video.evidence.write', propertyId)) return;
    const result = await fetchAndAttachProviderEvidence(getDb(req), {
      propertyId,
      incidentId: req.params.incidentId,
      input: req.body || {},
      user: req.user,
      ipAddress: req.ip || null,
    });
    res.status(201).json({ evidence: result.evidence });
  } catch (err) {
    if (sendServiceError(res, err)) return;
    next(err);
  }
});

router.post('/access-incidents/:incidentId/video-evidence', async (req, res, next) => {
  try {
    const propertyId = resolvePropertyId(req);
    if (!requireVideoScope(req, res, 'video.evidence.write', propertyId)) return;
    const result = await createVideoEvidenceReference(getDb(req), {
      propertyId,
      input: {
        ...(req.body || {}),
        access_incident_id: req.params.incidentId,
      },
      user: req.user,
      ipAddress: req.ip || null,
    });
    res.status(201).json({ evidence: result.evidence });
  } catch (err) {
    if (sendServiceError(res, err)) return;
    next(err);
  }
});

router.post('/video-evidence', async (req, res, next) => {
  try {
    const propertyId = resolvePropertyId(req);
    if (!requireVideoScope(req, res, 'video.evidence.write', propertyId)) return;
    const result = await createVideoEvidenceReference(getDb(req), {
      propertyId,
      input: req.body || {},
      user: req.user,
      ipAddress: req.ip || null,
    });
    res.status(201).json({ evidence: result.evidence });
  } catch (err) {
    if (sendServiceError(res, err)) return;
    next(err);
  }
});

router.get('/video-evidence/:id', async (req, res, next) => {
  try {
    const propertyId = resolvePropertyId(req);
    if (!requireVideoScope(req, res, 'video.evidence.read', propertyId)) return;
    const evidence = await getVideoEvidenceReference(getDb(req), {
      propertyId,
      evidenceId: req.params.id,
      user: req.user,
      ipAddress: req.ip || null,
    });
    res.json({ evidence });
  } catch (err) {
    if (sendServiceError(res, err)) return;
    next(err);
  }
});

module.exports = router;
