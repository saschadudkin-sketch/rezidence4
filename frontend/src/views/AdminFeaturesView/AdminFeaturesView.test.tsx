/**
 * views/AdminFeaturesView/AdminFeaturesView.test.tsx
 * Basic test for AdminFeaturesView component
 *
 * AdminFeaturesView рендерит лейблы/категории/описания исключительно из
 * backend-схемы (FeatureFlagsContext → GET /admin/feature-flags/schema).
 * Без мока schema компонент видит только синтетический fallback `{label: key}`
 * и не покажет ни 'Основные', ни 'Чат'. Поэтому здесь мокаем apiClient так,
 * чтобы он отдал ту же форму, что и backend (см. backend/src/config/featureFlags.js).
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { AdminFeaturesView } from './AdminFeaturesView';
import { FeatureFlagsProvider } from '../../contexts/FeatureFlagsContext';
import { apiClient } from '../../services/providers/apiClient';
import { describe, expect, test, vi, beforeEach } from 'vitest';

// Mock the useAuth hook to return admin user
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { role: 'admin', uid: 'admin1' }
  })
}));

// Schema-mock соответствует backend/src/config/featureFlags.js (registry — единый источник правды).
const SCHEMA_RESPONSE = {
  flags: [
    { key: 'chat',             label: 'Чат',                    description: 'Чат жильцов с управляющей компанией и охраной', category: 'core',           default: true,  locked: true  },
    { key: 'announcements',    label: 'Объявления',             description: 'Новости и объявления от управляющей компании',  category: 'communication',  default: false, locked: false },
    { key: 'documents',        label: 'Документы и правила',    description: 'Правила, инструкции, документы в открытом доступе', category: 'communication', default: false, locked: false },
    { key: 'kiosk_mode',       label: 'Киоск-режим (холл)',     description: 'Публичный экран в холле для гостей (/info)',    category: 'communication',  default: false, locked: false },
    { key: 'qr_pass',          label: 'QR-пропуска',            description: 'Автоматические QR-коды для гостевых пропусков', category: 'access',         default: false, locked: false },
    { key: 'meter_readings',   label: 'Показания счётчиков',    description: 'Подача показаний счётчиков воды и электричества', category: 'resident',     default: false, locked: false },
    { key: 'billing',          label: 'Финансы и начисления',   description: 'Начисления и оплата коммунальных услуг',        category: 'resident',       default: false, locked: false },
    { key: 'space_booking',    label: 'Бронирование зон',       description: 'Бронирование переговорных, барбекю, спортзала', category: 'resident',       default: false, locked: false },
    { key: 'packages',         label: 'Посылки и доставки',     description: 'Учёт посылок и уведомление о доставке',         category: 'concierge',      default: false, locked: false },
    { key: 'telegram_bot',     label: 'Telegram-уведомления',   description: 'Уведомления жильцам и охране в Telegram',       category: 'notifications',  default: false, locked: false },
    { key: 'webhooks',         label: 'Webhook-интеграции',     description: 'Интеграция с внешними системами через webhook', category: 'integrations',   default: false, locked: false },
    { key: 'skud_integration', label: 'СКУД-интеграция',        description: 'Автоматическое управление СКУД при пропусках', category: 'integrations',   default: false, locked: false },
    { key: 'video_evidence',   label: 'Видео-доказательства',   description: 'Привязка камер, клипов и снимков к событиям доступа и инцидентам', category: 'integrations', default: false, locked: false },
    { key: 'analytics',        label: 'Аналитика',              description: 'Статистика посещений, заявок и работы объекта', category: 'admin',          default: false, locked: false },
    { key: 'legacy_utilities_enabled', label: 'Устаревшие модули (legacy)', description: 'Разморозить показания, биллинг, бронирования и чат (временно, до пост-релиза)', category: 'admin', default: false, locked: false },
  ],
  categories: [
    { key: 'core',           label: 'Основные',          order: 1 },
    { key: 'communication',  label: 'Коммуникация',      order: 2 },
    { key: 'access',         label: 'Доступ',            order: 3 },
    { key: 'resident',       label: 'Для жильцов',       order: 4 },
    { key: 'concierge',      label: 'Консьерж',          order: 5 },
    { key: 'notifications',  label: 'Уведомления',       order: 6 },
    { key: 'integrations',   label: 'Интеграции',        order: 7 },
    { key: 'admin',          label: 'Администрирование', order: 8 },
  ],
};

// Resolved values map: только chat/locked = true, остальные default=false.
const VALUES_RESPONSE: Record<string, boolean> = SCHEMA_RESPONSE.flags.reduce((acc, f) => {
  acc[f.key] = f.default;
  return acc;
}, {} as Record<string, boolean>);

// Mock the API client — route-aware, как и реальный backend.
vi.mock('../../services/providers/apiClient', () => ({
  apiClient: {
    get: vi.fn((url: string) => {
      if (url.endsWith('/feature-flags/schema')) return Promise.resolve(SCHEMA_RESPONSE);
      if (url.endsWith('/feature-flags'))        return Promise.resolve(VALUES_RESPONSE);
      return Promise.resolve({});
    }),
    patch: vi.fn().mockResolvedValue({}),
  },
}));

// Live mode = true, чтобы FeatureFlagsContext.hydrate() реально дернул schema.
vi.mock('../../config/runtimeMode', () => ({
  isLiveMode: () => true,
}));

function renderWithProvider(component: React.ReactElement) {
  return render(
    <FeatureFlagsProvider>
      {component}
    </FeatureFlagsProvider>
  );
}

describe('AdminFeaturesView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('renders main title and subtitle', async () => {
    renderWithProvider(<AdminFeaturesView />);

    // Wait for the component to load
    await screen.findByText('Настройки функций');
    expect(screen.getByText('Включайте только те возможности, которые нужны вашему объекту')).toBeInTheDocument();
  });

  test('shows category cards after loading', async () => {
    renderWithProvider(<AdminFeaturesView />);

    // Wait for loading to complete and check for category headers
    await screen.findByText('Основные');
    expect(screen.getByText('Коммуникация')).toBeInTheDocument();
    expect(screen.getByText('Доступ')).toBeInTheDocument();
  });

  test('shows chat feature as disabled (always on)', async () => {
    renderWithProvider(<AdminFeaturesView />);

    // Backend label = 'Чат' (категория 'Основные'); описание полностью совпадает с registry.
    await screen.findByText('Чат');
    expect(screen.getByText('Чат жильцов с управляющей компанией и охраной')).toBeInTheDocument();
  });

  test('switches have accessible names from backend labels', async () => {
    renderWithProvider(<AdminFeaturesView />);

    expect(await screen.findByRole('switch', { name: 'QR-пропуска' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('switch', { name: 'Чат' })).toHaveAttribute('aria-checked', 'true');
  });

  test('shows load error instead of fallback technical flag keys', async () => {
    vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('offline'));

    renderWithProvider(<AdminFeaturesView />);

    expect(await screen.findByText('Не удалось загрузить настройки')).toBeInTheDocument();
    expect(screen.getByText('Проверьте соединение с сервером')).toBeInTheDocument();
    expect(screen.queryByText('legacy_utilities_enabled')).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });
});
