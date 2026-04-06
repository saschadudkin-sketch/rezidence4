import { describe, expect, test, vi } from 'vitest';
import {
  isOnboardingSeen,
  markOnboardingSeen,
  onboardingKeyByUser,
  removeStorage,
} from './storageRegistry';

describe('storageRegistry onboarding keys', () => {
  test('uses uid+role in onboarding key', () => {
    expect(onboardingKeyByUser('u1', 'owner')).toContain(':owner:u1');
  });

  test('markOnboardingSeen + isOnboardingSeen honor ttl', () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    markOnboardingSeen('u1', 'owner');
    expect(isOnboardingSeen('u1', 'owner', now + 1000)).toBe(true);
    // after ttl (~90 days) should expire
    expect(isOnboardingSeen('u1', 'owner', now + (1000 * 60 * 60 * 24 * 91))).toBe(false);
    removeStorage(onboardingKeyByUser('u1', 'owner'));
    vi.restoreAllMocks();
  });
});
