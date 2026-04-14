'use strict';

const express = require('express');
const requireAuth = require('../middleware/auth');
const { serializeStatusTransitions } = require('../services/RequestsService');

const router = express.Router();

router.use(requireAuth);

router.get('/status-transitions', (_req, res) => {
  res.json({
    roles: serializeStatusTransitions(),
    version: 1,
  });
});

module.exports = router;
