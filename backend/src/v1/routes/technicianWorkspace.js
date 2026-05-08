'use strict';

// platform-v1 Technician Workspace API.
// Ticket: DH-27 Technician Workflow Backend.

const express = require('express');
const db = require('../../db');
const requireAuth = require('../../middleware/auth');
const { can } = require('../lib/authz');
const { parsePaginationParams, buildPageMeta } = require('../lib/pagination');
const {
  claimRequest,
  isTechnicianWorkspaceServiceError,
  listTechnicianQueue,
  loadTechnicianRequestDetail,
  resolveRequest,
  setWaitingStatus,
  startRequest,
} = require('../services/technicianWorkspaceService');

const router = express.Router();
router.use(requireAuth);

const getDb = (req) => req.db || db;

function requireTechnicianRead(req, res) {
  if (can(req.user, 'requests:technician_read')) return true;
  res.status(403).json({ error: 'Forbidden' });
  return false;
}

function requireTechnicianWork(req, res) {
  if (can(req.user, 'requests:technician_work')) return true;
  res.status(403).json({ error: 'Forbidden' });
  return false;
}

function sendKnownError(res, err) {
  if (!isTechnicianWorkspaceServiceError(err)) return false;
  res.status(err.status).json({ error: err.message });
  return true;
}

function parsePage(req, res) {
  try {
    return parsePaginationParams(req.query);
  } catch (err) {
    res.status(400).json({ error: err.message });
    return null;
  }
}

// GET /api/v1/technician-workspace/queue
router.get('/queue', async (req, res, next) => {
  try {
    if (!requireTechnicianRead(req, res)) return;
    const pagination = parsePage(req, res);
    if (!pagination) return;
    const result = await listTechnicianQueue(getDb(req), {
      user: req.user,
      filters: req.query,
      pagination,
    });
    res.json({
      requests: result.requests,
      total: result.total,
      page: buildPageMeta({ ...pagination, returnedCount: result.requests.length }),
    });
  } catch (err) {
    if (sendKnownError(res, err)) return;
    next(err);
  }
});

// GET /api/v1/technician-workspace/requests/:id
router.get('/requests/:id', async (req, res, next) => {
  try {
    if (!requireTechnicianRead(req, res)) return;
    res.json(await loadTechnicianRequestDetail(getDb(req), {
      user: req.user,
      requestId: req.params.id,
    }));
  } catch (err) {
    if (sendKnownError(res, err)) return;
    next(err);
  }
});

// POST /api/v1/technician-workspace/requests/:id/claim
router.post('/requests/:id/claim', async (req, res, next) => {
  try {
    if (!requireTechnicianWork(req, res)) return;
    const request = await claimRequest(getDb(req), {
      user: req.user,
      requestId: req.params.id,
    });
    res.json({ request });
  } catch (err) {
    if (sendKnownError(res, err)) return;
    next(err);
  }
});

// POST /api/v1/technician-workspace/requests/:id/start
// Also resumes waiting_* requests back to in_progress.
router.post('/requests/:id/start', async (req, res, next) => {
  try {
    if (!requireTechnicianWork(req, res)) return;
    const request = await startRequest(getDb(req), {
      user: req.user,
      requestId: req.params.id,
    });
    res.json({ request });
  } catch (err) {
    if (sendKnownError(res, err)) return;
    next(err);
  }
});

router.post('/requests/:id/resume', async (req, res, next) => {
  try {
    if (!requireTechnicianWork(req, res)) return;
    const request = await startRequest(getDb(req), {
      user: req.user,
      requestId: req.params.id,
    });
    res.json({ request });
  } catch (err) {
    if (sendKnownError(res, err)) return;
    next(err);
  }
});

// POST /api/v1/technician-workspace/requests/:id/waiting
router.post('/requests/:id/waiting', async (req, res, next) => {
  try {
    if (!requireTechnicianWork(req, res)) return;
    const request = await setWaitingStatus(getDb(req), {
      user: req.user,
      requestId: req.params.id,
      body: req.body,
    });
    res.json({ request });
  } catch (err) {
    if (sendKnownError(res, err)) return;
    next(err);
  }
});

// POST /api/v1/technician-workspace/requests/:id/resolve
router.post('/requests/:id/resolve', async (req, res, next) => {
  try {
    if (!requireTechnicianWork(req, res)) return;
    const request = await resolveRequest(getDb(req), {
      user: req.user,
      requestId: req.params.id,
      body: req.body,
    });
    res.json({ request });
  } catch (err) {
    if (sendKnownError(res, err)) return;
    next(err);
  }
});

module.exports = router;
