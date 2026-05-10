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
// SEC [AUDIT #1] — multi-tenant gate.  Прикрепляет per-property `req.db`
// на каждый /api/v1/* запрос, резолвя tenant через hostname → X-Property-Slug
// header → JWT `property_slug` claim (см. middleware/propertyDb.js §"Hybrid
// tenant resolver"). Без этого wiring'а все v1 роуты уходили бы в global
// `db.pool` (DATABASE_URL) — на go-live Замоскворечья тот pool
// фактически указывает на Zamoskv DB, но как только появится вторая площадка,
// запросы к /api/v1/* начали бы случайно попадать в чужие таблицы.
const { propertyDbMiddleware } = require('../middleware/propertyDb');
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
const v1AccessTopologyRouter    = require('../v1/routes/accessTopology');
const v1AccessPoliciesRouter    = require('../v1/routes/accessPolicies');
const v1SecurityWorkspaceRouter = require('../v1/routes/securityWorkspace');
const v1StaffWorkspaceRouter    = require('../v1/routes/staffWorkspace');
const v1TechnicianWorkspaceRouter = require('../v1/routes/technicianWorkspace');
const v1ContractorWorkspaceRouter = require('../v1/routes/contractorWorkspace');
const v1AccessRequestsRouter    = require('../v1/routes/accessRequests');
const v1PassesRouter            = require('../v1/routes/passes');
const v1VisitsRouter            = require('../v1/routes/visits');
const v1AccessIncidentsRouter   = require('../v1/routes/accessIncidents');
const v1AuditReviewsRouter      = require('../v1/routes/auditReviews');

// Phase 5 (platform-v1) — notification_log_v2 read API.  Spec:
// docs/product/specs/platform-v1/notification-log-v2-spec.md §3.
// Роутер держит mixed-prefix endpoints (/admin/notification-log/* и
// /notification-log/mine), поэтому mount'ится в корень /api/v1.
const v1NotificationLogRouter   = require('../v1/routes/notificationLog');

// Phase 5 (platform-v1) — admin/outbox observability.  Spec:
// docs/product/specs/platform-v1/notifications-outbox-spec.md §4.2.
// Per-property admin UI (list/detail/requeue/cancel + metrics JSON/Prometheus).
// Counterpart платформенного /platform/api/v1/notifications/outbox/* — тот
// agreagate'ит по всем tenants, этот — под конкретный req.db.
const v1AdminOutboxRouter       = require('../v1/routes/adminOutbox');
const v1OperationsDashboardRouter = require('../v1/routes/operationsDashboard');
const v1ManagementCompanyPortfolioRouter = require('../v1/routes/managementCompanyPortfolio');

// Phase 5 (platform-v1) — packages_v2 content module.  Spec:
// docs/product/specs/platform-v1/packages-v2-spec.md §4.
// Mount'ится на /api/v1/packages (same path as legacy, but taking over — legacy
// `packagesRouter` outputs old schema; v1 is spec-authoritative).
const v1PackagesRouter          = require('../v1/routes/packages');

// Phase 5 (platform-v1) — announcements_v2 content module.  Spec:
// docs/product/specs/platform-v1/announcements-v2-spec.md §4.
// Три router'а: основной (auth), admin sub (/admin/announcements),
// public sub (/public/:slug/announcements без auth, rate-limited).
const v1AnnouncementsRouter         = require('../v1/routes/announcements');
const v1AnnouncementsAdminRouter    = v1AnnouncementsRouter.adminRouter;
const v1AnnouncementsPublicRouter   = v1AnnouncementsRouter.publicRouter;

// Phase 5 (platform-v1) — documents_v2 content module.  Spec:
// docs/product/specs/platform-v1/documents-v2-spec.md §3.
// Три router'а: основной (auth), admin sub (/admin/documents для versions
// history), public sub (/public/:slug/documents без auth, rate-limited).
const v1DocumentsRouter             = require('../v1/routes/documents');
const v1DocumentsAdminRouter        = v1DocumentsRouter.adminRouter;
const v1DocumentsPublicRouter       = v1DocumentsRouter.publicRouter;

function registerApiRoutes(app, { rateLimiters }) {
  const {
    authLimiter,
    uploadLimiter,
    clientLogsLimiter,
    sseEventsLimiter,
    platformAuthLimiter,
    platformGlobalLimiter,
    publicPassLimiter,
  } = rateLimiters;

  // Phase 6 P4 — freeze-gate для legacy-модулей (meters/billing/bookings/chat).
  // Накладывается ДОПОЛНИТЕЛЬНО к per-module requireFeature (где он есть), чтобы
  // даже при случайном включении meter_readings=true на проде Замоскворечья
  // endpoint вернул 404 пока legacy_utilities_enabled=false.
  // См. ROADMAP.md §Фаза 6 + RECONCILIATION.md §12 (Вариант B).
  const legacyUtilitiesGate = requireFeature('legacy_utilities_enabled');
  const legacySpacesBookingsOnly = (req, res, next) => {
    if (!/^\/spaces\/[^/]+\/bookings(?:\/|$)/.test(req.path)) return next();
    legacyUtilitiesGate(req, res, (err) => {
      if (err) return next(err);
      return bookingsRouter(req, res, next);
    });
  };

  // SEC [AUDIT #1] — mount multi-tenant gate ПЕРЕД всеми /api/v1/* роутерами,
  // включая /auth (login-фазе тоже нужен tenant context: какую БД проверять
  // для OTP/refresh).  Middleware:
  //   • resolves property через hostname → X-Property-Slug → JWT claim
  //   • 403 при cross-tenant replay (JWT-slug ≠ resolved slug)
  //   • 404 при неизвестном slug'е, 400 без tenant context
  //   • 503 при is_active=false
  //   • attaches req.db (pg.Pool для property.db_connection_url),
  //     req.property, req.propertySlug, req.propertyResolvedBy.
  //
  // Роуты, которые ранее использовали bare `db.query(...)` из '../../db',
  // мигрированы на паттерн `(req.db || db.pool).query(...)` — при
  // смонтированном middleware используется per-tenant pool, иначе fallback на
  // глобальный (backward-compat для прямых integration tests с mount'ом роутера
  // в обход registerApiRoutes).
  app.use('/api/v1', propertyDbMiddleware);

  app.use('/api/v1/auth', authLimiter, authRouter);
  app.use('/api/v1/requests', requestsRouter);
  app.use('/api/v1/users', usersRouter);
  app.use('/api/v1/chat', legacyUtilitiesGate, chatRouter);

  app.get('/api/v1/events', requireAuth, sseEventsLimiter, (req, res) => {
    const { uid, role } = req.user;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write(': connected\n\n');
    sse.addClient(uid, res, role);
    const ping = setInterval(() => {
      try { res.write(': ping\n\n'); }
      catch { clearInterval(ping); sse.removeClient(uid, res); }
    }, 25_000);
    const cleanup = () => { clearInterval(ping); sse.removeClient(uid, res); };
    req.on('close', cleanup);
    res.on('error', cleanup);
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
  // announcements_v2 (Phase 5) — v1 router mounted BEFORE legacy; legacy
  // остаётся как fall-through для ручек, которые v1 ещё не перехватил.
  // Admin sub-router — отдельный путь /api/v1/admin/announcements (listForAdmin
  // + metrics).  Public sub-router — /api/v1/public/:slug/announcements без auth.
  app.use('/api/v1/announcements', requireFeature('announcements'), v1AnnouncementsRouter);
  app.use('/api/v1/admin/announcements', requireFeature('announcements'), v1AnnouncementsAdminRouter);
  app.use('/api/v1/public/:slug/announcements', v1AnnouncementsPublicRouter);
  app.use('/api/v1/announcements', requireFeature('announcements'), announcementsRouter);
  // documents_v2 (Phase 5) — v1 router mounted BEFORE legacy; legacy
  // остаётся как fall-through.  Admin sub отдельно для versions history.
  // Public sub — /api/v1/public/:slug/documents без auth (kiosk).
  app.use('/api/v1/documents', requireFeature('documents'), v1DocumentsRouter);
  app.use('/api/v1/admin/documents', requireFeature('documents'), v1DocumentsAdminRouter);
  app.use('/api/v1/public/:slug/documents', v1DocumentsPublicRouter);
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
  app.use('/api/v1/meter-readings', legacyUtilitiesGate, requireFeature('meter_readings'), meterReadingsRouter);
  app.use('/api/v1/billing', legacyUtilitiesGate, requireFeature('billing'), billingRouter);
  app.use('/api/v1/spaces', legacyUtilitiesGate, requireFeature('space_booking'), spacesRouter);
  // bookingsRouter handles both GET /api/v1/bookings and
  // POST /api/v1/spaces/:spaceId/bookings + PATCH /api/v1/bookings/:id/cancel
  app.use('/api/v1/bookings', legacyUtilitiesGate, requireFeature('space_booking'), bookingsRouter);
  app.use('/api/v1', legacySpacesBookingsOnly);

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

  // Platform superadmin API — no CSRF, no property context required.
  // SEC [AUDIT #8]: platformGlobalLimiter применяется ДО роутеров на всём
  // /platform/ prefix'е — раньше лимит был только на /auth, остальные роуты
  // (/properties|admins|stats|audit-log|analytics|outbox/*) не имели никаких
  // ограничений, украденный superadmin-токен позволял неограниченное
  // enumeration.
  app.use('/platform/', platformGlobalLimiter);
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
  app.use('/api/v1', v1AccessTopologyRouter);
  app.use('/api/v1', v1AccessPoliciesRouter);
  app.use('/api/v1/security-workspace', v1SecurityWorkspaceRouter);
  app.use('/api/v1/staff-workspace', v1StaffWorkspaceRouter);
  app.use('/api/v1/technician-workspace', v1TechnicianWorkspaceRouter);
  app.use('/api/v1/contractor-workspace', v1ContractorWorkspaceRouter);
  app.use('/api/v1/access-requests', v1AccessRequestsRouter);
  app.use('/api/v1/passes', v1PassesRouter);
  app.use('/api/v1/visits', v1VisitsRouter);
  app.use('/api/v1', v1AccessIncidentsRouter);
  app.use('/api/v1/audit', v1AuditReviewsRouter);

  // Phase 5 — notification_log_v2 read API.  Exposes:
  //   GET  /api/v1/admin/notification-log             (list)
  //   GET  /api/v1/admin/notification-log/metrics     (agg)
  //   GET  /api/v1/admin/notification-log/:id         (row)
  //   GET  /api/v1/notification-log/mine              (resident)
  //   GET  /api/v1/notification-log/_meta             (limit cap)
  app.use('/api/v1', v1NotificationLogRouter);

  // Phase 5 — admin/outbox observability.  Per-property admin UI, spec §4.2:
  //   GET  /api/v1/admin/outbox                  list with filters
  //   GET  /api/v1/admin/outbox/metrics          JSON snapshot (+ ?format=prometheus)
  //   GET  /api/v1/admin/outbox/:id              row detail
  //   POST /api/v1/admin/outbox/:id/requeue      force-retry dead/failed
  //   POST /api/v1/admin/outbox/:id/cancel       manual pending/failed → dead
  // Mount ПЕРЕД /api/v1/admin/feature-flags (adminSettingsRouter): у того router
  // middleware-chain (requireAuth + requireAdmin), но fall-through на no-match
  // корректный — наш более специфичный path /admin/outbox matchнется первым.
  app.use('/api/v1/admin/outbox', v1AdminOutboxRouter);

  // DH-35 — object-level operational dashboard for property admins:
  // request/access/incident KPIs plus notification health in one per-property
  // snapshot.  Route is admin-only and uses req.db tenant context.
  app.use('/api/v1/admin/operations-dashboard', v1OperationsDashboardRouter);

  // DH-36 — management-company portfolio API.  Uses the current tenant's
  // management_company_id as the company boundary, then fans out through the
  // platform registry to aggregate DH-35 snapshots for that portfolio only.
  app.use('/api/v1/management-company/portfolio', v1ManagementCompanyPortfolioRouter);

  app.use('/api/auth', deprecate, authLimiter, authRouter);
  app.use('/api/requests', deprecate, requestsRouter);
  app.use('/api/users', deprecate, usersRouter);
  app.use('/api/chat', deprecate, legacyUtilitiesGate, chatRouter);
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
