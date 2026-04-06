import { canAccessTab } from './permissions';

export type NavigationGuardResult = {
  allowed: boolean;
  targetTab: string;
  reason: 'ok' | 'invalid' | 'forbidden';
  noticeKey: string;
};

export function resolveTabGuard({
  role,
  requestedTab,
  defaultTab,
  knownTabs,
}: {
  role: string;
  requestedTab: string | null;
  defaultTab: string;
  knownTabs: Set<string>;
}): NavigationGuardResult {
  if (!requestedTab) {
    return {
      allowed: false,
      targetTab: defaultTab,
      reason: 'invalid',
      noticeKey: `${role}:missing:${defaultTab}`,
    };
  }

  if (canAccessTab(role, requestedTab)) {
    return {
      allowed: true,
      targetTab: requestedTab,
      reason: 'ok',
      noticeKey: `${role}:${requestedTab}:${requestedTab}`,
    };
  }

  return {
    allowed: false,
    targetTab: defaultTab,
    reason: knownTabs.has(requestedTab) ? 'forbidden' : 'invalid',
    noticeKey: `${role}:${requestedTab}:${defaultTab}`,
  };
}

export function buildNavigationTelemetry(result: NavigationGuardResult, role: string, fromTab: string | null) {
  return {
    role,
    from: fromTab,
    to: result.targetTab,
    reason: result.reason,
    noticeKey: result.noticeKey,
  };
}
