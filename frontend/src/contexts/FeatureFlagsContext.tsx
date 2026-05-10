import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { useAuth } from '../hooks/useAuth';
import { apiClient } from '../services/providers/apiClient';
import { logger } from '../services/logger';
import { isLiveMode } from '../config/runtimeMode';

/**
 * FeatureFlagsContext — loads flag metadata + current values from the backend
 * and exposes them to the app.
 *
 * Backend endpoints (see backend/src/routes/adminSettings.js):
 *   GET /api/v1/admin/feature-flags/schema  — labels/descriptions/categories
 *   GET /api/v1/admin/feature-flags         — resolved boolean map
 *   PATCH /api/v1/admin/feature-flags       — partial update
 *
 * FEATURE_KEYS below is the only hardcoded reference to the flag names on the
 * frontend — it exists so `FeatureFlags` stays a narrow TypeScript type at
 * call sites like `useFeatureFlag('qr_pass')`.  The backend test suite
 * (__tests__/featureFlagsRegistry.test.js) asserts this tuple matches the
 * registry keys, so drift is caught in CI, not at runtime on the admin
 * screen.
 *
 * If the app runs before the admin has loaded the flags (or a non-admin user
 * is signed in), we return the schema defaults so gated features stay off
 * rather than briefly flipping on and back.
 */

export const FEATURE_KEYS = [
  'chat',
  'announcements',
  'documents',
  'kiosk_mode',
  'qr_pass',
  'manual_access_approval',
  'meter_readings',
  'billing',
  'space_booking',
  'packages',
  'telegram_bot',
  'webhooks',
  'skud_integration',
  'analytics',
  'legacy_utilities_enabled',
] as const;

export type FeatureFlagKey = typeof FEATURE_KEYS[number];
export type FeatureFlags = Record<FeatureFlagKey, boolean>;

/** Metadata for a single flag as served by /feature-flags/schema. */
export interface FlagSchemaEntry {
  key: FeatureFlagKey;
  label: string;
  description: string;
  category: string;
  default: boolean;
  locked: boolean;
}

export interface CategorySchemaEntry {
  key: string;
  label: string;
  order: number;
}

export interface PackagePlanSchemaEntry {
  key: string;
  label: string;
  description: string;
  flags: FeatureFlagKey[];
}

export interface FeatureFlagsSchema {
  flags: FlagSchemaEntry[];
  categories: CategorySchemaEntry[];
  plans?: PackagePlanSchemaEntry[];
}

/** Merged shape: schema entry + current resolved value. */
export interface FlagMeta extends FlagSchemaEntry {
  value: boolean;
}

interface FeatureFlagsContextValue {
  /** Resolved boolean map.  Falls back to schema defaults before load. */
  flags: FeatureFlags;
  /** Schema + live value for each flag, keyed by flag key. */
  flagsMeta: Record<FeatureFlagKey, FlagMeta>;
  /** Ordered list of categories as served by the backend. */
  categories: CategorySchemaEntry[];
  /** True once BOTH schema and values have been fetched (or skipped). */
  isLoaded: boolean;
  /** Non-null when live admin loading failed and admin UI should not render fallback keys. */
  loadError: string | null;
  isFeatureEnabled: (flag: FeatureFlagKey) => boolean;
  updateFlag: (flag: FeatureFlagKey, value: boolean) => Promise<void>;
}

const FeatureFlagsContext = createContext<FeatureFlagsContextValue | null>(null);

// Build a safe "all off" map before the schema arrives.  `chat` is the one
// core flag we hardcode as on so the chat tab doesn't blink off during boot.
const EMPTY_FLAGS: FeatureFlags = FEATURE_KEYS.reduce((acc, k) => {
  acc[k] = k === 'chat';
  return acc;
}, {} as FeatureFlags);

interface FeatureFlagsProviderProps {
  children: ReactNode;
}

function buildFlagsFromSchemaDefaults(schema: FeatureFlagsSchema | null): FeatureFlags {
  if (!schema) return EMPTY_FLAGS;
  const out = { ...EMPTY_FLAGS };
  for (const entry of schema.flags) {
    out[entry.key] = entry.default;
  }
  return out;
}

export function FeatureFlagsProvider({ children }: FeatureFlagsProviderProps) {
  const { user } = useAuth();
  const userRole = user?.role;
  const userUid = user?.uid;
  const isAdmin = userRole === 'admin';
  const [schema, setSchema] = useState<FeatureFlagsSchema | null>(null);
  const [flags, setFlags] = useState<FeatureFlags>(EMPTY_FLAGS);
  const [isLoaded, setIsLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Fetch schema + values in parallel once the user is an admin.  Non-admin
  // users never learn the property's flag state from this context — they
  // only see feature flags indirectly via server-side gating on their own
  // endpoints.  Both requests share the same `cancelled` guard so a quick
  // user switch (admin → resident) cannot leak admin data into resident
  // state.
  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      if (!isAdmin || !isLiveMode()) {
        setSchema(null);
        setFlags(EMPTY_FLAGS);
        setLoadError(null);
        setIsLoaded(true);
        return;
      }

      setIsLoaded(false);
      setLoadError(null);

      try {
        const [schemaResp, valuesResp] = await Promise.all([
          apiClient.get('/api/v1/admin/feature-flags/schema') as Promise<FeatureFlagsSchema>,
          apiClient.get('/api/v1/admin/feature-flags') as Promise<Partial<FeatureFlags>>,
        ]);
        if (cancelled) return;

        setSchema(schemaResp);

        // Start from schema defaults so any flag the server didn't explicitly
        // return still resolves to its baseline value (new flag rolled out
        // server-side, tenant hasn't stored it yet).
        const merged = { ...buildFlagsFromSchemaDefaults(schemaResp), ...valuesResp } as FeatureFlags;
        setFlags(merged);
        setLoadError(null);
        setIsLoaded(true);
        logger.debug('[FeatureFlags] Loaded schema + values', { schemaEntries: schemaResp.flags.length, values: valuesResp });
      } catch (error) {
        if (cancelled) return;
        logger.error('[FeatureFlags] Failed to fetch flags', error);
        setSchema(null);
        setFlags(EMPTY_FLAGS);
        setLoadError('Проверьте соединение с сервером');
        setIsLoaded(true);
      }
    }

    hydrate();
    return () => { cancelled = true; };
  }, [isAdmin, userUid]);

  const updateFlag = useCallback(async (flag: FeatureFlagKey, value: boolean) => {
    if (!isAdmin) return;

    // Locked flags are controlled server-side — the UI should be preventing
    // the toggle in the first place, but mirror the rule here as defence in
    // depth against programmatic callers.
    const entry = schema?.flags.find(f => f.key === flag);
    if (entry?.locked) return;

    const previousFlags = flags;
    setFlags(prev => ({ ...prev, [flag]: value }));

    if (!isLiveMode()) return;

    try {
      const updated = await apiClient.patch('/api/v1/admin/feature-flags', { [flag]: value }) as FeatureFlags;
      setFlags(updated);
      logger.action('feature-flag-update', { flag, value });
    } catch (error) {
      logger.error('[FeatureFlags] Failed to update flag', { flag, value, error });
      setFlags(previousFlags);
      throw error;
    }
  }, [isAdmin, flags, schema]);

  const isFeatureEnabled = useCallback((flag: FeatureFlagKey) => {
    return flags[flag];
  }, [flags]);

  // Zip schema + values into a single Record<key, FlagMeta> for consumers
  // (admin UI).  When the schema hasn't arrived yet we synthesise a minimal
  // entry so the UI can render skeletons keyed by flag without blowing up.
  const flagsMeta = FEATURE_KEYS.reduce((acc, key) => {
    const schemaEntry = schema?.flags.find(f => f.key === key);
    acc[key] = schemaEntry
      ? { ...schemaEntry, value: flags[key] }
      : {
          key,
          label: key,
          description: '',
          category: 'core',
          default: flags[key],
          locked: key === 'chat',
          value: flags[key],
        };
    return acc;
  }, {} as Record<FeatureFlagKey, FlagMeta>);

  const value: FeatureFlagsContextValue = {
    flags,
    flagsMeta,
    categories: schema?.categories ?? [],
    isLoaded,
    loadError,
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
