'use strict';

/**
 * routes/adminSettings.js — Property admin settings endpoints.
 *
 * Endpoints (admin role only, property context required):
 *
 *   GET  /api/v1/admin/feature-flags
 *     Returns resolved flag values with labels and categories.
 *
 *   PATCH /api/v1/admin/feature-flags
 *     Merges provided boolean overrides into the property's feature_flags
 *     JSONB column, invalidates the property cache, and logs the change to
 *     platform_audit_log.
 *
 * Auth: requireAuth (JWT) + requireAdmin (role === 'admin'), both enforced here.
 * The 'chat' flag cannot be set to false — it is a core feature.
 */

const express = require('express');
const requireAuth = require('../middleware/auth');
const { FEATURE_FLAGS, resolveFlags } = require('../config/featureFlags');
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

// ─── GET /feature-flags ───────────────────────────────────────────────────────

router.get('/feature-flags', async (req, res, next) => {
  try {
    const slug = req.propertySlug;

    const platformDb = getPlatformDb();
    const { rows } = await platformDb.query(
      'SELECT id, slug, feature_flags FROM properties WHERE slug = $1',
      [slug],
    );

    if (!rows.length) {
      return res.status(404).json({
        error: { code: 'PROPERTY_NOT_FOUND', message: `Property '${slug}' not found` },
      });
    }

    const resolved = resolveFlags(rows[0].feature_flags);

    const flags = {};
    for (const [key, meta] of Object.entries(FEATURE_FLAGS)) {
      flags[key] = {
        value:    resolved[key],
        label:    meta.label,
        category: meta.category,
      };
    }

    // Unique ordered list of categories as they appear in the registry
    const categories = [...new Set(Object.values(FEATURE_FLAGS).map(m => m.category))];

    return res.json({ flags, categories });
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

    if (updates.chat === false) {
      return res.status(422).json({
        error: { code: 'CANNOT_DISABLE_CORE_FLAG', message: "Флаг 'chat' является базовым и не может быть отключён" },
      });
    }

    // ── Apply to DB ───────────────────────────────────────────────────────────

    const platformDb = getPlatformDb();

    // Fetch current stored flags (raw JSONB, not resolved)
    const { rows } = await platformDb.query(
      'SELECT id, feature_flags FROM properties WHERE slug = $1',
      [slug],
    );

    if (!rows.length) {
      return res.status(404).json({
        error: { code: 'PROPERTY_NOT_FOUND', message: `Property '${slug}' not found` },
      });
    }

    const current = rows[0].feature_flags || {};
    const propertyId = rows[0].id;
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

    // ── Return updated resolved flags (same shape as GET) ─────────────────────

    const resolved = resolveFlags(newFlags);

    const flags = {};
    for (const [key, meta] of Object.entries(FEATURE_FLAGS)) {
      flags[key] = {
        value:    resolved[key],
        label:    meta.label,
        category: meta.category,
      };
    }

    const categories = [...new Set(Object.values(FEATURE_FLAGS).map(m => m.category))];

    logger.info({ slug, changes: updates }, '[adminSettings] feature flags updated');

    return res.json({ flags, categories });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
