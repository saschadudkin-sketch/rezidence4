/**
 * NavigationShell.jsx — A-01: Navigation extracted from Dashboard.
 * Renders both top-nav (desktop) and mobile-nav with unified badge semantics.
 * A-03: count badges with 9+ cap on both desktop and mobile.
 * UI-01: aria-hidden on the invisible nav prevents screen readers from
 *        announcing duplicate navigation items.
 */

import { useState, useEffect, memo } from 'react';
import { AppIcon } from '../../ui/AppIcon';

const formatBadgeCount = (n) => (n > 9 ? '9+' : String(n));

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

const NavigationShell = memo(function NavigationShell({ nav, navClassMap, goTab }) {
  const isMobile      = useIsMobile();
  const navBtnClass   = (k) => navClassMap[k]        || 'tn-btn';
  const navBtnClassMn = (k) => navClassMap[k + '_mn'] || 'mn-btn';
  const isActive      = (k) => (navClassMap[k] || '').includes('active');

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
        {nav.map(([k, icon, label, badge]) => (
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
      </nav>
    </>
  );
});

export default NavigationShell;
