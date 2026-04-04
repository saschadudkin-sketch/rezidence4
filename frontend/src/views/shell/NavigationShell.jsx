/**
 * NavigationShell.jsx — A-01: Navigation extracted from Dashboard.
 * Renders both top-nav (desktop) and mobile-nav with unified badge semantics.
 * A-03: count badges with 9+ cap on both desktop and mobile.
 * UI-01: aria-hidden on the invisible nav prevents screen readers from
 *        announcing duplicate navigation items.
 * P-02/R-01: на мобильном при >4 вкладок последняя заменяется кнопкой "•••"
 *            (drawer со скрытыми вкладками), чтобы они не переполняли nav-bar.
 */

import { useState, useEffect, useRef, memo } from 'react';
import { AppIcon } from '../../ui/AppIcon';

const formatBadgeCount = (n) => (n > 9 ? '9+' : String(n));

// Роли с расширенной навигацией получают 5 вкладок без "•••" drawer
const MOBILE_MAX_TABS_BY_ROLE = { admin: 5, security: 5 };
const DEFAULT_MOBILE_MAX_TABS = 4;
function getMobileMaxTabs(role) {
  return MOBILE_MAX_TABS_BY_ROLE[role] ?? DEFAULT_MOBILE_MAX_TABS;
}

// UI-01: sync with CSS breakpoint (max-width:860px → mobile nav visible)
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width:860px)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width:860px)');
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isMobile;
}

// P-02/R-01: Drawer со скрытыми вкладками для мобильного "Ещё"
function MoreDrawer({ items, navBtnClassMn, goTab, isActive, formatBadgeCount, onClose }) {
  const ref = useRef(null);

  // Закрыть при клике вне drawer
  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [onClose]);

  return (
    <div className="mn-more-drawer" ref={ref} role="menu" aria-label="Дополнительные вкладки">
      {items.map(([k, icon, label, badge]) => (
        <button
          key={k}
          className={navBtnClassMn(k) + ' mn-more-item'}
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
  );
}

const NavigationShell = memo(function NavigationShell({ nav, navClassMap, goTab, userRole }) {
  const isMobile      = useIsMobile();
  const [showMore, setShowMore] = useState(false);
  const navBtnClass   = (k) => navClassMap[k]        || 'tn-btn';
  const navBtnClassMn = (k) => navClassMap[k + '_mn'] || 'mn-btn';
  const isActive      = (k) => (navClassMap[k] || '').includes('active');

  const mobileMaxTabs = getMobileMaxTabs(userRole);
  const needsMore  = nav.length > mobileMaxTabs;
  const visibleNav = needsMore ? nav.slice(0, mobileMaxTabs) : nav;
  const overflowNav = needsMore ? nav.slice(mobileMaxTabs) : [];

  // Суммарный badge для кнопки "•••" (сумма badge скрытых вкладок)
  const moreBadge = overflowNav.reduce((sum, [, , , badge]) => sum + (badge || 0), 0);
  // Подсвечивать ли кнопку "•••" (если активная вкладка скрыта)
  const moreIsActive = overflowNav.some(([k]) => isActive(k));

  return (
    <>
      {/* UI-01: aria-hidden when CSS hides this nav — prevents duplicate landmarks for screen readers */}
      <nav className="top-nav" aria-label="Основная навигация" aria-hidden={isMobile || undefined}>
        {nav.map(([k, icon, label, badge]) => (
          <button
            key={k}
            className={navBtnClass(k)}
            onClick={() => goTab(k)}
            aria-current={isActive(k) ? 'page' : undefined}
            tabIndex={isMobile ? -1 : undefined}
          >
            <span className="tn-icon"><AppIcon name={icon} size={15} /></span>
            <span>{label}</span>
            {badge > 0 && <span className="tn-badge">{formatBadgeCount(badge)}</span>}
          </button>
        ))}
      </nav>
      {/* UI-01: aria-hidden when CSS hides this nav */}
      <nav className="mobile-nav" aria-label="Мобильная навигация" aria-hidden={!isMobile || undefined}>
        {visibleNav.map(([k, icon, label, badge]) => (
          <button
            key={k}
            className={navBtnClassMn(k)}
            onClick={() => goTab(k)}
            aria-current={isActive(k) ? 'page' : undefined}
            tabIndex={!isMobile ? -1 : undefined}
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
              aria-haspopup="menu"
              aria-expanded={showMore}
              tabIndex={!isMobile ? -1 : undefined}
            >
              <span className="mn-icon"><AppIcon name="list" size={16} /></span>
              <span className="mn-label">Ещё</span>
              {moreBadge > 0 && <span className="mn-badge">{formatBadgeCount(moreBadge)}</span>}
            </button>
            {showMore && (
              <MoreDrawer
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
    </>
  );
});

export default NavigationShell;
