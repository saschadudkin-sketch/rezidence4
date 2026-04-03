/**
 * NavigationShell.jsx — A-01: Navigation extracted from Dashboard.
 * Renders both top-nav (desktop) and mobile-nav with unified badge semantics.
 * A-03: count badges with 9+ cap on both desktop and mobile.
 */

import { memo } from 'react';
import { AppIcon } from '../../ui/AppIcon';

const formatBadgeCount = (n) => (n > 9 ? '9+' : String(n));

const NavigationShell = memo(function NavigationShell({ nav, navClassMap, goTab }) {
  const navBtnClass   = (k) => navClassMap[k]        || 'tn-btn';
  const navBtnClassMn = (k) => navClassMap[k + '_mn'] || 'mn-btn';
  const isActive      = (k) => (navClassMap[k] || '').includes('active');

  return (
    <>
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
      <nav className="mobile-nav" aria-label="Мобильная навигация">
        {nav.map(([k, icon, label, badge]) => (
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
      </nav>
    </>
  );
});

export default NavigationShell;
