import { createContext, useContext } from 'react';
import type { MobileNavItem } from '../../domain/navigationSchema';

export type NavigationContextValue = {
  nav: MobileNavItem[];
  navClassMap: Record<string, string>;
  goTab: (tab: string) => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  highlightReqId: string | null;
  setHighlightReqId: (requestId: string | null) => void;
};

/**
 * NavigationContext вЂ” eliminates prop drilling of nav-related props
 * from Dashboard в†’ AppShell в†’ NavigationShell в†’ RoleContentRouter.
 *
 * Holds: nav, navClassMap, goTab, activeTab, setActiveTab,
 *        highlightReqId, setHighlightReqId
 */
export const NavigationContext = createContext<NavigationContextValue | null>(null);

export function useNavigationContext(): NavigationContextValue {
  const context = useContext(NavigationContext);
  if (!context) {
    throw new Error('useNavigationContext must be used within NavigationContext.Provider');
  }
  return context;
}
