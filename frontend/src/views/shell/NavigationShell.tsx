/**
 * NavigationShell.jsx — A-01: Navigation extracted from Dashboard.
 * Renders both top-nav (desktop) and mobile-nav with unified badge semantics.
 * A-03: count badges with 9+ cap on both desktop and mobile.
 * UI-01: aria-hidden on the invisible nav prevents screen readers from
 *        announcing duplicate navigation items.
 * P-02/R-01: на мобильном при >4 вкладок последняя заменяется кнопкой "•••"
 *            (drawer со скрытыми вкладками), чтобы они не переполняли nav-bar.
 */

import { useState, useEffect, memo } from 'react';
import { AppIcon } from '../../ui/AppIcon';
import { useModalAccessibility } from '../../ui/useModalAccessibility';
import { MEDIA_QUERIES } from '../../constants/breakpoints';

const formatBadgeCount = (n) => (n > 9 ? '9+' : String(n));

// Роли с расширенной навигацией получают role-specific лимит мобильных вкладок.
// Для security оставляем 3 первичных действия, остальное уходит в "Ещё".
const MOBILE_MAX_TABS_BY_ROLE = { admin: 5, security: 3, owner: 4, tenant: 4, concierge: 4 };
const DEFAULT_MOBILE_MAX_TABS = 4;
function getMobileMaxTabs(role) {
  return MOBILE_MAX_TABS_BY_ROLE[role] ?? DEFAULT_MOBILE_MAX_TABS;
}

// UI-01: sync with CSS breakpoint (--bp-lg-down => max-width:1024px).
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(MEDIA_QUERIES.lgDown).matches
  );
  useEffect(() => {
    const mq = window.matchMedia(MEDIA_QUERIES.lgDown);
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isMobile;
}

function QuickActionsSheet({ items, navBtnClassMn, goTab, isActive, formatBadgeCount, onClose }) {
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
          {items.map(([k, icon, label, badge]) => (
            <button
              key={k}
              className={navBtnClassMn(k) + ' mn-quick-item'}
              onClick={() => { goTab(k); onClose(); }}
              aria-current={isActive(k) ? 'page' : undefined}
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

const ROLE_NAV_ORDER = {
  security: ['guardpost', 'passes', 'visitlog', 'chat', 'blacklist', 'residents', 'stats'],
  concierge: ['passes', 'visitlog', 'chat', 'blacklist', 'templates', 'history', 'tech'],
  owner: ['passes', 'tech', 'templates', 'history', 'chat', 'perms'],
  tenant: ['passes', 'tech', 'templates', 'history', 'chat', 'perms'],
  contractor: ['passes', 'tech', 'templates', 'history', 'chat', 'perms'],
  admin: ['stats', 'requests', 'residents', 'users', 'blacklist', 'chat', 'visitlog'],
};

function orderMobileTabs(role, nav) {
  const roleOrder = ROLE_NAV_ORDER[role];
  if (!roleOrder) return nav;
  const rank = new Map<string, number>(roleOrder.map((tab, i) => [tab, i]));
  return [...nav].sort((a, b) => {
    const ra = rank.get(a[0]) ?? 99;
    const rb = rank.get(b[0]) ?? 99;
    if (ra !== rb) return ra - rb;
    return 0;
  });
}

const NavigationShell = memo(function NavigationShell({ nav, navClassMap, goTab, userRole }) {
  const isMobile      = useIsMobile();
  const [showMore, setShowMore] = useState(false);
  const navBtnClass   = (k) => navClassMap[k]        || 'tn-btn';
  const navBtnClassMn = (k) => navClassMap[k + '_mn'] || 'mn-btn';
  const isActive      = (k) => (navClassMap[k] || '').includes('active');

  const mobileNav = orderMobileTabs(userRole, nav);
  const mobileMaxTabs = getMobileMaxTabs(userRole);
  const needsMore  = mobileNav.length > mobileMaxTabs;
  const visibleNav = needsMore ? mobileNav.slice(0, mobileMaxTabs) : mobileNav;
  const overflowNav = needsMore ? mobileNav.slice(mobileMaxTabs) : [];

  // Суммарный badge для кнопки "•••" (сумма badge скрытых вкладок)
  const moreBadge = overflowNav.reduce((sum, [, , , badge]) => sum + (badge || 0), 0);
  // Подсвечивать ли кнопку "•••" (если активная вкладка скрыта)
  const moreIsActive = overflowNav.some(([k]) => isActive(k));

  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return;
    const vv = window.visualViewport;
    const updateViewportInset = () => {
      const keyboardInset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty('--vk-offset', `${Math.round(keyboardInset)}px`);
      if (keyboardInset > 0) setShowMore(false);
    };
    updateViewportInset();
    vv.addEventListener('resize', updateViewportInset);
    vv.addEventListener('scroll', updateViewportInset);
    return () => {
      vv.removeEventListener('resize', updateViewportInset);
      vv.removeEventListener('scroll', updateViewportInset);
      document.documentElement.style.setProperty('--vk-offset', '0px');
    };
  }, []);

  return (
    <>
      {!isMobile && (
        <nav className="top-nav" aria-label="Основная навигация">
          {nav.map(([k, icon, label, badge]) => (
            <button
              key={k}
              className={navBtnClass(k)}
              onClick={() => goTab(k)}
              aria-current={isActive(k) ? 'page' : undefined}
            >
              <span className="tn-icon"><AppIcon name={icon} size={15} /></span>
              <span>{label}</span>
              {badge > 0 && <span className="tn-badge">{formatBadgeCount(badge)}</span>}
            </button>
          ))}
        </nav>
      )}
      {isMobile && (
        <nav className="mobile-nav" aria-label="Мобильная навигация">
          {visibleNav.map(([k, icon, label, badge]) => (
            <button
              key={k}
              className={navBtnClassMn(k)}
              onClick={() => goTab(k)}
              aria-current={isActive(k) ? 'page' : undefined}
            >
              <span className="mn-icon"><AppIcon name={icon} size={16} /></span>
              <span className="mn-label">{label}</span>
              {badge > 0 && <span className="mn-badge">{formatBadgeCount(badge)}</span>}
            </button>
          ))}
          {/* P-02/R-01: кнопка "•••" для скрытых вкладок */}
          {needsMore && (
            <div className="mn-more-wrap">
              <button
                className={'mn-btn mn-more-btn' + (moreIsActive ? ' active' : '')}
                onClick={() => setShowMore(v => !v)}
                aria-haspopup="dialog"
                aria-expanded={showMore}
                aria-label={`Ещё. ${overflowNav.length} скрытых вкладок`}
                title={`Вкладки ${overflowNav.length} шт. находятся в меню «Ещё»`}
              >
                <span className="mn-icon"><AppIcon name="list" size={16} /></span>
                <span className="mn-label">Ещё</span>
                {moreBadge > 0 && <span className="mn-badge">{formatBadgeCount(moreBadge)}</span>}
              </button>
              {showMore && (
                <QuickActionsSheet
                  items={overflowNav}
                  navBtnClassMn={navBtnClassMn}
                  goTab={goTab}
                  isActive={isActive}
                  formatBadgeCount={formatBadgeCount}
                  onClose={() => setShowMore(false)}
                />
              )}
            </div>
          )}
        </nav>
      )}
    </>
  );
});

export default NavigationShell;
