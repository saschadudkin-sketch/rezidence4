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
    { key: 'chat', label: 'Чат', description: 'Базовый чат жильцов с управляющей компанией и охраной. Включён всегда.', category: 'core', default: true, locked: true },
    { key: 'announcements', label: 'Объявления', description: 'Публикация новостей, уведомлений и объявлений для жильцов объекта.', category: 'communication', default: false, locked: false },
    { key: 'documents', label: 'Документы и правила', description: 'Раздел с правилами, инструкциями и документами объекта для жильцов и гостей.', category: 'communication', default: false, locked: false },
    { key: 'kiosk_mode', label: 'Киоск-режим (холл)', description: 'Публичный информационный экран для холла или стойки ресепшен.', category: 'communication', default: false, locked: false },
    { key: 'qr_pass', label: 'QR-пропуска', description: 'Выпуск QR-кодов для гостевых и сервисных пропусков.', category: 'access', default: false, locked: false },
    { key: 'manual_access_approval', label: 'Ручное согласование пропусков', description: 'Пропуск выпускается только после ручного решения охраны или консьержа.', category: 'access', default: false, locked: false },
    { key: 'trusted_visitors', label: 'Постоянные гости', description: 'Жильцы могут сохранять частых гостей и быстро создавать для них аудируемые пропуска.', category: 'access', default: false, locked: false },
    { key: 'pin_credentials', label: 'PIN-пропуска', description: 'Дополнительный PIN для пропусков с ограничением попыток и журналом безопасности.', category: 'access', default: false, locked: false },
    { key: 'public_pass_v1', label: 'Публичная страница v1-пропуска', description: 'Безопасная публичная страница пропуска для гостя без внутренних данных объекта.', category: 'access', default: false, locked: false },
    { key: 'security_workspace_enriched', label: 'Расширенное рабочее место охраны', description: 'Пульт охраны с поиском, сканированием, ручными решениями и загрузкой offline-событий.', category: 'access', default: false, locked: false },
    { key: 'guard_authorized_devices', label: 'Авторизованные устройства охраны', description: 'Ограничивает ручные решения охраны только подтверждёнными устройствами КПП.', category: 'access', default: false, locked: false },
    { key: 'meter_readings', label: 'Показания счётчиков', description: 'Жильцы передают показания счётчиков воды и электричества через приложение.', category: 'resident', default: false, locked: false },
    { key: 'billing', label: 'Финансы и начисления', description: 'Просмотр начислений, счетов и статусов оплаты коммунальных услуг.', category: 'resident', default: false, locked: false },
    { key: 'space_booking', label: 'Бронирование зон', description: 'Бронирование общих пространств: переговорных, барбекю-зон, спортзала и других помещений.', category: 'resident', default: false, locked: false },
    { key: 'packages', label: 'Посылки и доставки', description: 'Учёт посылок на посту и уведомления жильцам о получении.', category: 'concierge', default: false, locked: false },
    { key: 'telegram_bot', label: 'Telegram-уведомления', description: 'Доставка уведомлений жильцам, охране и персоналу через Telegram.', category: 'notifications', default: false, locked: false },
    { key: 'webhooks', label: 'Вебхуки', description: 'Отправка событий DomHub во внешние системы через вебхук-подписки.', category: 'integrations', default: false, locked: false },
    { key: 'skud_integration', label: 'СКУД-интеграция', description: 'Связь с контроллерами СКУД, провайдерами доступа и журналом отказов интеграции.', category: 'integrations', default: false, locked: false },
    { key: 'video_evidence', label: 'Видео-доказательства', description: 'Привязка камер, снимков и видеоклипов к событиям доступа и инцидентам.', category: 'integrations', default: false, locked: false },
    { key: 'erp_exchange', label: 'ERP / 1C обмен', description: 'Импорт справочников и экспорт операционных сводок для ERP, 1C и ЖКХ-систем.', category: 'integrations', default: false, locked: false },
    { key: 'gis_oss_readiness', label: 'ГИС ЖКХ / ОСС: подготовка', description: 'Подготовка пакетов документов для ГИС ЖКХ и ОСС без юридически значимого голосования внутри DomHub.', category: 'integrations', default: false, locked: false },
    { key: 'analytics', label: 'Аналитика', description: 'Операционные метрики по заявкам, доступу, инцидентам, уведомлениям и работе объекта.', category: 'admin', default: false, locked: false },
    { key: 'legacy_utilities_enabled', label: 'Устаревшие модули (legacy)', description: 'Временно открывает старые модули показаний, биллинга, бронирований и чата до их полной миграции.', category: 'admin', default: false, locked: false },
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
    expect(screen.getByText('Базовый чат жильцов с управляющей компанией и охраной. Включён всегда.')).toBeInTheDocument();
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
