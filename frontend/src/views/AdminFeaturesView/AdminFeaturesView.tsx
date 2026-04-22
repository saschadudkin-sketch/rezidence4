import React, { useState } from 'react';
import { Card } from '../../ui';
import { Toggle } from '../../ui';
import { Spinner } from '../../ui';
import { EmptyState } from '../../ui';
import { useFeatureFlags, type FeatureFlags } from '../../hooks/useFeatureFlag';
import { toast } from '../../ui/Toasts';
import styles from './AdminFeaturesView.module.css';

// Category configuration
const FEATURE_CATEGORIES = {
  core: {
    label: 'Основные',
    order: 1,
  },
  communication: {
    label: 'Коммуникация',
    order: 2,
  },
  access: {
    label: 'Доступ',
    order: 3,
  },
  resident: {
    label: 'Для жильцов',
    order: 4,
  },
  concierge: {
    label: 'Консьерж',
    order: 5,
  },
  notifications: {
    label: 'Уведомления',
    order: 6,
  },
  integrations: {
    label: 'Интеграции',
    order: 7,
  },
  admin: {
    label: 'Администрирование',
    order: 8,
  },
} as const;

// Feature descriptions
const FEATURE_DESCRIPTIONS: Record<keyof FeatureFlags, string> = {
  chat: 'Чат жильцов с управляющей компанией и охраной',
  announcements: 'Новости и объявления от управляющей компании',
  documents: 'Правила, инструкции, документы в открытом доступе',
  kiosk_mode: 'Публичный экран в холле для гостей (/info)',
  qr_pass: 'Автоматические QR-коды для гостевых пропусков',
  meter_readings: 'Подача показаний счётчиков воды и электричества',
  billing: 'Начисления и оплата коммунальных услуг',
  space_booking: 'Бронирование переговорных, барбекю, спортзала',
  packages: 'Учёт посылок и уведомление о доставке',
  telegram_bot: 'Уведомления жильцам и охране в Telegram',
  webhooks: 'Интеграция с внешними системами через webhook',
  skud_integration: 'Автоматическое управление СКУД при пропусках',
  analytics: 'Статистика посещений, заявок и работы объекта',
};

// Loading skeleton card
function SkeletonCard() {
  return (
    <Card padding="lg" className={styles.skeletonCard}>
      <div className={styles.skeletonHeader} />
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className={styles.skeletonRow}>
          <div className={styles.skeletonText} />
          <div className={styles.skeletonToggle} />
        </div>
      ))}
    </Card>
  );
}

interface FeatureRowProps {
  flagKey: keyof FeatureFlags;
  label: string;
  description: string;
  value: boolean;
  isDisabled: boolean;
  isUpdating: boolean;
  onToggle: (flagKey: keyof FeatureFlags, value: boolean) => void;
}

function FeatureRow({
  flagKey,
  label,
  description,
  value,
  isDisabled,
  isUpdating,
  onToggle,
}: FeatureRowProps) {
  return (
    <div className={styles.featureRow}>
      <div className={styles.featureContent}>
        <div className={styles.featureLabel}>{label}</div>
        <div className={styles.featureDescription}>{description}</div>
      </div>
      <div className={styles.featureControl}>
        {isUpdating ? (
          <Spinner size="sm" />
        ) : (
          <Toggle
            checked={value}
            onChange={(newValue) => onToggle(flagKey, newValue)}
            disabled={isDisabled}
            size="md"
          />
        )}
      </div>
    </div>
  );
}

export function AdminFeaturesView() {
  const { flags, flagsMeta, isLoaded, updateFlag } = useFeatureFlags();
  const [updatingFlags, setUpdatingFlags] = useState<Set<keyof FeatureFlags>>(new Set());

  const handleToggleFlag = async (flagKey: keyof FeatureFlags, value: boolean) => {
    if (flagKey === 'chat') return; // Chat is always enabled

    setUpdatingFlags(prev => new Set(prev).add(flagKey));

    try {
      await updateFlag(flagKey, value);
      toast('Настройки сохранены', 'success');
    } catch (error) {
      toast('Не удалось сохранить настройки', 'error');
    } finally {
      setUpdatingFlags(prev => {
        const next = new Set(prev);
        next.delete(flagKey);
        return next;
      });
    }
  };

  // Group flags by category
  const flagsByCategory = Object.entries(flagsMeta).reduce((acc, [flagKey, meta]) => {
    const key = flagKey as keyof FeatureFlags;
    if (!acc[meta.category]) {
      acc[meta.category] = [];
    }
    acc[meta.category].push({
      key,
      meta,
    });
    return acc;
  }, {} as Record<string, Array<{ key: keyof FeatureFlags; meta: any }>>);

  // Sort categories by order
  const sortedCategories = Object.keys(flagsByCategory).sort((a, b) => {
    const orderA = FEATURE_CATEGORIES[a as keyof typeof FEATURE_CATEGORIES]?.order || 999;
    const orderB = FEATURE_CATEGORIES[b as keyof typeof FEATURE_CATEGORIES]?.order || 999;
    return orderA - orderB;
  });

  if (!isLoaded) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <h1 className={styles.title}>Настройки функций</h1>
          <p className={styles.subtitle}>
            Включайте только те возможности, которые нужны вашему объекту
          </p>
        </div>
        <div className={styles.skeletonGrid}>
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (!flags) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <h1 className={styles.title}>Настройки функций</h1>
        </div>
        <EmptyState
          title="Не удалось загрузить настройки"
          subtitle="Проверьте соединение с сервером"
          actionLabel="Обновить"
          onAction={() => window.location.reload()}
        />
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Настройки функций</h1>
        <p className={styles.subtitle}>
          Включайте только те возможности, которые нужны вашему объекту
        </p>
      </div>

      <div className={styles.categoriesGrid}>
        {sortedCategories.map(categoryKey => {
          const categoryInfo = FEATURE_CATEGORIES[categoryKey as keyof typeof FEATURE_CATEGORIES];
          const categoryFlags = flagsByCategory[categoryKey];

          if (!categoryInfo || !categoryFlags) return null;

          return (
            <Card key={categoryKey} padding="lg" className={styles.categoryCard}>
              <div className={styles.categoryHeader}>
                <h2 className={styles.categoryTitle}>{categoryInfo.label}</h2>
              </div>
              <div className={styles.categoryFeatures}>
                {categoryFlags.map(({ key, meta }) => (
                  <FeatureRow
                    key={key}
                    flagKey={key}
                    label={meta.label}
                    description={FEATURE_DESCRIPTIONS[key]}
                    value={flags[key]}
                    isDisabled={key === 'chat'} // Chat is always on and disabled
                    isUpdating={updatingFlags.has(key)}
                    onToggle={handleToggleFlag}
                  />
                ))}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}