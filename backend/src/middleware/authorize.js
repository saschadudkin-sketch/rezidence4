'use strict';
const logger = require('../logger');

/**
 * authorize(requiredRoles) — middleware that checks user role after authentication.
 * Returns 403 with structured error + logs the attempt.
 *
 * Usage:
 *   router.delete('/sensitive', requireAuth, authorize('admin'), handler);
 *   router.patch('/resource',  requireAuth, authorize('admin', 'security'), handler);
 */
function authorize(...requiredRoles) {
  return (req, res, next) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Не авторизован' });
    if (requiredRoles.length && !requiredRoles.includes(user.role)) {
      logger.warn({ uid: user.uid, role: user.role, required: requiredRoles, path: req.path }, '[auth] forbidden — insufficient role');
      return res.status(403).json({ error: 'Недостаточно прав', required: requiredRoles });
    }
    next();
  };
}

module.exports = { authorize };
