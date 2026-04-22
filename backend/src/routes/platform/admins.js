'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { getPlatformDb } = require('../../db');
const logger = require('../../logger');
const platformAuth = require('../../middleware/platformAuth');

const router = express.Router();
router.use(platformAuth);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Helper: log an audit entry (fire-and-forget)
function auditLog({ adminId, action, ipAddress, details = null }) {
  getPlatformDb()
    .query(
      `INSERT INTO platform_audit_log (admin_id, action, details, ip_address)
       VALUES ($1, $2, $3, $4)`,
      [adminId, action, details ? JSON.stringify(details) : null, ipAddress],
    )
    .catch((err) => logger.warn({ err, action }, '[platform/admins] audit log write failed'));
}

// GET /platform/api/v1/admins
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await getPlatformDb().query(
      `SELECT id, email, name, is_active, last_login_at, created_at
       FROM platform_admins
       ORDER BY created_at`,
    );
    return res.json({ admins: rows });
  } catch (err) {
    next(err);
  }
});

// POST /platform/api/v1/admins
router.post('/', async (req, res, next) => {
  try {
    const { email, password, name } = req.body || {};

    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'A valid email address is required' },
      });
    }

    if (!password || password.length < 12) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Password must be at least 12 characters' },
      });
    }

    if (!name) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'name is required' },
      });
    }

    const platformDb = getPlatformDb();
    const normalizedEmail = email.toLowerCase().trim();

    // Check email uniqueness
    const { rows: existing } = await platformDb.query(
      'SELECT id FROM platform_admins WHERE email = $1',
      [normalizedEmail],
    );
    if (existing.length) {
      return res.status(409).json({
        error: { code: 'EMAIL_EXISTS', message: `An admin with email '${normalizedEmail}' already exists` },
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const { rows } = await platformDb.query(
      `INSERT INTO platform_admins (email, password_hash, name)
       VALUES ($1, $2, $3)
       RETURNING id, email, name, is_active, created_at`,
      [normalizedEmail, passwordHash, name],
    );

    const admin = rows[0];

    auditLog({
      adminId: req.platformAdmin.id,
      action: 'admin.created',
      ipAddress: req.ip,
      details: { createdAdminId: admin.id, email: normalizedEmail },
    });

    logger.info({ adminId: admin.id, email: normalizedEmail }, '[platform/admins] admin created');

    return res.status(201).json({ admin });
  } catch (err) {
    next(err);
  }
});

// PATCH /platform/api/v1/admins/:id/deactivate
router.patch('/:id/deactivate', async (req, res, next) => {
  try {
    const { id } = req.params;

    // Cannot deactivate self
    if (req.platformAdmin.id === id) {
      return res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'You cannot deactivate your own account' },
      });
    }

    const platformDb = getPlatformDb();

    const { rows } = await platformDb.query(
      'UPDATE platform_admins SET is_active = false WHERE id = $1 RETURNING id, email, name',
      [id],
    );

    if (!rows.length) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: `Admin '${id}' not found` },
      });
    }

    auditLog({
      adminId: req.platformAdmin.id,
      action: 'admin.deactivated',
      ipAddress: req.ip,
      details: { deactivatedAdminId: id },
    });

    logger.info({ targetAdminId: id, byAdminId: req.platformAdmin.id }, '[platform/admins] admin deactivated');

    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
