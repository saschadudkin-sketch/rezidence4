/**
 * Smoke tests для staff/admin-страниц платформы v1:
 *   - AnnouncementsAdminPage   → /v1/announcements
 *   - DocumentsAdminPage       → /v1/documents
 *   - PackagesAdminPage        → /v1/packages
 *
 * Что ловим:
 *   - property_id=null → guidance-алерт вместо пустого списка.
 *   - admin vs concierge/staff — разная видимость destructive-actions (Снять,
 *     Удалить, Утеряна).  Видеть их у не-админа было бы регрессией безопасности
 *     (backend 403, но скрытие в UI — часть контракта).
 *   - Деривация статуса (draft/published/deleted, awaiting/picked/returned)
 *     попадает в бейджи и кнопки (draft показывает «Опубликовать» и т.п.).
 *
 * Sессия через `<V1SessionProvider initialUser={...}>` — так тест не ходит
 * в сеть за /auth/me и `useV1Session()` внутри страницы видит готового юзера.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type {
  Announcement,
  OperationsDashboardSnapshot,
  ManagementCompanyPortfolioSnapshot,
  Package,
  AdminOutboxRow,
  AdminOutboxMetrics,
  AdminOutboxSla,
  OutboxHealthResponse,
  NotificationLogMetrics,
  UserMe,
  V1Document,
} from '../api/types';

// ─── Module mocks ───────────────────────────────────────────────────────────
//
// Страницы вызывают `api.announcements.listAdmin`, `api.documents.list`,
// `api.packages.list`.  Остальные методы шимим как never-resolve — smoke-тест
// не triggers мутации.  deriveAnnouncementStatus/deriveDocumentStatus должны
// работать реально (тестируем именно UI-следствия их классификации), поэтому
// вызываем оригиналы через импорт — vi.importActual.
const {
  listAdminAnnouncementsMock,
  listDocumentsMock,
  listPackagesMock,
  getOperationsDashboardMock,
  getAnalyticsTrafficMock,
  getAnalyticsTopResidentsMock,
  getAnalyticsSlaMock,
  getAnalyticsRequestsMock,
  getAnalyticsPackagesMock,
  listAnalyticsSnapshotsMock,
  getLatestAnalyticsSnapshotMock,
  createAnalyticsSnapshotMock,
  getManagementCompanyPortfolioMock,
  getAdminOutboxMetricsMock,
  getAdminOutboxSlaMock,
  getOutboxHealthMock,
  retryOutboxMock,
  listAdminOutboxMock,
  requeueAdminOutboxMock,
  cancelAdminOutboxMock,
  getNotificationLogMetricsMock,
  getNotificationLogMetaMock,
  listNotificationLogMock,
  packageStatusToneMock,
} = vi.hoisted(() => ({
  listAdminAnnouncementsMock: vi.fn(),
  listDocumentsMock: vi.fn(),
  listPackagesMock: vi.fn(),
  getOperationsDashboardMock: vi.fn(),
  getAnalyticsTrafficMock: vi.fn(),
  getAnalyticsTopResidentsMock: vi.fn(),
  getAnalyticsSlaMock: vi.fn(),
  getAnalyticsRequestsMock: vi.fn(),
  getAnalyticsPackagesMock: vi.fn(),
  listAnalyticsSnapshotsMock: vi.fn(),
  getLatestAnalyticsSnapshotMock: vi.fn(),
  createAnalyticsSnapshotMock: vi.fn(),
  getManagementCompanyPortfolioMock: vi.fn(),
  getAdminOutboxMetricsMock: vi.fn(),
  getAdminOutboxSlaMock: vi.fn(),
  getOutboxHealthMock: vi.fn(),
  retryOutboxMock: vi.fn(),
  listAdminOutboxMock: vi.fn(),
  requeueAdminOutboxMock: vi.fn(),
  cancelAdminOutboxMock: vi.fn(),
  getNotificationLogMetricsMock: vi.fn(),
  getNotificationLogMetaMock: vi.fn(),
  listNotificationLogMock: vi.fn(),
  packageStatusToneMock: vi.fn(
    (status: string): 'success' | 'warning' | 'neutral' | 'error' => {
      if (status === 'awaiting_pickup') return 'warning';
      if (status === 'picked_up') return 'success';
      if (status === 'lost') return 'error';
      return 'neutral';
    },
  ),
}));

vi.mock('../api', async () => {
  // Подтягиваем deriveAnnouncementStatus / deriveDocumentStatus из настоящего
  // модуля — это pure-функции, и мы хотим, чтобы тест проверял настоящую
  // классификацию (а не подставленную).
  const actual = await vi.importActual<typeof import('../api')>('../api');
  const neverResolves = () => new Promise(() => {});
  return {
    ...actual,
    api: {
      announcements: {
        listAdmin: listAdminAnnouncementsMock,
        list: neverResolves,
        create: neverResolves,
        publish: neverResolves,
        unpublish: neverResolves,
        remove: neverResolves,
      },
      documents: {
        list: listDocumentsMock,
        create: neverResolves,
        publish: neverResolves,
        unpublish: neverResolves,
        remove: neverResolves,
        listVersions: neverResolves,
      },
      packages: {
        list: listPackagesMock,
        listMine: neverResolves,
        create: neverResolves,
        pickup: neverResolves,
        return: neverResolves,
        markLost: neverResolves,
        remind: neverResolves,
      },
      operationsDashboard: {
        get: getOperationsDashboardMock,
      },
      analytics: {
        traffic: getAnalyticsTrafficMock,
        topResidents: getAnalyticsTopResidentsMock,
        sla: getAnalyticsSlaMock,
        requests: getAnalyticsRequestsMock,
        packages: getAnalyticsPackagesMock,
        listSnapshots: listAnalyticsSnapshotsMock,
        latestSnapshot: getLatestAnalyticsSnapshotMock,
        createSnapshot: createAnalyticsSnapshotMock,
      },
      managementCompanyPortfolio: {
        get: getManagementCompanyPortfolioMock,
      },
      adminOutbox: {
        metrics: getAdminOutboxMetricsMock,
        sla: getAdminOutboxSlaMock,
        health: getOutboxHealthMock,
        retry: retryOutboxMock,
        list: listAdminOutboxMock,
        requeue: requeueAdminOutboxMock,
        cancel: cancelAdminOutboxMock,
      },
      notificationLog: {
        metrics: getNotificationLogMetricsMock,
        meta: getNotificationLogMetaMock,
        list: listNotificationLogMock,
      },
      // Unused by admin pages; kept for barrel-shape safety.
      accessRequests: { list: neverResolves, getById: neverResolves },
      passes: { list: neverResolves, getById: neverResolves },
      vehicles: { getByPlate: neverResolves },
      visits: { list: neverResolves },
      incidents: { list: neverResolves },
      residents: { getById: neverResolves },
      units: { list: neverResolves },
      session: { me: neverResolves },
    },
    isV1ApiError: () => false,
    packageStatusTone: packageStatusToneMock,
  };
});

// Импортируем страницы ПОСЛЕ vi.mock — hoisting поднимет mock, но читаемость
// важнее.
import { AnnouncementsAdminPage } from './AnnouncementsAdminPage';
import { DocumentsAdminPage } from './DocumentsAdminPage';
import { PackagesAdminPage } from './PackagesAdminPage';
import { OperationsDashboardPage } from './OperationsDashboardPage';
import { ManagementCompanyPortfolioPage } from './ManagementCompanyPortfolioPage';
import { NotificationOperationsPage } from './NotificationOperationsPage';
import { V1SessionProvider } from '../store';

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makeUser(overrides: Partial<UserMe> = {}): UserMe {
  return {
    uid: '00000000-0000-0000-0000-0000000000aa',
    role: 'admin',
    name: 'Тестовый Админ',
    phone: null,
    apartment: null,
    avatar: null,
    property_slug: 'zamoskvorechye',
    property_id: '00000000-0000-0000-0000-000000000bbb',
    ...overrides,
  };
}

function makeAnnouncement(overrides: Partial<Announcement> = {}): Announcement {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    property_id: '00000000-0000-0000-0000-000000000bbb',
    title: 'Объявление',
    body_md: 'Текст объявления.',
    is_urgent: false,
    category: 'general',
    audience_type: 'all',
    audience_building_id: null,
    audience_entrance_id: null,
    audience_unit_type: null,
    starts_at: '2026-04-01T00:00:00Z',
    expires_at: null,
    is_pinned: false,
    notify_channels: ['web_push'],
    created_by_staff_id: 'staff-1',
    published_at: null,
    published_by_staff_id: null,
    deleted_at: null,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: null,
    ...overrides,
  };
}

function makeDocument(overrides: Partial<V1Document> = {}): V1Document {
  return {
    id: '00000000-0000-0000-0000-000000000002',
    property_id: '00000000-0000-0000-0000-000000000bbb',
    title: 'Документ',
    category: 'rules',
    tag: null,
    body_md: 'Текст документа.',
    file_url: null,
    file_mime: null,
    file_size_bytes: null,
    is_public: false,
    sort_order: 10,
    published_at: null,
    created_by_staff_id: 'staff-1',
    updated_by_staff_id: null,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: null,
    deleted_at: null,
    ...overrides,
  };
}

function makePackage(overrides: Partial<Package> = {}): Package {
  return {
    id: '00000000-0000-0000-0000-000000000003',
    property_id: '00000000-0000-0000-0000-000000000bbb',
    unit_id: '00000000-0000-0000-0000-000000000ccc',
    recipient_resident_id: null,
    recipient_name_snapshot: 'Иванов И.И.',
    sender_name: 'Ozon',
    carrier: 'СДЭК',
    tracking_number: 'TRACK-1',
    photo_url: null,
    size_category: 'medium',
    received_at: '2026-04-20T10:00:00Z',
    received_by_staff_id: 'staff-1',
    storage_location: 'A-12',
    status: 'awaiting_pickup',
    picked_up_at: null,
    picked_up_by_resident_id: null,
    picked_up_by_name: null,
    picked_up_by_staff_id: null,
    returned_at: null,
    returned_reason: null,
    notes: null,
    created_at: '2026-04-20T10:00:00Z',
    updated_at: null,
    ...overrides,
  };
}

function makeOperationsDashboard(
  overrides: Partial<OperationsDashboardSnapshot> = {},
): OperationsDashboardSnapshot {
  return {
    generated_at: '2026-05-10T00:00:00.000Z',
    property_id: '00000000-0000-0000-0000-000000000bbb',
    period: { key: '7d', hours: 168 },
    requests: {
      created: 12,
      completed: 7,
      open: 5,
      overdue_backlog: 2,
      resolved_within_sla: 6,
      resolved_with_sla: 8,
      sla_compliance_rate: 0.75,
      first_response_median_minutes: 18,
      resolution_median_minutes: 240,
      by_status: [{ status: 'pending', total: 5 }],
      by_priority: [{ priority: 'emergency', total: 1 }],
    },
    access: {
      requests_created: 10,
      requests_approved: 6,
      requests_rejected: 2,
      approval_rate: 0.75,
      pending: 3,
      expired: 1,
      allow_count: 31,
      denial_count: 4,
      vehicle_traffic_count: 18,
      avg_decision_sample_count: 9,
      avg_decision_seconds: 22,
      active_passes: 22,
      used_passes: 9,
      manual_override_count: 5,
      offline_replay_count: 2,
      trusted_visitors_active: 7,
      trusted_visitor_passes_created: 4,
      skud_failed_events: 3,
      skud_manual_control_count: 6,
      by_access_point: [{
        access_point_id: 'point-1',
        name: 'КПП Север',
        allow_count: 12,
        denial_count: 2,
        total: 14,
      }],
      deny_reasons: [{ reason: 'expired_pass', total: 3 }],
      peak_traffic_windows: [{ window_start: '2026-05-16T08:00:00.000Z', total: 15 }],
      manual_overrides_by_type: [{ override_type: 'manual_admit', total: 5 }],
      offline_replay_by_status: [{ replay_status: 'accepted', total: 2 }],
    },
    incidents: {
      open: 3,
      investigating: 2,
      closed: 8,
      high_priority_open: 1,
      blacklist_hits: 2,
      suspicious_attempts: 5,
      resolution_median_minutes: 42,
      by_type: [{ incident_type: 'blacklist_hit', total: 2 }],
    },
    notifications: {
      sent: 90,
      failed: 10,
      success_rate: 0.9,
      queue: { pending: 4, in_flight: 1, sent: 80, failed: 3, dead: 2 },
      oldest_pending_age_seconds: 75,
      per_channel: [{ channel: 'web_push', sent: 80, failed: 5, success_rate: 0.94 }],
    },
    ...overrides,
  };
}

function makeManagementCompanyPortfolio(
  overrides: Partial<ManagementCompanyPortfolioSnapshot> = {},
): ManagementCompanyPortfolioSnapshot {
  const propertyRequests: OperationsDashboardSnapshot['requests'] = {
    created: 12,
    completed: 7,
    open: 5,
    overdue_backlog: 2,
    resolved_within_sla: 6,
    resolved_with_sla: 8,
    sla_compliance_rate: 0.75,
    first_response_median_minutes: 18,
    resolution_median_minutes: 240,
    by_status: [{ status: 'pending', total: 5 }],
    by_priority: [{ priority: 'emergency', total: 1 }],
  };
  const propertyAccess: OperationsDashboardSnapshot['access'] = {
    requests_created: 10,
    requests_approved: 6,
    requests_rejected: 2,
    approval_rate: 0.75,
    pending: 3,
    expired: 1,
    allow_count: 31,
    denial_count: 4,
    vehicle_traffic_count: 18,
    avg_decision_sample_count: 9,
    avg_decision_seconds: 22,
    active_passes: 22,
    used_passes: 9,
    manual_override_count: 5,
    offline_replay_count: 2,
    trusted_visitors_active: 7,
    trusted_visitor_passes_created: 4,
    skud_failed_events: 3,
    skud_manual_control_count: 6,
    by_access_point: [{
      access_point_id: 'point-1',
      name: 'КПП Север',
      allow_count: 12,
      denial_count: 2,
      total: 14,
    }],
    deny_reasons: [{ reason: 'expired_pass', total: 3 }],
    peak_traffic_windows: [{ window_start: '2026-05-16T08:00:00.000Z', total: 15 }],
    manual_overrides_by_type: [{ override_type: 'manual_admit', total: 5 }],
    offline_replay_by_status: [{ replay_status: 'accepted', total: 2 }],
  };
  const propertyIncidents: OperationsDashboardSnapshot['incidents'] = {
    open: 3,
    investigating: 2,
    closed: 8,
    high_priority_open: 1,
    blacklist_hits: 2,
    suspicious_attempts: 5,
    resolution_median_minutes: 42,
    by_type: [{ incident_type: 'blacklist_hit', total: 2 }],
  };
  const propertyNotifications: OperationsDashboardSnapshot['notifications'] = {
    sent: 90,
    failed: 10,
    success_rate: 0.9,
    queue: { pending: 4, in_flight: 1, sent: 80, failed: 3, dead: 2 },
    oldest_pending_age_seconds: 75,
    per_channel: [{ channel: 'web_push', sent: 80, failed: 5, success_rate: 0.94 }],
  };

  return {
    generated_at: '2026-05-10T00:00:00.000Z',
    management_company_id: '00000000-0000-0000-0000-00000000f001',
    period: { key: '7d', hours: 168 },
    filters: { property_slugs: [], include_inactive: false },
    rollup: {
      properties_total: 2,
      properties_healthy: 2,
      properties_error: 0,
      hotspot_property_count: 1,
      requests: {
        created: 12,
        completed: 7,
        open: 5,
        overdue_backlog: 2,
        resolved_within_sla: 6,
        resolved_with_sla: 8,
        sla_compliance_rate: 0.75,
        by_status: [{ status: 'pending', total: 5 }],
        by_priority: [{ priority: 'emergency', total: 1 }],
      },
      access: propertyAccess,
      incidents: {
        open: 3,
        investigating: 2,
        closed: 8,
        high_priority_open: 1,
        blacklist_hits: 2,
        suspicious_attempts: 5,
        by_type: [{ incident_type: 'blacklist_hit', total: 2 }],
      },
      notifications: propertyNotifications,
    },
    rankings: {
      overdue_backlog: [
        {
          property_id: '00000000-0000-0000-0000-00000000a001',
          property_slug: 'alpha',
          property_name: 'Alpha Residence',
          value: 2,
        },
      ],
      incident_load: [
        {
          property_id: '00000000-0000-0000-0000-00000000a001',
          property_slug: 'alpha',
          property_name: 'Alpha Residence',
          value: 5,
        },
      ],
      notification_failures: [],
    },
    properties: [
      {
        id: '00000000-0000-0000-0000-00000000a001',
        slug: 'alpha',
        name: 'Alpha Residence',
        status: 'active',
        is_active: true,
        health: 'ok',
        generated_at: '2026-05-10T00:00:00.000Z',
        hotspots: ['overdue_backlog', 'high_priority_incidents'],
        requests: propertyRequests,
        access: propertyAccess,
        incidents: propertyIncidents,
        notifications: propertyNotifications,
      },
      {
        id: '00000000-0000-0000-0000-00000000b001',
        slug: 'beta',
        name: 'Beta Village',
        status: 'active',
        is_active: true,
        health: 'ok',
        generated_at: '2026-05-10T00:00:00.000Z',
        hotspots: [],
        requests: { ...propertyRequests, open: 0, overdue_backlog: 0 },
        access: propertyAccess,
        incidents: { ...propertyIncidents, open: 0, investigating: 0, high_priority_open: 0 },
        notifications: { ...propertyNotifications, success_rate: 0.99 },
      },
    ],
    errors: [],
    formula_notes: {
      request_sla_compliance_rate: 'Weighted by resolved_with_sla counts from DH-35 property snapshots.',
      notification_success_rate: 'Weighted by sent and failed notification log counts across included properties.',
      access_avg_decision_seconds: 'Weighted by measured manual decision sample counts from DH-35 property snapshots.',
      hotspot_property_count: 'Counts properties with overdue backlog, high incident load, or notification delivery/queue risk.',
    },
    ...overrides,
  };
}

function makeAdminOutboxRow(overrides: Partial<AdminOutboxRow> = {}): AdminOutboxRow {
  return {
    id: '00000000-0000-0000-0000-0000000000f1',
    property_id: '00000000-0000-0000-0000-000000000bbb',
    event_type: 'access.request.created',
    channel: 'web_push',
    recipient_type: 'resident',
    recipient_id: '00000000-0000-0000-0000-0000000000c1',
    recipient_address: 'resident@example.test',
    payload: { secret: 'visible only on demand' },
    status: 'pending',
    attempt_count: 0,
    max_attempts: 3,
    next_attempt_at: null,
    last_attempted_at: null,
    last_error: null,
    sent_at: null,
    correlation_id: '00000000-0000-0000-0000-0000000000d1',
    created_at: '2026-05-10T00:00:00.000Z',
    ...overrides,
  };
}

function makeAdminOutboxMetrics(
  overrides: Partial<AdminOutboxMetrics> = {},
): AdminOutboxMetrics {
  return {
    ok: true,
    counts: { pending: 1, in_flight: 0, sent: 10, failed: 0, dead: 0 },
    per_channel: [{
      channel: 'web_push',
      pending: 1,
      in_flight: 0,
      sent: 10,
      failed: 0,
      dead: 0,
    }],
    per_event_type: [{ event_type: 'access.request.created', total: 1 }],
    oldest_pending_age_seconds: 30,
    generated_at: '2026-05-10T00:00:00.000Z',
    ...overrides,
  };
}

function makeAdminOutboxSla(overrides: Partial<AdminOutboxSla> = {}): AdminOutboxSla {
  return {
    ok: true,
    awaiting_pickup_total: 5,
    awaiting_pickup_over_7d: 2,
    awaiting_pickup_over_14d: 1,
    awaiting_pickup_over_30d: 0,
    reminders_sent_24h: 3,
    followups_sent_24h: 1,
    admin_alerts_sent_24h: 1,
    received_24h: 4,
    thresholds: {
      remind_days: 7,
      followup_days: 14,
      admin_alert_days: 30,
    },
    generated_at: '2026-05-10T00:00:00.000Z',
    ...overrides,
  };
}

function makeOutboxHealth(overrides: Partial<OutboxHealthResponse> = {}): OutboxHealthResponse {
  return {
    ok: true,
    feature_enabled: true,
    counts: { pending: 1, in_flight: 0, sent: 10, failed: 1, dead: 1 },
    stuck_in_flight: 0,
    oldest_pending_age_seconds: 120,
    ts: '2026-05-10T00:00:00.000Z',
    ...overrides,
  };
}

function makeNotificationLogMetrics(
  overrides: Partial<NotificationLogMetrics> = {},
): NotificationLogMetrics {
  return {
    ok: true,
    period: '24h',
    period_hours: 24,
    generated_at: '2026-05-10T00:00:00.000Z',
    channels: [{ channel: 'web_push', sent: 10, failed: 0, success_rate: 1 }],
    top_events: [{ event_type: 'access.request.created', total: 10 }],
    top_errors: [],
    ...overrides,
  };
}

// ─── Render harness ─────────────────────────────────────────────────────────

function renderWithProviders(node: ReactElement, user: UserMe | null = makeUser()) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        {user ? (
          <V1SessionProvider initialUser={user}>{node}</V1SessionProvider>
        ) : (
          node
        )}
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

// ─── AnnouncementsAdminPage ────────────────────────────────────────────────

describe('AnnouncementsAdminPage', () => {
  beforeEach(() => {
    listAdminAnnouncementsMock.mockReset();
  });

  test('property_id=null → предупреждение вместо загрузки', () => {
    renderWithProviders(
      <AnnouncementsAdminPage />,
      makeUser({ property_id: null, property_slug: null }),
    );

    expect(
      screen.getByText(/не назначен объект \(property\)/i),
    ).toBeInTheDocument();
    // Список не запрошен — LHS не должен дёрнуть сеть, если property_id пуст.
    expect(listAdminAnnouncementsMock).not.toHaveBeenCalled();
  });

  test('draft → видно «Опубликовать», admin дополнительно — «Удалить»', async () => {
    listAdminAnnouncementsMock.mockResolvedValue({
      ok: true,
      count: 1,
      announcements: [
        makeAnnouncement({
          id: 'ann-draft',
          title: 'Черновик 1',
          published_at: null,
        }),
      ],
    });

    renderWithProviders(<AnnouncementsAdminPage />, makeUser({ role: 'admin' }));

    // Ждём кнопку — это гарантирует, что запрос разрешился и карточка отрисована.
    // (findByText('черновик') был бы двусмысленным — слово есть и в dropdown-опции.)
    const publishBtn = await screen.findByRole(
      'button',
      { name: 'Опубликовать' },
      { timeout: 5000 },
    );
    expect(publishBtn).toBeInTheDocument();
    expect(screen.getByText('Черновик 1')).toBeInTheDocument();
    // Admin — «Удалить» видна.
    expect(screen.getByRole('button', { name: 'Удалить' })).toBeInTheDocument();
    // «Снять» для draft не должна появляться — публикации ещё не было.
    expect(screen.queryByRole('button', { name: 'Снять' })).not.toBeInTheDocument();
  });

  test('active + concierge → «Удалить» и «Снять» скрыты', async () => {
    // published_at в прошлом, expires_at null → деривация даст active.
    listAdminAnnouncementsMock.mockResolvedValue({
      ok: true,
      count: 1,
      announcements: [
        makeAnnouncement({
          id: 'ann-active',
          title: 'Активное для консьержа',
          starts_at: '2026-04-01T00:00:00Z',
          published_at: '2026-04-01T00:00:00Z',
          published_by_staff_id: 'staff-x',
        }),
      ],
    });

    renderWithProviders(
      <AnnouncementsAdminPage />,
      makeUser({ role: 'concierge' }),
    );

    // Ждём карточку объявления, чтобы убедиться что запрос разрешился.
    const title = await screen.findByText('Активное для консьержа');
    expect(title).toBeInTheDocument();
    // Бейдж «активно» живёт рядом с заголовком карточки.  Проверяем через
    // ближайший <section> (Card обёрнут в section), а не через глобальный
    // getByText — так «активно» в dropdown не вмешивается.
    const card = title.closest('section');
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).getByText('активно')).toBeInTheDocument();
    // Non-admin не видит destructive-кнопок.
    expect(screen.queryByRole('button', { name: 'Удалить' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Снять' })).not.toBeInTheDocument();
    // «Опубликовать» для active не показываем — уже опубликовано.
    expect(
      screen.queryByRole('button', { name: 'Опубликовать' }),
    ).not.toBeInTheDocument();
  });

  test('empty → корректное сообщение', async () => {
    listAdminAnnouncementsMock.mockResolvedValue({
      ok: true,
      count: 0,
      announcements: [],
    });

    renderWithProviders(<AnnouncementsAdminPage />);

    expect(
      await screen.findByText(/Нет объявлений с выбранным статусом/),
    ).toBeInTheDocument();
  });
});

// ─── DocumentsAdminPage ────────────────────────────────────────────────────

describe('DocumentsAdminPage', () => {
  beforeEach(() => {
    listDocumentsMock.mockReset();
  });

  test('property_id=null → предупреждение', () => {
    renderWithProviders(
      <DocumentsAdminPage />,
      makeUser({ property_id: null }),
    );
    expect(
      screen.getByText(/не назначен объект \(property\)/i),
    ).toBeInTheDocument();
    expect(listDocumentsMock).not.toHaveBeenCalled();
  });

  test('concierge видит hint о разрешённых категориях; admin — нет', async () => {
    listDocumentsMock.mockResolvedValue({ ok: true, count: 0, documents: [] });

    const { unmount } = renderWithProviders(
      <DocumentsAdminPage />,
      makeUser({ role: 'concierge' }),
    );
    expect(
      await screen.findByText(/может создавать и редактировать только в категориях/),
    ).toBeInTheDocument();
    unmount();

    renderWithProviders(<DocumentsAdminPage />, makeUser({ role: 'admin' }));
    expect(
      screen.queryByText(/может создавать и редактировать только в категориях/),
    ).not.toBeInTheDocument();
  });

  test('published + admin → «Снять» и «История»; draft → «Опубликовать»', async () => {
    listDocumentsMock.mockResolvedValue({
      ok: true,
      count: 2,
      documents: [
        makeDocument({
          id: 'doc-pub',
          title: 'Правила — опубликован',
          published_at: '2026-04-10T00:00:00Z',
        }),
        makeDocument({
          id: 'doc-draft',
          title: 'Правила — черновик',
          published_at: null,
        }),
      ],
    });

    renderWithProviders(<DocumentsAdminPage />, makeUser({ role: 'admin' }));

    // Для опубликованного — бейдж «опубликован» и кнопка «Снять».
    expect(await screen.findByText('Правила — опубликован')).toBeInTheDocument();
    expect(screen.getByText('опубликован')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Снять' })).toBeInTheDocument();
    // Для draft — кнопка «Опубликовать».
    expect(screen.getByText('Правила — черновик')).toBeInTheDocument();
    expect(screen.getByText('черновик')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Опубликовать' })).toBeInTheDocument();
    // Admin видит «История».
    expect(screen.getAllByRole('button', { name: /История/ }).length).toBeGreaterThanOrEqual(1);
  });

  test('file_url → ссылка «файл» в подзаголовке', async () => {
    listDocumentsMock.mockResolvedValue({
      ok: true,
      count: 1,
      documents: [
        makeDocument({
          id: 'doc-file',
          title: 'С файлом',
          file_url: '/uploads/docs/file.pdf',
          published_at: '2026-04-10T00:00:00Z',
        }),
      ],
    });

    renderWithProviders(<DocumentsAdminPage />);

    const link = await screen.findByRole('link', { name: 'файл' });
    expect(link.getAttribute('href')).toBe('/uploads/docs/file.pdf');
  });

  test('empty → корректное сообщение', async () => {
    listDocumentsMock.mockResolvedValue({ ok: true, count: 0, documents: [] });
    renderWithProviders(<DocumentsAdminPage />);
    expect(
      await screen.findByText(/Нет документов с выбранными фильтрами/),
    ).toBeInTheDocument();
  });
});

// ─── PackagesAdminPage ─────────────────────────────────────────────────────

describe('PackagesAdminPage', () => {
  beforeEach(() => {
    listPackagesMock.mockReset();
  });

  test('property_id=null → предупреждение', () => {
    renderWithProviders(<PackagesAdminPage />, makeUser({ property_id: null }));
    expect(
      screen.getByText(/не назначен объект \(property\)/i),
    ).toBeInTheDocument();
    expect(listPackagesMock).not.toHaveBeenCalled();
  });

  test('по умолчанию фильтр awaiting_pickup — запрос уходит с ним', async () => {
    listPackagesMock.mockResolvedValue({ ok: true, count: 0, packages: [] });

    renderWithProviders(<PackagesAdminPage />);

    // Ждём первый рендер с запросом.
    await screen.findByText(/Нет посылок с выбранным статусом/);
    // Первый аргумент — params; default filter — awaiting_pickup.
    expect(listPackagesMock).toHaveBeenCalled();
    const firstCall = listPackagesMock.mock.calls[0];
    expect(firstCall[0]).toEqual({ status: 'awaiting_pickup' });
  });

  test('awaiting_pickup + admin → «Выдать», «Возврат», «Напомнить», «Утеряна»', async () => {
    listPackagesMock.mockResolvedValue({
      ok: true,
      count: 1,
      packages: [makePackage({ status: 'awaiting_pickup' })],
    });

    renderWithProviders(<PackagesAdminPage />, makeUser({ role: 'admin' }));

    // Ждём конкретную кнопку — это признак того, что запрос разрешился и
    // карточка отрисовала actions.  findByText('ждёт выдачи') двусмысленно:
    // такое же значение есть у option в dropdown'е фильтра.
    const pickupBtn = await screen.findByRole('button', { name: 'Выдать' });
    expect(pickupBtn).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Возврат' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Напомнить' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Утеряна' })).toBeInTheDocument();
  });

  test('awaiting_pickup + concierge → «Утеряна» скрыта', async () => {
    listPackagesMock.mockResolvedValue({
      ok: true,
      count: 1,
      packages: [makePackage({ status: 'awaiting_pickup' })],
    });

    renderWithProviders(<PackagesAdminPage />, makeUser({ role: 'concierge' }));

    const pickupBtn = await screen.findByRole('button', { name: 'Выдать' });
    expect(pickupBtn).toBeInTheDocument();
    // Admin-only destructive action — не показывать для concierge.
    expect(screen.queryByRole('button', { name: 'Утеряна' })).not.toBeInTheDocument();
  });

  test('awaiting_pickup + security → только «Выдать» из staff-actions', async () => {
    listPackagesMock.mockResolvedValue({
      ok: true,
      count: 1,
      packages: [makePackage({ status: 'awaiting_pickup' })],
    });

    renderWithProviders(<PackagesAdminPage />, makeUser({ role: 'security' }));

    expect(await screen.findByRole('button', { name: 'Выдать' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Возврат' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Напомнить' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Утеряна' })).not.toBeInTheDocument();
  });

  test('picked_up → action-ряд пустой, бейдж «выдана»', async () => {
    listPackagesMock.mockResolvedValue({
      ok: true,
      count: 1,
      packages: [
        makePackage({
          status: 'picked_up',
          picked_up_at: '2026-04-21T09:00:00Z',
          picked_up_by_name: 'Иванов И.И.',
        }),
      ],
    });

    renderWithProviders(<PackagesAdminPage />, makeUser({ role: 'admin' }));

    // Ждём рендер карточки — используем получателя как unique маркер
    // (такой строки нет ни в dropdown'е фильтра, ни в шапке страницы).
    expect(await screen.findByText('Иванов И.И.')).toBeInTheDocument();
    // Бейдж «выдана» внутри карточки (в dropdown тоже есть, но в карточке
    // это дублирующая проверка, поэтому просто убеждаемся, что текст есть).
    // Для terminal-статуса actions не рендерятся.
    expect(screen.queryByRole('button', { name: 'Выдать' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Возврат' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Напомнить' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Утеряна' })).not.toBeInTheDocument();
  });
});

// ─── OperationsDashboardPage ───────────────────────────────────────────────

describe('OperationsDashboardPage', () => {
  beforeEach(() => {
    getOperationsDashboardMock.mockReset();
    getAnalyticsTrafficMock.mockReset();
    getAnalyticsTopResidentsMock.mockReset();
    getAnalyticsSlaMock.mockReset();
    getAnalyticsRequestsMock.mockReset();
    getAnalyticsPackagesMock.mockReset();
    listAnalyticsSnapshotsMock.mockReset();
    getLatestAnalyticsSnapshotMock.mockReset();
    createAnalyticsSnapshotMock.mockReset();
  });

  test('property_id=null → предупреждение без запроса', () => {
    renderWithProviders(<OperationsDashboardPage />, makeUser({ property_id: null }));
    expect(screen.getByText(/не привязан к объекту/i)).toBeInTheDocument();
    expect(getOperationsDashboardMock).not.toHaveBeenCalled();
  });

  test('renders object-level KPIs from dashboard snapshot', async () => {
    getOperationsDashboardMock.mockResolvedValue({
      ok: true,
      dashboard: makeOperationsDashboard(),
    });
    getAnalyticsTrafficMock.mockResolvedValue({
      granularity: 'day',
      from: '2026-05-01T00:00:00.000Z',
      to: '2026-05-08T00:00:00.000Z',
      labels: ['2026-05-01T00:00:00.000Z'],
      series: { visits: [12], admitted: [10], denied: [2] },
    });
    getAnalyticsTopResidentsMock.mockResolvedValue({
      residents: [{
        uid: 'resident-1',
        name: 'Иван Петров',
        apartment: '42',
        pass_count: 3,
        guest_count: 2,
      }],
    });
    getAnalyticsSlaMock.mockResolvedValue({
      from: '2026-05-01T00:00:00.000Z',
      to: '2026-05-08T00:00:00.000Z',
      byType: [{
        type: 'plumbing',
        total: 5,
        within_sla: 4,
        overdue: 1,
        avg_resolution_hours: 2,
      }],
    });
    getAnalyticsRequestsMock.mockResolvedValue({
      byStatus: { pending: 3, done: 7 },
      byType: { plumbing: 5 },
      byHour: [{ hour: 9, count: 2 }],
    });
    getAnalyticsPackagesMock.mockResolvedValue({
      received: 8,
      picked_up: 6,
      pending: 2,
      avg_pickup_hours: 1.5,
    });
    listAnalyticsSnapshotsMock.mockResolvedValue({
      snapshots: [{
        id: 'snapshot-1',
        property_id: '00000000-0000-0000-0000-000000000bbb',
        metric_group: 'operations',
        period: '7d',
        generated_at: '2026-05-08T00:00:00.000Z',
      }],
    });
    getLatestAnalyticsSnapshotMock.mockResolvedValue({
      snapshot: {
        id: 'snapshot-1',
        property_id: '00000000-0000-0000-0000-000000000bbb',
        metric_group: 'operations',
        period: '7d',
        generated_at: '2026-05-08T00:00:00.000Z',
      },
    });
    createAnalyticsSnapshotMock.mockResolvedValue({
      snapshot: {
        id: 'snapshot-2',
        property_id: '00000000-0000-0000-0000-000000000bbb',
        period: '7d',
      },
      metrics: [],
    });

    renderWithProviders(<OperationsDashboardPage />, makeUser({ role: 'admin' }));

    expect(await screen.findByRole('heading', { name: /операционный обзор/i }))
      .toBeInTheDocument();
    expect(await screen.findByText('Открыто заявок')).toBeInTheDocument();
    expect(screen.getByText('Просроченный backlog')).toBeInTheDocument();
    expect(screen.getByText('Проходы и въезды')).toBeInTheDocument();
    expect(screen.getByText('Доставка уведомлений')).toBeInTheDocument();
    expect(screen.getByText('web_push')).toBeInTheDocument();
    expect(await screen.findByText('Детальная аналитика')).toBeInTheDocument();
    expect(screen.getByText('Traffic visits')).toBeInTheDocument();
    expect(screen.getByText('Иван Петров')).toBeInTheDocument();
    expect(screen.getByText('plumbing')).toBeInTheDocument();
    expect(screen.getByText('operations')).toBeInTheDocument();
    expect(getOperationsDashboardMock).toHaveBeenCalledWith(
      { period: '7d', property_id: '00000000-0000-0000-0000-000000000bbb' },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(getAnalyticsTrafficMock).toHaveBeenCalledWith(
      { granularity: 'day' },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(listAnalyticsSnapshotsMock).toHaveBeenCalledWith(
      { limit: 5, period: '7d', property_id: '00000000-0000-0000-0000-000000000bbb' },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Создать snapshot' }));

    await waitFor(() => {
      expect(createAnalyticsSnapshotMock).toHaveBeenCalledWith({
        period: '7d',
        property_id: '00000000-0000-0000-0000-000000000bbb',
      });
    });
  });
});

// ─── ManagementCompanyPortfolioPage ────────────────────────────────────────

describe('ManagementCompanyPortfolioPage', () => {
  beforeEach(() => {
    getManagementCompanyPortfolioMock.mockReset();
  });

  test('property context missing → warning without request', () => {
    renderWithProviders(
      <ManagementCompanyPortfolioPage />,
      makeUser({ role: 'management_company_admin', property_id: null, property_slug: null }),
    );

    expect(screen.getByText(/не привязана к объекту ук/i)).toBeInTheDocument();
    expect(getManagementCompanyPortfolioMock).not.toHaveBeenCalled();
  });

  test('renders portfolio KPIs, rankings and property comparison rows', async () => {
    getManagementCompanyPortfolioMock.mockResolvedValue({
      ok: true,
      portfolio: makeManagementCompanyPortfolio(),
    });

    renderWithProviders(
      <ManagementCompanyPortfolioPage />,
      makeUser({ role: 'management_company_admin' }),
    );

    expect(await screen.findByRole('heading', { name: /портфель ук/i }))
      .toBeInTheDocument();
    expect(await screen.findByText('Проблемные объекты')).toBeInTheDocument();
    expect(screen.getByText('Просроченный backlog')).toBeInTheDocument();
    expect(screen.getAllByText('Alpha Residence').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Beta Village')).toBeInTheDocument();
    expect(screen.getAllByText('SLA backlog').length).toBeGreaterThanOrEqual(1);
    expect(getManagementCompanyPortfolioMock).toHaveBeenCalledWith(
      { period: '7d', propertySlugs: [], includeInactive: false },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});

// ─── NotificationOperationsPage ───────────────────────────────────────────

describe('NotificationOperationsPage', () => {
  beforeEach(() => {
    getAdminOutboxMetricsMock.mockReset();
    getAdminOutboxSlaMock.mockReset();
    getOutboxHealthMock.mockReset();
    retryOutboxMock.mockReset();
    listAdminOutboxMock.mockReset();
    requeueAdminOutboxMock.mockReset();
    cancelAdminOutboxMock.mockReset();
    getNotificationLogMetricsMock.mockReset();
    getNotificationLogMetaMock.mockReset();
    listNotificationLogMock.mockReset();
  });

  test('property_id=null → предупреждение без запросов', () => {
    renderWithProviders(<NotificationOperationsPage />, makeUser({ property_id: null }));

    expect(screen.getByText(/администратор не привязан к объекту/i)).toBeInTheDocument();
    expect(getAdminOutboxMetricsMock).not.toHaveBeenCalled();
    expect(getAdminOutboxSlaMock).not.toHaveBeenCalled();
    expect(getOutboxHealthMock).not.toHaveBeenCalled();
    expect(listAdminOutboxMock).not.toHaveBeenCalled();
    expect(getNotificationLogMetricsMock).not.toHaveBeenCalled();
    expect(getNotificationLogMetaMock).not.toHaveBeenCalled();
    expect(listNotificationLogMock).not.toHaveBeenCalled();
  });

  test('payload скрыт по умолчанию, cancel требует подтверждения', async () => {
    getAdminOutboxMetricsMock.mockResolvedValue(makeAdminOutboxMetrics());
    getAdminOutboxSlaMock.mockResolvedValue(makeAdminOutboxSla());
    getOutboxHealthMock.mockResolvedValue(makeOutboxHealth());
    listAdminOutboxMock.mockResolvedValue({
      ok: true,
      items: [makeAdminOutboxRow()],
      count: 1,
      limit: 50,
      offset: 0,
    });
    getNotificationLogMetricsMock.mockResolvedValue(makeNotificationLogMetrics());
    getNotificationLogMetaMock.mockResolvedValue({ ok: true, limit_max: 250 });
    listNotificationLogMock.mockResolvedValue({
      ok: true,
      items: [],
      count: 0,
      limit: 50,
      offset: 0,
    });
    cancelAdminOutboxMock.mockResolvedValue({ ok: true });

    renderWithProviders(<NotificationOperationsPage />, makeUser({ role: 'admin' }));

    expect(await screen.findByText('Создана заявка на доступ')).toBeInTheDocument();
    expect(screen.queryByText(/visible only on demand/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Показать данные' }));
    expect(screen.getByText(/visible only on demand/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
    expect(cancelAdminOutboxMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить отмену' }));

    await waitFor(() => {
      expect(cancelAdminOutboxMock).toHaveBeenCalledWith('00000000-0000-0000-0000-0000000000f1');
    });
  });

  test('health/SLA рендерятся, bulk retry требует подтверждения', async () => {
    getAdminOutboxMetricsMock.mockResolvedValue(makeAdminOutboxMetrics({
      counts: { pending: 1, in_flight: 0, sent: 10, failed: 1, dead: 1 },
    }));
    getAdminOutboxSlaMock.mockResolvedValue(makeAdminOutboxSla());
    getOutboxHealthMock.mockResolvedValue(makeOutboxHealth());
    listAdminOutboxMock.mockResolvedValue({
      ok: true,
      items: [makeAdminOutboxRow({ status: 'failed', last_error: 'provider timeout' })],
      count: 1,
      limit: 50,
      offset: 0,
    });
    getNotificationLogMetricsMock.mockResolvedValue(makeNotificationLogMetrics());
    getNotificationLogMetaMock.mockResolvedValue({ ok: true, limit_max: 250 });
    listNotificationLogMock.mockResolvedValue({
      ok: true,
      items: [],
      count: 0,
      limit: 50,
      offset: 0,
    });
    retryOutboxMock.mockResolvedValue({
      ok: true,
      revived: 1,
      revivedIds: ['00000000-0000-0000-0000-0000000000f1'],
    });

    renderWithProviders(<NotificationOperationsPage />, makeUser({ role: 'admin' }));

    expect(await screen.findByText('Восстановление outbox')).toBeInTheDocument();
    expect(screen.getByText('SLA по посылкам')).toBeInTheDocument();
    expect(screen.getByText(/Серверный лимит выборки: 250/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Повторить ошибки' }));
    expect(retryOutboxMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить повтор ошибок' }));

    await waitFor(() => {
      expect(retryOutboxMock).toHaveBeenCalledWith({ status: 'failed', limit: 100 });
    });
  });
});
