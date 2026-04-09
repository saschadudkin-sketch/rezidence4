import { memo, useEffect, useRef, useState } from 'react';
import { AppIcon } from '../../ui/AppIcon';
import { useModalAccessibility } from '../../ui/useModalAccessibility';
import { MEDIA_QUERIES } from '../../constants/breakpoints';

const formatBadgeCount = (count: number) => (count > 9 ? '9+' : String(count));

const MOBILE_MAX_TABS_BY_ROLE: Record<string, number> = {
  admin: 5,
  security: 3,
  owner: 4,
  tenant: 4,
  concierge: 4,
};

const DEFAULT_MOBILE_MAX_TABS = 4;

const ROLE_NAV_ORDER: Record<string, string[]> = {
  security: ['guardpost', 'passes', 'visitlog', 'chat', 'blacklist', 'residents', 'stats'],
  concierge: ['passes', 'visitlog', 'chat', 'blacklist', 'templates', 'history', 'tech'],
  owner: ['passes', 'tech', 'templates', 'history', 'chat', 'perms'],
  tenant: ['passes', 'tech', 'templates', 'history', 'chat', 'perms'],
  contractor: ['passes', 'tech', 'templates', 'history', 'chat', 'perms'],
  admin: ['stats', 'requests', 'residents', 'users', 'blacklist', 'chat', 'visitlog'],
};

const MOBILE_TOP_TABS_BY_ROLE: Record<string, string[]> = {
  owner: ['passes', 'tech', 'perms'],
  tenant: ['passes', 'tech', 'perms'],
  contractor: ['passes', 'tech', 'perms'],
};

type NavItem = [string, string, string, number];

type NavigationShellProps = {
  nav: NavItem[];
  navClassMap: Record<string, string>;
  goTab: (tab: string) => void;
  userRole: string;
};

type QuickActionsSheetProps = {
  items: NavItem[];
  navBtnClassMn: (key: string) => string;
  goTab: (tab: string) => void;
  isActive: (key: string) => boolean;
  onClose: () => void;
};

function getMobileMaxTabs(role: string) {
  return MOBILE_MAX_TABS_BY_ROLE[role] ?? DEFAULT_MOBILE_MAX_TABS;
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(MEDIA_QUERIES.lgDown).matches,
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia(MEDIA_QUERIES.lgDown);
    const handleChange = (event: MediaQueryListEvent) => setIsMobile(event.matches);

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  return isMobile;
}

function orderMobileTabs(role: string, nav: NavItem[]) {
  const roleOrder = ROLE_NAV_ORDER[role];
  if (!roleOrder) return nav;

  const rank = new Map(roleOrder.map((tab, index) => [tab, index]));
  return [...nav].sort((a, b) => (rank.get(a[0]) ?? 99) - (rank.get(b[0]) ?? 99));
}

function splitMobileNav(role: string, nav: NavItem[]) {
  const topTabs = MOBILE_TOP_TABS_BY_ROLE[role];
  if (!topTabs) {
    return { topNav: nav, bottomNav: nav };
  }

  const topRank = new Map(topTabs.map((tab, index) => [tab, index]));
  const topNav = nav
    .filter(([key]) => topRank.has(key))
    .sort((a, b) => (topRank.get(a[0]) ?? 99) - (topRank.get(b[0]) ?? 99));
  const bottomNav = nav.filter(([key]) => !topRank.has(key));

  return { topNav, bottomNav };
}

function QuickActionsSheet({ items, navBtnClassMn, goTab, isActive, onClose }: QuickActionsSheetProps) {
  const { dialogRef, overlayProps } = useModalAccessibility({ onClose });

  return (
    <div className="mn-quick-sheet" {...overlayProps}>
      <button className="mn-quick-sheet__scrim" onClick={onClose} aria-label="Закрыть быстрые действия" />
      <div
        className="mn-quick-sheet__panel"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Быстрые действия"
        tabIndex={-1}
      >
        <div className="mn-quick-sheet__handle" aria-hidden="true" />
        <div className="mn-quick-sheet__header">Быстрые действия</div>
        <div className="mn-quick-grid" role="menu" aria-label="Дополнительные вкладки">
          {items.map(([key, icon, label, badge]) => (
            <button
              key={key}
              className={`${navBtnClassMn(key)} mn-quick-item`}
              onClick={() => {
                goTab(key);
                onClose();
              }}
              aria-current={isActive(key) ? 'page' : undefined}
              role="menuitem"
            >
              <span className="mn-icon"><AppIcon name={icon} size={20} /></span>
              <span className="mn-more-label">{label}</span>
              {badge > 0 && <span className="mn-badge">{formatBadgeCount(badge)}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const NavigationShell = memo(function NavigationShell({ nav, navClassMap, goTab, userRole }: NavigationShellProps) {
  const isMobile = useIsMobile();
  const [showMore, setShowMore] = useState(false);
  const topNavRef = useRef<HTMLElement | null>(null);
  const mobileNavRef = useRef<HTMLElement | null>(null);

  const navBtnClass = (key: string) => navClassMap[key] || 'tn-btn';
  const navBtnClassMn = (key: string) => navClassMap[`${key}_mn`] || 'mn-btn';
  const isActive = (key: string) => (navClassMap[key] || '').includes('active');

  const orderedMobileNav = orderMobileTabs(userRole, nav);
  const { topNav, bottomNav } = splitMobileNav(userRole, orderedMobileNav);
  const topNavItems = isMobile ? topNav : nav;
  const mobileNavItems = isMobile ? bottomNav : orderedMobileNav;
  const hasMobileTopTabs = isMobile && topNav.length > 0 && topNav.length !== nav.length;

  const mobileMaxTabs = getMobileMaxTabs(userRole);
  const needsMore = mobileNavItems.length > mobileMaxTabs;
  const visibleNav = needsMore ? mobileNavItems.slice(0, mobileMaxTabs) : mobileNavItems;
  const overflowNav = needsMore ? mobileNavItems.slice(mobileMaxTabs) : [];
  const moreBadge = overflowNav.reduce((sum, [, , , badge]) => sum + (badge || 0), 0);
  const moreIsActive = overflowNav.some(([key]) => isActive(key));

  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return;

    const viewport = window.visualViewport;
    const updateViewportInset = () => {
      const keyboardInset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      document.documentElement.style.setProperty('--vk-offset', `${Math.round(keyboardInset)}px`);
      if (keyboardInset > 0) setShowMore(false);
    };

    updateViewportInset();
    viewport.addEventListener('resize', updateViewportInset);
    viewport.addEventListener('scroll', updateViewportInset);

    return () => {
      viewport.removeEventListener('resize', updateViewportInset);
      viewport.removeEventListener('scroll', updateViewportInset);
      document.documentElement.style.setProperty('--vk-offset', '0px');
    };
  }, []);

  useEffect(() => {
    if (typeof topNavRef.current?.scrollTo === 'function') {
      topNavRef.current.scrollTo({ left: 0, behavior: 'auto' });
    }
    if (typeof mobileNavRef.current?.scrollTo === 'function') {
      mobileNavRef.current.scrollTo({ left: 0, behavior: 'auto' });
    }
  }, [userRole]);

  return (
    <>
      <nav
        className={`top-nav${hasMobileTopTabs ? ' top-nav--mobile-top' : ''}`}
        aria-label="Основная навигация"
        ref={topNavRef}
      >
        {topNavItems.map(([key, icon, label, badge]) => (
          <button
            key={key}
            className={navBtnClass(key)}
            onClick={() => goTab(key)}
            aria-current={isActive(key) ? 'page' : undefined}
          >
            <span className="tn-icon"><AppIcon name={icon} size={15} /></span>
            <span>{label}</span>
            {badge > 0 && <span className="tn-badge">{formatBadgeCount(badge)}</span>}
          </button>
        ))}
      </nav>

      <nav className="mobile-nav" aria-label="Мобильная навигация" aria-hidden={!isMobile || undefined} ref={mobileNavRef}>
        {visibleNav.map(([key, icon, label, badge]) => (
          <button
            key={key}
            className={navBtnClassMn(key)}
            onClick={() => goTab(key)}
            aria-current={isActive(key) ? 'page' : undefined}
            tabIndex={!isMobile ? -1 : undefined}
          >
            <span className="mn-icon"><AppIcon name={icon} size={16} /></span>
            <span className="mn-label">{label}</span>
            {badge > 0 && <span className="mn-badge">{formatBadgeCount(badge)}</span>}
          </button>
        ))}

        {needsMore && (
          <div className="mn-more-wrap">
            <button
              className={`mn-btn mn-more-btn${moreIsActive ? ' active' : ''}`}
              onClick={() => setShowMore((value) => !value)}
              aria-haspopup="dialog"
              aria-expanded={showMore}
              aria-label={`Ещё. ${overflowNav.length} скрытых вкладок`}
              title={`Во вкладке "Ещё" доступно ${overflowNav.length} пунктов`}
              tabIndex={!isMobile ? -1 : undefined}
            >
              <span className="mn-icon"><AppIcon name="dots" size={16} /></span>
              <span className="mn-label">Ещё</span>
              {moreBadge > 0 && <span className="mn-badge">{formatBadgeCount(moreBadge)}</span>}
            </button>
            {showMore && (
              <QuickActionsSheet
                items={overflowNav}
                navBtnClassMn={navBtnClassMn}
                goTab={goTab}
                isActive={isActive}
                onClose={() => setShowMore(false)}
              />
            )}
          </div>
        )}
      </nav>
    </>
  );
});

export default NavigationShell;
