import { useFeatureFlagsContext, type FeatureFlagKey } from '../contexts/FeatureFlagsContext';

// Re-export the narrow key type + the full FeatureFlags shape so existing
// call sites (`import type { FeatureFlags } from '../hooks/useFeatureFlag'`)
// keep working after the context refactor.
export type { FeatureFlagKey, FeatureFlags } from '../contexts/FeatureFlagsContext';

export function useFeatureFlag(flag: FeatureFlagKey): boolean {
  const { isFeatureEnabled } = useFeatureFlagsContext();
  return isFeatureEnabled(flag);
}

export function useFeatureFlags() {
  return useFeatureFlagsContext();
}
