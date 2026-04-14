import { useState } from 'react';
import { isDemoMode } from '../../config/runtimeMode';
import {
  markOnboardingSeen,
  isOnboardingSeen,
  readStorage,
  STORAGE_KEYS,
  writeStorage,
} from '../../store/persistence/storageRegistry';
import type { AppUser } from '../../store/slices/usersSlice';

type RoleGuidanceUser = Pick<AppUser, 'uid' | 'role'>;

export function useRoleGuidance(user: RoleGuidanceUser) {
  const [showDemoBanner, setShowDemoBanner] = useState(() =>
    isDemoMode() && !readStorage(STORAGE_KEYS.DEMO_WELCOME_SEEN)
  );

  const [showOnboarding, setShowOnboarding] = useState(() =>
    !isOnboardingSeen(user.uid, user.role)
  );

  const dismissDemoBanner = () => {
    writeStorage(STORAGE_KEYS.DEMO_WELCOME_SEEN, '1');
    setShowDemoBanner(false);
  };

  const dismissOnboarding = () => {
    markOnboardingSeen(user.uid, user.role);
    setShowOnboarding(false);
  };

  return {
    showDemoBanner,
    showOnboarding,
    dismissDemoBanner,
    dismissOnboarding,
  };
}
