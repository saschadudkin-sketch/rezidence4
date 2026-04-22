'use strict';

const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { getPlatformDb } = require('../../db');
const logger = require('../../logger');
const platformAuth = require('../../middleware/platformAuth');

const router = express.Router();

// Helper: log an audit entry (fire-and-forget)
function auditLog({ adminId, action, ipAddress, propertyId = null, details = null }) {
  getPlatformDb()
    .query(
      `INSERT INTO platform_audit_log (admin_id, action, property_id, details, ip_address)
       VALUES ($1, $2, $3, $4, $5)`,
      [adminId, action, propertyId, details ? JSON.stringify(details) : null, ipAddress],
    )
    .catch((err) => logger.warn({ err, action }, '[platform/auth] audit log write failed'));
}

// POST /platform/api/v1/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'email and password are required' },
      });
    }

    const platformDb = getPlatformDb();
    const { rows } = await platformDb.query(
      'SELECT id, email, name, password_hash, is_active FROM platform_admins WHERE email = $1',
      [email.toLowerCase().trim()],
    );

    if (!rows.length) {
      return res.status(401).json({
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
      });
    }

    const admin = rows[0];

    const passwordValid = await bcrypt.compare(password, admin.password_hash);
    if (!passwordValid) {
      return res.status(401).json({
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
      });
    }

    if (!admin.is_active) {
      return res.status(403).json({
        error: { code: 'ACCOUNT_DISABLED', message: 'This account has been disabled' },
      });
    }

    const tokenPayload = { id: admin.id, email: admin.email, name: admin.name };
    const token = jwt.sign(tokenPayload, process.env.PLATFORM_JWT_SECRET, { expiresIn: '8h' });

    auditLog({ adminId: admin.id, action: 'admin.login', ipAddress: req.ip });

    logger.info({ adminId: admin.id, email: admin.email }, '[platform/auth] admin login');

    return res.json({
      token,
      admin: { id: admin.id, email: admin.email, name: admin.name },
    });
  } catch (err) {
    next(err);
  }
});

// POST /platform/api/v1/auth/logout
router.post('/logout', platformAuth, async (req, res, next) => {
  try {
    const { id: adminId } = req.platformAdmin;
    auditLog({ adminId, action: 'admin.logout', ipAddress: req.ip });
    logger.info({ adminId }, '[platform/auth] admin logout');
    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
