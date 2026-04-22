'use strict';

/**
 * middleware/requireFeature.js
 *
 * Returns an Express middleware that gates a route behind a feature flag.
 * If the flag is explicitly false for this property, responds 404 with a
 * structured error so the client cannot distinguish "feature off" from "not found".
 *
 * Usage:
 *   app.use('/api/v1/billing', requireFeature('billing'), billingRouter);
 *
 * Skipped when req.property is absent (platform-level routes that have no
 * property context).
 *
 * @param {string} flagName - Key from FEATURE_FLAGS registry
 * @returns {Function} Express middleware
 */
function requireFeature(flagName) {
  return function checkFeatureFlag(req, res, next) {
    const flags = req.property?.resolvedFlags;

    // No property context (e.g. platform admin routes) — pass through
    if (!flags) return next();

    if (flags[flagName] === false) {
      return res.status(404).json({
        error: {
          code: 'FEATURE_DISABLED',
          message: `Функция '${flagName}' не подключена для этого объекта`,
        },
      });
    }

    next();
  };
}

module.exports = requireFeature;
