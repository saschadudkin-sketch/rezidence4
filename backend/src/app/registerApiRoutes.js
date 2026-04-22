'use strict';

const authRouter = require('../routes/auth');
const requestsRouter = require('../routes/requests');
const usersRouter = require('../routes/users');
const chatRouter = require('../routes/chat');
const permsRouter = require('../routes/perms');
const templatesRouter = require('../routes/templates');
const blacklistRouter = require('../routes/blacklist');
const visitLogsRouter = require('../routes/visitLogs');
const uploadRouter = require('../routes/upload');
const clientLogsRouter = require('../routes/clientLogs');
const contractsRouter = require('../routes/contracts');
const pushSubscriptionsRouter = require('../routes/pushSubscriptions');
const telegramLinkRouter = require('../routes/telegramLink');
const meterReadingsRouter = require('../routes/meterReadings');
const billingRouter = require('../routes/billing');
const spacesRouter = require('../routes/spaces');
const bookingsRouter = require('../routes/bookings');
const packagesRouter = require('../routes/packages');
// Phase 5 — Webhooks & Integrations
const webhooksRouter     = require('../routes/webhooks');
const integrationsRouter = require('../routes/integrations');
// Phase 2 — Announcements, Documents, QR Pass
const announcementsRouter = require('../routes/announcements');
const documentsRouter = require('../routes/documents');
const publicPassRouter = require('../routes/publicPass');
const guardScanRouter = require('../routes/guardScan');
const privacyRouter = require('../routes/privacy');
const requireAuth = require('../middleware/auth');
const requireFeature = require('../middleware/requireFeature');
const { deprecate } = require('../middleware/deprecate');
const sse = require('../sse');

// Admin settings (feature flags)
const adminSettingsRouter = require('../routes/adminSettings');

// Phase 6 — Analytics
const analyticsRouter = require('../routes/analytics');

// Platform (superadmin) routers
const platformAuthRouter = require('../routes/platform/auth');
const platformPropertiesRouter = require('../routes/platform/properties');
const platformAdminsRouter = require('../routes/platform/admins');
const platformStatsRouter = require('../routes/platform/stats');
const platformAnalyticsRouter = require('../routes/platform/analytics');
const platformAuditLogRouter = require('../routes/platform/auditLog');

function registerApiRoutes(app, { rateLimiters }) {
  const {
    authLimiter,
    uploadLimiter,
    clientLogsLimiter,
    sseEventsLimiter,
    platformAuthLimiter,
    publicPassLimiter,
  } = rateLimiters;

  app.use('/api/v1/auth', authLimiter, authRouter);
  app.use('/api/v1/requests', requestsRouter);
  app.use('/api/v1/users', usersRouter);
  app.use('/api/v1/chat', chatRouter);

  app.get('/api/v1/events', requireAuth, sseEventsLimiter, (req, res) => {
    const { uid, role } = req.user;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write(': connected\n\n');
    sse.addClient(uid, res, role);
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25_000);
    req.on('close', () => { clearInterval(ping); sse.removeClient(uid, res); });
  });

  app.use('/api/v1/perms', permsRouter);
  app.use('/api/v1/templates', templatesRouter);
  app.use('/api/v1/blacklist', blacklistRouter);
  app.use('/api/v1/visit-logs', visitLogsRouter);
  app.use('/api/v1/upload', uploadLimiter, uploadRouter);
  app.use('/api/v1/client-logs', clientLogsLimiter, clientLogsRouter);
  app.use('/api/v1/contracts', contractsRouter);
  // Push notification subscriptions and Telegram linking (Phase 1)
  // pushSubscriptionsRouter:  POST/DELETE /api/v1/push-subscriptions[/:id]
  //                           GET  /api/v1/push-subscriptions/vapid-public-key
  // telegramLinkRouter:       POST /api/v1/telegram/link-token
  //                           DELETE /api/v1/push-subscriptions/telegram (also mounted on /api/v1/push-subscriptions)
  app.use('/api/v1/push-subscriptions', pushSubscriptionsRouter);
  app.use('/api/v1/telegram', telegramLinkRouter);
  app.use('/api/v1/push-subscriptions', telegramLinkRouter);
  app.use('/api/client-logs', clientLogsLimiter, clientLogsRouter);

  // Phase 2 — Announcements, Documents, QR Pass
  app.use('/api/v1/announcements', requireFeature('announcements'), announcementsRouter);
  app.use('/api/v1/documents', requireFeature('documents'), documentsRouter);
  // publicPassRouter: no auth, rate-limited 30/min/IP
  app.use('/api/v1/public/pass', publicPassLimiter, publicPassRouter);
  // guardScanRouter: staff auth required (enforced inside the router)
  app.use('/api/v1/guard', requireFeature('qr_pass'), guardScanRouter);

  // Phase 3 — Resident Dashboard Expansion
  app.use('/api/v1/packages', requireFeature('packages'), packagesRouter);
  app.use('/api/v1/meter-readings', requireFeature('meter_readings'), meterReadingsRouter);
  app.use('/api/v1/billing', requireFeature('billing'), billingRouter);
  app.use('/api/v1/spaces', requireFeature('space_booking'), spacesRouter);
  // bookingsRouter handles both GET /api/v1/bookings and
  // POST /api/v1/spaces/:spaceId/bookings + PATCH /api/v1/bookings/:id/cancel
  app.use('/api/v1/bookings', requireFeature('space_booking'), bookingsRouter);
  app.use('/api/v1', bookingsRouter);

  // Phase 5 — Webhooks (admin cookie auth, enforced inside webhooksRouter)
  app.use('/api/v1/webhooks', requireFeature('webhooks'), webhooksRouter);
  // Phase 5 — Integrations (X-Integration-Secret header auth, no cookie auth)
  app.use('/api/v1/integrations', integrationsRouter);

  // Phase 6 — Analytics (admin-only, auth enforced inside analyticsRouter)
  app.use('/api/v1/analytics', requireFeature('analytics'), analyticsRouter);

  // Admin settings — feature flag management (admin role, property context required)
  app.use('/api/v1/admin', adminSettingsRouter);

  // ФЗ-152 — consent tracking and right-to-be-forgotten.  Auth enforced inside.
  app.use('/api/v1/privacy', privacyRouter);

  // Platform superadmin API — no CSRF, no property context required
  app.use('/platform/api/v1/auth', platformAuthLimiter, platformAuthRouter);
  app.use('/platform/api/v1/properties', platformPropertiesRouter);
  app.use('/platform/api/v1/admins', platformAdminsRouter);
  app.use('/platform/api/v1/stats', platformStatsRouter);
  app.use('/platform/api/v1/analytics', platformAnalyticsRouter);
  app.use('/platform/api/v1/audit-log', platformAuditLogRouter);

  app.use('/api/auth', deprecate, authLimiter, authRouter);
  app.use('/api/requests', deprecate, requestsRouter);
  app.use('/api/users', deprecate, usersRouter);
  app.use('/api/chat', deprecate, chatRouter);
  app.use('/api/perms', deprecate, permsRouter);
  app.use('/api/templates', deprecate, templatesRouter);
  app.use('/api/blacklist', deprecate, blacklistRouter);
  app.use('/api/visit-logs', deprecate, visitLogsRouter);
  app.use('/api/upload', deprecate, uploadLimiter, uploadRouter);
  app.use('/api/contracts', deprecate, contractsRouter);
}

module.exports = {
  registerApiRoutes,
};
