import { createContext, useContext } from 'react';

/**
 * NavigationContext — eliminates prop drilling of nav-related props
 * from Dashboard → AppShell → NavigationShell → RoleContentRouter.
 *
 * Holds: nav, navClassMap, goTab, activeTab, setActiveTab,
 *        highlightReqId, setHighlightReqId
 */
export const NavigationContext = createContext(null);

export function useNavigationContext() {
  return useContext(NavigationContext);
}
