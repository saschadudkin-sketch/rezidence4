import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { useAuth } from '../hooks/useAuth';
import { apiClient } from '../services/providers/apiClient';
import { logger } from '../services/logger';
import { isLiveMode } from '../config/runtimeMode';

export interface FeatureFlags {
  chat: boolean;
  announcements: boolean;
  documents: boolean;
  kiosk_mode: boolean;
  qr_pass: boolean;
  meter_readings: boolean;
  billing: boolean;
  space_booking: boolean;
  packages: boolean;
  telegram_bot: boolean;
  webhooks: boolean;
  skud_integration: boolean;
  analytics: boolean;
}

export interface FlagMeta {
  value: boolean;
  label: string;
  category: string;
}

interface FeatureFlagsContextValue {
  flags: FeatureFlags;
  flagsMeta: Record<keyof FeatureFlags, FlagMeta>;
  isLoaded: boolean;
  isFeatureEnabled: (flag: keyof FeatureFlags) => boolean;
  updateFlag: (flag: keyof FeatureFlags, value: boolean) => Promise<void>;
}

const FeatureFlagsContext = createContext<FeatureFlagsContextValue | null>(null);

// Default flags (before fetch completes)
const DEFAULT_FLAGS: FeatureFlags = {
  chat: true, // Always enabled
  announcements: false,
  documents: false,
  kiosk_mode: false,
  qr_pass: false,
  meter_readings: false,
  billing: false,
  space_booking: false,
  packages: false,
  telegram_bot: false,
  webhooks: false,
  skud_integration: false,
  analytics: false,
};

// Metadata for UI presentation
const FLAGS_META: Record<keyof FeatureFlags, Omit<FlagMeta, 'value'>> = {
  chat: { label: 'Чат жильцов', category: 'core' },
  announcements: { label: 'Объявления', category: 'communication' },
  documents: { label: 'Документы', category: 'communication' },
  kiosk_mode: { label: 'Киоск-режим', category: 'communication' },
  qr_pass: { label: 'QR-пропуска', category: 'access' },
  meter_readings: { label: 'Показания счётчиков', category: 'resident' },
  billing: { label: 'Биллинг', category: 'resident' },
  space_booking: { label: 'Бронирование помещений', category: 'resident' },
  packages: { label: 'Посылки', category: 'concierge' },
  telegram_bot: { label: 'Telegram бот', category: 'notifications' },
  webhooks: { label: 'Вебхуки', category: 'integrations' },
  skud_integration: { label: 'Интеграция СКУД', category: 'integrations' },
  analytics: { label: 'Аналитика', category: 'admin' },
};

interface FeatureFlagsProviderProps {
  children: ReactNode;
}

export function FeatureFlagsProvider({ children }: FeatureFlagsProviderProps) {
  const { user } = useAuth();
  const [flags, setFlags] = useState<FeatureFlags>(DEFAULT_FLAGS);
  const [isLoaded, setIsLoaded] = useState(false);

  // Fetch feature flags on mount if user is admin
  useEffect(() => {
    async function fetchFlags() {
      if (!user || user.role !== 'admin' || !isLiveMode()) {
        setIsLoaded(true);
        return;
      }

      try {
        const response = await apiClient.get('/api/v1/admin/feature-flags');
        setFlags({ ...DEFAULT_FLAGS, ...response });
        setIsLoaded(true);
        logger.debug('[FeatureFlags] Loaded flags', response);
      } catch (error) {
        logger.error('[FeatureFlags] Failed to fetch flags', error);
        // Use defaults on error
        setFlags(DEFAULT_FLAGS);
        setIsLoaded(true);
      }
    }

    fetchFlags();
  }, [user]);

  const updateFlag = useCallback(async (flag: keyof FeatureFlags, value: boolean) => {
    if (!user || user.role !== 'admin') return;

    // Prevent updating the chat flag (always enabled)
    if (flag === 'chat') return;

    // Optimistic update
    const previousFlags = flags;
    setFlags(prev => ({ ...prev, [flag]: value }));

    if (!isLiveMode()) return;

    try {
      await apiClient.patch('/api/v1/admin/feature-flags', { [flag]: value });
      logger.action('feature-flag-update', { flag, value });
    } catch (error) {
      logger.error('[FeatureFlags] Failed to update flag', { flag, value, error });
      // Revert on error
      setFlags(previousFlags);
      throw error; // Re-throw for UI error handling
    }
  }, [user, flags]);

  const isFeatureEnabled = useCallback((flag: keyof FeatureFlags) => {
    return flags[flag];
  }, [flags]);

  // Create flags meta with current values
  const flagsMeta = Object.keys(FLAGS_META).reduce((acc, key) => {
    const flagKey = key as keyof FeatureFlags;
    acc[flagKey] = {
      ...FLAGS_META[flagKey],
      value: flags[flagKey],
    };
    return acc;
  }, {} as Record<keyof FeatureFlags, FlagMeta>);

  const value: FeatureFlagsContextValue = {
    flags,
    flagsMeta,
    isLoaded,
    isFeatureEnabled,
    updateFlag,
  };

  return (
    <FeatureFlagsContext.Provider value={value}>
      {children}
    </FeatureFlagsContext.Provider>
  );
}

export function useFeatureFlagsContext(): FeatureFlagsContextValue {
  const context = useContext(FeatureFlagsContext);
  if (!context) {
    throw new Error('useFeatureFlagsContext must be used within FeatureFlagsProvider');
  }
  return context;
}