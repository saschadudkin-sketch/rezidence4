'use strict';

/**
 * routes/publicPass.js - public guest pass lookup.
 *
 * GET /:token is unauthenticated and rate-limited by registerApiRoutes.
 * The route delegates projection and credential decisions to the v1 service so
 * the public route stays a compatibility shell.
 */

const express = require('express');
const {
  getPublicPassByToken,
  publicLegacyPass,
  publicV1Pass,
} = require('../v1/services/publicPassService');

const router = express.Router();

const TOKEN_RE = /^[0-9a-f]{32}(?:[0-9a-f]{32})?$/i;

function notFound(res) {
  return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pass not found' } });
}

function validateToken(req, res, next) {
  if (!TOKEN_RE.test(String(req.params.token || ''))) return notFound(res);
  next();
}

router.get('/:token', validateToken, async (req, res, next) => {
  try {
    const pass = await getPublicPassByToken({
      db: req.db,
      token: String(req.params.token),
      propertyName: req.property?.name || null,
    });
    if (!pass) return notFound(res);
    return res.json(pass);
  } catch (err) {
    return next(err);
  }
});

router.publicV1Pass = publicV1Pass;
router.publicLegacyPass = publicLegacyPass;
router.TOKEN_RE = TOKEN_RE;

module.exports = router;
