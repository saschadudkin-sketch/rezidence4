'use strict';

// DH-58 GIS ZhKH / OSS readiness routes.
// These endpoints produce export/readiness packages only; they do not perform
// certified GIS filing and do not implement legally significant OSS voting.

const express = require('express');
const db = require('../../db');
const requireAuth = require('../../middleware/auth');
const { canInPropertyScope } = require('../lib/authz');
const {
  buildGisOssExportArtifact,
  createGisOssExportPackage,
  getGisOssExportPackage,
  isGisOssReadinessServiceError,
  LEGAL_BOUNDARY_NOTICE,
  listGisOssExportPackages,
} = require('../services/gisOssReadinessService');

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

function requireScope(req, res, capability, propertyId) {
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

function sendKnownError(res, err) {
  if (!isGisOssReadinessServiceError(err)) return false;
  res.status(err.status).json({ error: err.message });
  return true;
}

router.get('/boundary', (req, res) => {
  res.json({
    legally_authoritative: false,
    certified_submission: false,
    notice: LEGAL_BOUNDARY_NOTICE,
    out_of_scope: [
      'legally_significant_electronic_oss_voting',
      'certified_gis_zhkh_filing',
    ],
  });
});

router.get('/export-packages', async (req, res, next) => {
  try {
    const propertyId = resolvePropertyId(req);
    if (!requireScope(req, res, 'gis_oss.readiness.read', propertyId)) return;

    const packages = await listGisOssExportPackages(getDb(req), {
      propertyId,
      packageType: req.query.package_type || null,
      limit: req.query.limit,
    });
    res.json({
      export_packages: packages,
      boundary_notice: LEGAL_BOUNDARY_NOTICE,
    });
  } catch (err) {
    if (sendKnownError(res, err)) return;
    next(err);
  }
});

router.post('/export-packages', async (req, res, next) => {
  try {
    const propertyId = resolvePropertyId(req);
    if (!requireScope(req, res, 'gis_oss.readiness.export', propertyId)) return;

    const result = await createGisOssExportPackage(getDb(req), {
      propertyId,
      input: req.body || {},
      user: req.user,
      ipAddress: req.ip || null,
    });
    res.status(201).json(result);
  } catch (err) {
    if (sendKnownError(res, err)) return;
    next(err);
  }
});

router.get('/export-packages/:packageId/artifact', async (req, res, next) => {
  try {
    const propertyId = resolvePropertyId(req);
    if (!requireScope(req, res, 'gis_oss.readiness.read', propertyId)) return;
    if (!isValidUuid(req.params.packageId)) {
      return res.status(400).json({ error: 'Invalid export package id' });
    }

    const exportPackage = await getGisOssExportPackage(getDb(req), {
      propertyId,
      packageId: req.params.packageId,
    });
    const artifact = buildGisOssExportArtifact(exportPackage);
    res.setHeader('Content-Type', `${artifact.content_type}; charset=utf-8`);
    res.setHeader('Content-Disposition', `attachment; filename="${artifact.filename}"`);
    res.setHeader('X-Artifact-Sha256', artifact.sha256);
    return res.send(`${artifact.serialized}\n`);
  } catch (err) {
    if (sendKnownError(res, err)) return;
    return next(err);
  }
});

router.get('/export-packages/:packageId', async (req, res, next) => {
  try {
    const propertyId = resolvePropertyId(req);
    if (!requireScope(req, res, 'gis_oss.readiness.read', propertyId)) return;
    if (!isValidUuid(req.params.packageId)) {
      return res.status(400).json({ error: 'Invalid export package id' });
    }

    const exportPackage = await getGisOssExportPackage(getDb(req), {
      propertyId,
      packageId: req.params.packageId,
    });
    return res.json({
      export_package: exportPackage,
      payload: exportPackage.export_payload,
      boundary_notice: LEGAL_BOUNDARY_NOTICE,
    });
  } catch (err) {
    if (sendKnownError(res, err)) return;
    return next(err);
  }
});

module.exports = router;
