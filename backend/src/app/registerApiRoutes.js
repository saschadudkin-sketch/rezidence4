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
// Phase 1 (D-lite): management-company CRUD for the superadmin SPA.  Tables
// start empty — first MC gets created when an actual УК onboards (see
// ROADMAP.md §"Фаза 1").
const platformManagementCompaniesRouter = require('../routes/platform/managementCompanies');
// Phase 5 (platform-v1) — cross-tenant notifications outbox health dashboard
// for superadmin on-call.  Iterates active properties from platform registry.
const platformOutboxHealthRouter = require('../routes/platform/outboxHealth');
const platformOutboxRetryRouter  = require('../routes/platform/outboxRetry');

// Phase 2 (D-lite): Structure + People layer.  Spec: docs/product/specs/platform-v1/*
// Legacy requireAuth is retained (auth-v1-spec §7 defers requireAuthV1 to a
// later phase).  Role mapping legacy → v1:
//   legacy role='admin'   ≙ v1 property_admin   (all mutations)
//   legacy staff roles    ≙ v1 staff            (reads, capability-gated)
const v1StructureRouter   = require('../v1/routes/structure');
const v1ResidentsRouter   = require('../v1/routes/residents');
const v1StaffRouter       = require('../v1/routes/staff');
const v1ContractorsRouter = require('../v1/routes/contractors');

// Phase 3 (D-lite) — Access-core layer.  Spec: docs/product/specs/platform-v1/*
// vehicles            — first-class сущность авто с white/blacklist
// access-requests     — заявки + approvals
// passes              — пропуска + QR + revoke/block
// visits              — visit_logs_v2 + verify endpoint (guard-console scan)
// access-incidents    — queue инцидентов + overrides (mounted at /api/v1 root
//                       т.к. owns two top-level resources: /access-incidents,
//                       /access-overrides)
const v1VehiclesRouter          = require('../v1/routes/vehicles');
const v1AccessRequestsRouter    = require('../v1/routes/accessRequests');
const v1PassesRouter            = require('../v1/routes/passes');
const v1VisitsRouter            = require('../v1/routes/visits');
const v1AccessIncidentsRouter   = require('../v1/routes/accessIncidents');

// Phase 5 (platform-v1) — notification_log_v2 read API.  Spec:
// docs/product/specs/platform-v1/notification-log-v2-spec.md §3.
// Роутер держит mixed-prefix endpoints (/admin/notification-log/* и
// /notification-log/mine), поэтому mount'ится в корень /api/v1.
const v1NotificationLogRouter   = require('../v1/routes/notificationLog');

// Phase 5 (platform-v1) — packages_v2 content module.  Spec:
// docs/product/specs/platform-v1/packages-v2-spec.md §4.
// Mount'ится на /api/v1/packages (same path as legacy, but taking over — legacy
// `packagesRouter` outputs old schema; v1 is spec-authoritative).
const v1PackagesRouter          = require('../v1/routes/packages');

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
  // packages_v2 (Phase 5) — v1 router mounted BEFORE legacy; legacy remains as
  // fall-through for any endpoint v1 doesn't claim (none today, kept for audit).
  app.use('/api/v1/packages', requireFeature('packages'), v1PackagesRouter);
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
  app.use('/platform/api/v1/management-companies', platformManagementCompaniesRouter);
  app.use('/platform/api/v1/notifications/outbox/health', platformOutboxHealthRouter);
  app.use('/platform/api/v1/notifications/outbox/retry',  platformOutboxRetryRouter);

  // Phase 2 (D-lite) — Structure + People layer under /api/v1/*.
  // structureRouter and contractorsRouter expose multiple top-level resources
  // (/buildings, /entrances, /units  and  /contractor-companies,
  // /contractor-users respectively), so both mount at /api/v1 root.
  // residentsRouter and staffRouter each own a single resource.
  app.use('/api/v1', v1StructureRouter);
  app.use('/api/v1/residents', v1ResidentsRouter);
  app.use('/api/v1/staff', v1StaffRouter);
  app.use('/api/v1', v1ContractorsRouter);

  // Phase 3 (D-lite) — Access-core layer under /api/v1/*.
  // vehicles/access-requests/passes/visits — single-resource routers.
  // accessIncidents owns /access-incidents + /access-overrides (root mount).
  app.use('/api/v1/vehicles', v1VehiclesRouter);
  app.use('/api/v1/access-requests', v1AccessRequestsRouter);
  app.use('/api/v1/passes', v1PassesRouter);
  app.use('/api/v1/visits', v1VisitsRouter);
  app.use('/api/v1', v1AccessIncidentsRouter);

  // Phase 5 — notification_log_v2 read API.  Exposes:
  //   GET  /api/v1/admin/notification-log             (list)
  //   GET  /api/v1/admin/notification-log/metrics     (agg)
  //   GET  /api/v1/admin/notification-log/:id         (row)
  //   GET  /api/v1/notification-log/mine              (resident)
  //   GET  /api/v1/notification-log/_meta             (limit cap)
  app.use('/api/v1', v1NotificationLogRouter);

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
