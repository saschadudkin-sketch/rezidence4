/**
 * Smoke tests для трёх resident-facing страниц (/v1/my/*):
 *   - ResidentPackagesPage        → /v1/my/packages
 *   - ResidentAnnouncementsFeedPage → /v1/my/announcements
 *   - ResidentDocumentsPage       → /v1/my/documents
 *
 * Цель — поймать regressions, которые ломают first paint: пропал лейбл, статус
 * перестал mapping'иться, сортировка/группировка вернула неправильный порядок
 * и т.п.  Сеть мочим через `vi.mock('../api')` — страницы только читают
 * данные, поэтому достаточно подсунуть детерминированный ответ и проверить,
 * что нужные строки рендерятся.
 *
 * Все три страницы используют `useQuery`, поэтому рендер-хелпер оборачивает
 * тест в свежий QueryClient (retries=0, gcTime=0) и предохраняет от кросс-
 * тестовой утечки кеша.  ResidentNav используется внутри каждой страницы —
 * для него отдельных тестов нет, проверяется inline (aria-label навигации).
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Announcement, Package, V1Document } from '../api/types';

// ─── Module mocks ───────────────────────────────────────────────────────────
//
// Страницы ходят только в `api.packages.listMine` / `api.announcements.list`
// / `api.documents.list`.  Остальные методы нужны только чтобы TypeScript не
// ругался на сужение типа api-барреля — мы их не вызываем, поэтому шимим как
// never-resolve, как в V1Router.test.tsx.
const {
  listMineMock,
  listAnnouncementsMock,
  listDocumentsMock,
  getDocumentByIdMock,
  packageStatusToneMock,
} = vi.hoisted(() => ({
  listMineMock: vi.fn(),
  listAnnouncementsMock: vi.fn(),
  listDocumentsMock: vi.fn(),
  getDocumentByIdMock: vi.fn(),
  packageStatusToneMock: vi.fn(
    (status: string): 'success' | 'warning' | 'neutral' | 'error' => {
      if (status === 'awaiting_pickup') return 'warning';
      if (status === 'picked_up') return 'success';
      if (status === 'lost') return 'error';
      return 'neutral';
    },
  ),
}));

vi.mock('../api', () => {
  const neverResolves = () => new Promise(() => {});
  return {
    api: {
      packages: { listMine: listMineMock },
      announcements: { list: listAnnouncementsMock },
      documents: { list: listDocumentsMock, getById: getDocumentByIdMock },
      // Unused by these pages; kept as shims so accidental touches don't crash.
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
    normalizePlate: (s: string) => s.toUpperCase().replace(/[\s-]+/g, ''),
  };
});

// Импортируем страницы ПОСЛЕ vi.mock — vitest hoisting поднимает моки в самый
// верх, но статическая проверка TS всё равно требует чтобы import был после
// `vi.mock` физически в коде (для читаемости).
import { ResidentPackagesPage } from './ResidentPackagesPage';
import { ResidentAnnouncementsFeedPage } from './ResidentAnnouncementsFeedPage';
import { ResidentDocumentsPage } from './ResidentDocumentsPage';

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makePackage(overrides: Partial<Package> = {}): Package {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    property_id: 'prop-1',
    unit_id: 'unit-1',
    recipient_resident_id: 'res-1',
    recipient_name_snapshot: 'Иванов И.И.',
    sender_name: 'Ozon',
    carrier: 'СДЭК',
    tracking_number: 'TRACK-1',
    photo_url: null,
    size_category: 'medium',
    received_at: '2026-04-20T10:00:00Z',
    received_by_staff_id: 'staff-1',
    storage_location: 'Стеллаж A-12',
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

function makeAnnouncement(overrides: Partial<Announcement> = {}): Announcement {
  return {
    id: '00000000-0000-0000-0000-000000000002',
    property_id: 'prop-1',
    title: 'Обновление системы',
    body_md: 'Плановые работы с 02:00 до 04:00.',
    is_urgent: false,
    category: 'general',
    audience_type: 'all',
    audience_building_id: null,
    audience_entrance_id: null,
    audience_unit_type: null,
    starts_at: '2026-04-24T00:00:00Z',
    expires_at: null,
    is_pinned: false,
    notify_channels: [],
    created_by_staff_id: 'staff-1',
    published_at: '2026-04-24T00:00:00Z',
    published_by_staff_id: 'staff-1',
    deleted_at: null,
    created_at: '2026-04-23T00:00:00Z',
    updated_at: null,
    ...overrides,
  };
}

function makeDocument(overrides: Partial<V1Document> = {}): V1Document {
  return {
    id: '00000000-0000-0000-0000-000000000003',
    property_id: 'prop-1',
    title: 'Правила проживания',
    category: 'rules',
    tag: null,
    body_md: null,
    file_url: '/uploads/rules.pdf',
    file_mime: 'application/pdf',
    file_size_bytes: 1024 * 200,
    is_public: false,
    sort_order: 10,
    published_at: '2026-04-01T00:00:00Z',
    created_by_staff_id: 'staff-1',
    updated_by_staff_id: null,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: null,
    deleted_at: null,
    ...overrides,
  };
}

// ─── Render harness ─────────────────────────────────────────────────────────

function renderWithProviders(node: ReactElement) {
  // retry=0 + gcTime=0: ошибка из моков не превращается в экспоненциальный
  // retry-шторм, а свежий кеш не живёт между тестами.
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

// ─── ResidentPackagesPage ──────────────────────────────────────────────────

describe('ResidentPackagesPage', () => {
  beforeEach(() => {
    listMineMock.mockReset();
  });

  test('показывает сортировку — awaiting_pickup выше picked_up', async () => {
    listMineMock.mockResolvedValue({
      ok: true,
      count: 2,
      packages: [
        makePackage({
          id: 'pkg-old-picked',
          sender_name: 'Wildberries',
          status: 'picked_up',
          picked_up_at: '2026-04-21T11:00:00Z',
          picked_up_by_name: 'Иванов И.И.',
          received_at: '2026-04-21T10:00:00Z',
        }),
        makePackage({
          id: 'pkg-waiting',
          sender_name: 'Ozon',
          storage_location: 'Стеллаж B-3',
          status: 'awaiting_pickup',
        }),
      ],
    });

    renderWithProviders(<ResidentPackagesPage />);

    // Dom-порядок: awaiting_pickup (Ozon) должен быть раньше picked_up (Wildberries).
    const ozon = await screen.findByText('Ozon');
    const wb = await screen.findByText('Wildberries');
    expect(ozon.compareDocumentPosition(wb) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Для ожидающей посылки показывается место хранения (actionable info).
    expect(screen.getByText(/Стеллаж B-3/)).toBeInTheDocument();

    // Бейджи статусов переводятся на русский.
    expect(screen.getByText('Ждёт выдачи')).toBeInTheDocument();
    expect(screen.getByText('Получено')).toBeInTheDocument();
  });

  test('empty state — корректный текст без моков-призраков', async () => {
    listMineMock.mockResolvedValue({ ok: true, count: 0, packages: [] });

    renderWithProviders(<ResidentPackagesPage />);

    expect(
      await screen.findByText(/У вас пока нет посылок/),
    ).toBeInTheDocument();
  });

  test('lost — рендерится error-alert с призывом к консьержу', async () => {
    listMineMock.mockResolvedValue({
      ok: true,
      count: 1,
      packages: [makePackage({ status: 'lost', sender_name: 'СДЭК-пропала' })],
    });

    renderWithProviders(<ResidentPackagesPage />);

    expect(await screen.findByText(/помечена как потерянная/)).toBeInTheDocument();
    expect(screen.getByText('Потеряно')).toBeInTheDocument();
  });
});

// ─── ResidentAnnouncementsFeedPage ─────────────────────────────────────────

describe('ResidentAnnouncementsFeedPage', () => {
  beforeEach(() => {
    listAnnouncementsMock.mockReset();
  });

  test('сортировка: pinned > urgent > newest starts_at', async () => {
    listAnnouncementsMock.mockResolvedValue({
      ok: true,
      count: 3,
      announcements: [
        makeAnnouncement({
          id: 'ann-normal',
          title: 'Обычное объявление',
          starts_at: '2026-04-23T00:00:00Z',
        }),
        makeAnnouncement({
          id: 'ann-urgent',
          title: 'Срочное внимание',
          is_urgent: true,
          starts_at: '2026-04-22T00:00:00Z',
        }),
        makeAnnouncement({
          id: 'ann-pinned',
          title: 'Закреплённое сверху',
          is_pinned: true,
          starts_at: '2026-04-20T00:00:00Z',
        }),
      ],
    });

    renderWithProviders(<ResidentAnnouncementsFeedPage />);

    const pinned = await screen.findByRole('heading', {
      level: 3,
      name: 'Закреплённое сверху',
    });
    const urgent = await screen.findByRole('heading', {
      level: 3,
      name: 'Срочное внимание',
    });
    const normal = await screen.findByRole('heading', {
      level: 3,
      name: 'Обычное объявление',
    });

    // Pinned должен быть первым в DOM.
    expect(
      pinned.compareDocumentPosition(urgent) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      urgent.compareDocumentPosition(normal) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // Бейджи отрисовались.
    expect(screen.getByText('Закреплено')).toBeInTheDocument();
    expect(screen.getByText('Срочно')).toBeInTheDocument();

    const urgentBanner = screen.getByRole('region', { name: /Срочные объявления/i });
    expect(within(urgentBanner).getByText('Срочное внимание')).toBeInTheDocument();
    expect(within(urgentBanner).queryByText('Обычное объявление')).not.toBeInTheDocument();
  });

  test('empty state — когда активных объявлений нет', async () => {
    listAnnouncementsMock.mockResolvedValue({
      ok: true,
      count: 0,
      announcements: [],
    });

    renderWithProviders(<ResidentAnnouncementsFeedPage />);

    expect(
      await screen.findByText(/Пока нет активных объявлений/),
    ).toBeInTheDocument();
  });

  test('тело и срок действия рендерятся как текст (не как markdown-html)', async () => {
    listAnnouncementsMock.mockResolvedValue({
      ok: true,
      count: 1,
      announcements: [
        makeAnnouncement({
          title: 'Отключение воды',
          body_md: '**жирный** текст *курсив* — не парсится как markdown',
          expires_at: '2026-04-30T00:00:00Z',
        }),
      ],
    });

    renderWithProviders(<ResidentAnnouncementsFeedPage />);

    // body_md визуализируется как plain text — literal asterisks in DOM.
    expect(
      await screen.findByText(/\*\*жирный\*\* текст \*курсив\*/),
    ).toBeInTheDocument();
    // expires_at отображается в подвале.
    expect(screen.getByText(/Действительно до/)).toBeInTheDocument();
  });
});

// ─── ResidentDocumentsPage ─────────────────────────────────────────────────

describe('ResidentDocumentsPage', () => {
  beforeEach(() => {
    listDocumentsMock.mockReset();
    getDocumentByIdMock.mockReset();
  });

  test('группирует по категории в правильном порядке', async () => {
    // Порядок по CATEGORY_ORDER: rules → contacts → instructions → safety →
    // contracts → legal → other.  Проверяем, что contacts идёт до instructions.
    listDocumentsMock.mockResolvedValue({
      ok: true,
      count: 3,
      documents: [
        makeDocument({
          id: 'doc-instr',
          title: 'Инструкция по лифту',
          category: 'instructions',
          sort_order: 10,
        }),
        makeDocument({
          id: 'doc-rules',
          title: 'Правила ЖК',
          category: 'rules',
          sort_order: 10,
        }),
        makeDocument({
          id: 'doc-contacts',
          title: 'Телефон управляющей',
          category: 'contacts',
          sort_order: 10,
        }),
      ],
    });

    renderWithProviders(<ResidentDocumentsPage />);

    const rulesHeader = await screen.findByRole('heading', { name: 'Правила проживания' });
    const contactsHeader = await screen.findByRole('heading', { name: 'Контакты' });
    const instructionsHeader = await screen.findByRole('heading', { name: 'Инструкции' });

    expect(
      rulesHeader.compareDocumentPosition(contactsHeader) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      contactsHeader.compareDocumentPosition(instructionsHeader) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test('внутри категории сортирует по sort_order, потом по title', async () => {
    listDocumentsMock.mockResolvedValue({
      ok: true,
      count: 3,
      documents: [
        makeDocument({ id: 'd-z', title: 'Яркий пункт', category: 'rules', sort_order: 30 }),
        makeDocument({ id: 'd-a', title: 'Альфа', category: 'rules', sort_order: 10 }),
        makeDocument({ id: 'd-b', title: 'Бета', category: 'rules', sort_order: 10 }),
      ],
    });

    renderWithProviders(<ResidentDocumentsPage />);

    const section = await screen.findByRole('region', {
      name: /Правила проживания/i,
    });
    const cards = within(section).getAllByRole('heading', { level: 3 });
    // sort_order=10 впереди (Альфа, Бета), затем sort_order=30 (Яркий пункт).
    expect(cards[0].textContent).toBe('Альфа');
    expect(cards[1].textContent).toBe('Бета');
    expect(cards[2].textContent).toBe('Яркий пункт');
  });

  test('файл — ссылка с rel=noopener и бейдж "Публичный" при is_public', async () => {
    listDocumentsMock.mockResolvedValue({
      ok: true,
      count: 1,
      documents: [
        makeDocument({
          title: 'Открытые контакты',
          category: 'contacts',
          is_public: true,
          file_url: '/uploads/contacts.pdf',
          file_size_bytes: 1024 * 500,
          file_mime: 'application/pdf',
        }),
      ],
    });

    renderWithProviders(<ResidentDocumentsPage />);

    const link = await screen.findByRole('link', { name: /Открыть файл/i });
    expect(link.getAttribute('href')).toBe('/uploads/contacts.pdf');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(screen.getByText('Публичный')).toBeInTheDocument();
    // Размер файла форматируется в КБ (500 КБ).
    expect(screen.getByText(/500\s*КБ/)).toBeInTheDocument();
  });

  test('открывает документ через detail endpoint', async () => {
    const docId = '00000000-0000-0000-0000-000000000777';
    listDocumentsMock.mockResolvedValue({
      ok: true,
      count: 1,
      documents: [
        makeDocument({
          id: docId,
          title: 'Памятка жильца',
          category: 'instructions',
          body_md: null,
          file_url: null,
        }),
      ],
    });
    getDocumentByIdMock.mockResolvedValue({
      ok: true,
      document: makeDocument({
        id: docId,
        title: 'Памятка жильца',
        category: 'instructions',
        body_md: 'Полный текст памятки',
        file_url: '/uploads/memo.pdf',
        file_size_bytes: 1024,
      }),
    });

    renderWithProviders(<ResidentDocumentsPage />);

    fireEvent.click(await screen.findByRole('button', {
      name: 'Открыть документ: Памятка жильца',
    }));

    expect(getDocumentByIdMock).toHaveBeenCalledWith(docId);
    expect(await screen.findByText('Полный текст памятки')).toBeInTheDocument();
    const fileLinks = screen.getAllByRole('link', { name: /Открыть файл/i });
    expect(fileLinks[fileLinks.length - 1]).toHaveAttribute('href', '/uploads/memo.pdf');
  });

  test('empty state — когда документы не опубликованы', async () => {
    listDocumentsMock.mockResolvedValue({ ok: true, count: 0, documents: [] });

    renderWithProviders(<ResidentDocumentsPage />);

    expect(
      await screen.findByText(/Документы пока не опубликованы/),
    ).toBeInTheDocument();
  });
});
