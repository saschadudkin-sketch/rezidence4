'use strict';

// platform-v1 Staff Workspace API.
// Ticket: DH-25 Staff Workspace API.

const express = require('express');
const db = require('../../db');
const requireAuth = require('../../middleware/auth');
const { can } = require('../lib/authz');
const { parsePaginationParams, buildPageMeta } = require('../lib/pagination');
const {
  createInternalComment,
  getResidentQuickView,
  isStaffWorkspaceServiceError,
  listInbox,
  loadRequestDetail,
} = require('../services/staffWorkspaceService');

const router = express.Router();
router.use(requireAuth);

const getDb = (req) => req.db || db;

function requireWorkspaceRead(req, res) {
  if (can(req.user, 'requests:read')) return true;
  res.status(403).json({ error: 'Forbidden' });
  return false;
}

function requireWorkspaceWrite(req, res) {
  if (can(req.user, 'requests:write')) return true;
  res.status(403).json({ error: 'Forbidden' });
  return false;
}

function sendKnownError(res, err) {
  if (!isStaffWorkspaceServiceError(err)) return false;
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

// GET /api/v1/staff-workspace/inbox?queue=&status=&category=&...
router.get('/inbox', async (req, res, next) => {
  try {
    if (!requireWorkspaceRead(req, res)) return;
    const pagination = parsePage(req, res);
    if (!pagination) return;
    const result = await listInbox(getDb(req), {
      user: req.user,
      filters: req.query,
      pagination,
    });
    res.json({
      requests: result.requests,
      total: result.total,
      page: buildPageMeta({ ...pagination, returnedCount: result.requests.length }),
      property: req.property ? {
        id: req.property.id || req.property.property_id || null,
        slug: req.property.slug || null,
        type: req.property.property_type || req.property.type || null,
      } : null,
    });
  } catch (err) {
    if (sendKnownError(res, err)) return;
    next(err);
  }
});

// GET /api/v1/staff-workspace/overdue
router.get('/overdue', async (req, res, next) => {
  try {
    if (!requireWorkspaceRead(req, res)) return;
    const pagination = parsePage(req, res);
    if (!pagination) return;
    const result = await listInbox(getDb(req), {
      user: req.user,
      filters: { ...req.query, queue: 'overdue' },
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

// GET /api/v1/staff-workspace/requests/:id
router.get('/requests/:id', async (req, res, next) => {
  try {
    if (!requireWorkspaceRead(req, res)) return;
    res.json(await loadRequestDetail(getDb(req), req.params.id));
  } catch (err) {
    if (sendKnownError(res, err)) return;
    next(err);
  }
});

// POST /api/v1/staff-workspace/requests/:id/internal-comments
router.post('/requests/:id/internal-comments', async (req, res, next) => {
  try {
    if (!requireWorkspaceWrite(req, res)) return;
    const comment = await createInternalComment(getDb(req), {
      user: req.user,
      requestId: req.params.id,
      body: req.body,
    });
    res.status(201).json({ comment });
  } catch (err) {
    if (sendKnownError(res, err)) return;
    next(err);
  }
});

// GET /api/v1/staff-workspace/residents/:id/quick-view
router.get('/residents/:id/quick-view', async (req, res, next) => {
  try {
    if (!requireWorkspaceRead(req, res)) return;
    const quickView = await getResidentQuickView(getDb(req), {
      residentId: req.params.id,
      canViewPhone: can(req.user, 'residents:read_phone'),
    });
    res.json(quickView);
  } catch (err) {
    if (sendKnownError(res, err)) return;
    next(err);
  }
});

module.exports = router;
