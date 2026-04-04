import { createContext, useContext } from 'react';

/**
 * NavigationContext — eliminates prop drilling of nav-related props
 * from Dashboard → AppShell → NavigationShell.
 *
 * Holds: nav, navClassMap, goTab, activeTab, setActiveTab
 */
export const NavigationContext = createContext(null);

export function useNavigationContext() {
  return useContext(NavigationContext);
}
