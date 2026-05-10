'use strict';

/**
 * routes/adminSettings.js — Property admin settings endpoints.
 *
 * Endpoints (admin role only, property context required):
 *
 *   GET  /api/v1/admin/feature-flags
 *     Returns the resolved boolean map for the current property:
 *       { chat: true, qr_pass: false, ... }
 *     Flat shape on purpose — the frontend merges it straight into its
 *     FeatureFlags state object.
 *
 *   GET  /api/v1/admin/feature-flags/schema
 *     Returns the registry metadata (labels, descriptions, categories,
 *     defaults, locked flags).  Stable JSON, no tenant data, safe to cache
 *     client-side.  The frontend calls this once on load and combines it
 *     with the values endpoint to render the admin toggles.
 *
 *   PATCH /api/v1/admin/feature-flags
 *     Merges provided boolean overrides into the property's feature_flags
 *     JSONB column, invalidates the property cache, logs the change to
 *     platform_audit_log, and returns the resolved boolean map (same shape
 *     as GET /feature-flags).
 *
 * Locked flags (FEATURE_FLAGS[key].locked === true) cannot be toggled — the
 * UI disables the row, the PATCH validator rejects the write with 422.
 *
 * Auth: requireAuth (JWT) + requireAdmin (role === 'admin'), both enforced here.
 */

const express = require('express');
const requireAuth = require('../middleware/auth');
const {
  FEATURE_FLAGS,
  resolveFlags,
  getPublicSchema,
  isFlagAllowedForPlan,
  normalizePlan,
} = require('../config/featureFlags');
const { invalidatePropertyCache } = require('../middleware/propertyDb');
const { getPlatformDb } = require('../db');
const logger = require('../logger');

const router = express.Router();

// ─── Auth guards ──────────────────────────────────────────────────────────────

router.use(requireAuth);

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'Admin access required' },
    });
  }
  next();
}

router.use(requireAdmin);

// ─── GET /feature-flags/schema ────────────────────────────────────────────────
//
// Registered BEFORE GET /feature-flags so Express doesn't treat 'schema' as a
// spurious path parameter.  The schema is tenant-agnostic — every caller
// receives the same payload regardless of req.propertySlug.

router.get('/feature-flags/schema', (_req, res) => {
  res.json(getPublicSchema());
});

// ─── GET /feature-flags ───────────────────────────────────────────────────────

router.get('/feature-flags', async (req, res, next) => {
  try {
    const slug = req.propertySlug;

    const platformDb = getPlatformDb();
    const { rows } = await platformDb.query(
      'SELECT id, slug, plan, feature_flags FROM properties WHERE slug = $1',
      [slug],
    );

    if (!rows.length) {
      return res.status(404).json({
        error: { code: 'PROPERTY_NOT_FOUND', message: `Property '${slug}' not found` },
      });
    }

    return res.json(resolveFlags(rows[0].feature_flags, rows[0].plan));
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /feature-flags ─────────────────────────────────────────────────────

router.patch('/feature-flags', async (req, res, next) => {
  try {
    const slug = req.propertySlug;
    const updates = req.body;

    // ── Validate input ────────────────────────────────────────────────────────

    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
      return res.status(400).json({
        error: { code: 'INVALID_BODY', message: 'Request body must be a JSON object of { flagName: boolean }' },
      });
    }

    const invalidKeys = Object.keys(updates).filter(k => !(k in FEATURE_FLAGS));
    if (invalidKeys.length) {
      return res.status(400).json({
        error: {
          code: 'UNKNOWN_FLAG',
          message: `Unknown feature flag(s): ${invalidKeys.join(', ')}`,
        },
      });
    }

    const nonBoolValues = Object.entries(updates).filter(([, v]) => typeof v !== 'boolean');
    if (nonBoolValues.length) {
      return res.status(400).json({
        error: {
          code: 'INVALID_FLAG_VALUE',
          message: `Flag values must be boolean. Invalid: ${nonBoolValues.map(([k]) => k).join(', ')}`,
        },
      });
    }

    // Locked flags (core features) cannot be toggled — refuse any attempt
    // rather than silently dropping the write.  Clients should filter these
    // out before the request, so a 422 here means UI drift.
    const lockedAttempts = Object.keys(updates).filter(k => FEATURE_FLAGS[k].locked);
    if (lockedAttempts.length) {
      return res.status(422).json({
        error: {
          code: 'LOCKED_FLAG',
          message: `Базовые функции нельзя отключить: ${lockedAttempts.join(', ')}`,
        },
      });
    }

    // ── Apply to DB ───────────────────────────────────────────────────────────

    const platformDb = getPlatformDb();

    // Fetch current stored flags (raw JSONB, not resolved)
    const { rows } = await platformDb.query(
      'SELECT id, plan, feature_flags FROM properties WHERE slug = $1',
      [slug],
    );

    if (!rows.length) {
      return res.status(404).json({
        error: { code: 'PROPERTY_NOT_FOUND', message: `Property '${slug}' not found` },
      });
    }

    const current = rows[0].feature_flags || {};
    const propertyId = rows[0].id;
    const plan = normalizePlan(rows[0].plan);

    const packageBlocked = Object.entries(updates)
      .filter(([, value]) => value === true)
      .map(([key]) => key)
      .filter((key) => !isFlagAllowedForPlan(key, plan));
    if (packageBlocked.length) {
      return res.status(422).json({
        error: {
          code: 'PACKAGE_GATE',
          message: `Package '${plan}' does not include: ${packageBlocked.join(', ')}`,
        },
      });
    }

    const newFlags = { ...current, ...updates };

    await platformDb.query(
      'UPDATE properties SET feature_flags = $1, updated_at = NOW() WHERE slug = $2',
      [JSON.stringify(newFlags), slug],
    );

    // Invalidate in-process cache so next request picks up the change immediately
    invalidatePropertyCache(slug);

    // ── Audit log ─────────────────────────────────────────────────────────────
    // admin_id is a platform_admins FK — property-level admins are not platform
    // admins, so store NULL and capture identity in details.
    try {
      await platformDb.query(
        `INSERT INTO platform_audit_log (admin_id, action, property_id, details, ip_address)
         VALUES (NULL, $1, $2, $3, $4)`,
        [
          'property.feature_flags_updated',
          propertyId,
          JSON.stringify({ slug, changes: updates }),
          req.ip || null,
        ],
      );
    } catch (auditErr) {
      // Audit failure must not roll back the actual update
      logger.error({ err: auditErr, slug }, '[adminSettings] failed to write audit log entry');
    }

    logger.info({ slug, changes: updates }, '[adminSettings] feature flags updated');

    return res.json(resolveFlags(newFlags, plan));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
