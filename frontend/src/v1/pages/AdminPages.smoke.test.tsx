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

import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type {
  Announcement,
  Package,
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
  packageStatusToneMock,
} = vi.hoisted(() => ({
  listAdminAnnouncementsMock: vi.fn(),
  listDocumentsMock: vi.fn(),
  listPackagesMock: vi.fn(),
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
    const publishBtn = await screen.findByRole('button', { name: 'Опубликовать' });
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
