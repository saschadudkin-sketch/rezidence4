import { useFeatureFlagsContext, type FeatureFlags } from '../contexts/FeatureFlagsContext';

export function useFeatureFlag(flag: keyof FeatureFlags): boolean {
  const { isFeatureEnabled } = useFeatureFlagsContext();
  return isFeatureEnabled(flag);
}

export function useFeatureFlags() {
  return useFeatureFlagsContext();
}