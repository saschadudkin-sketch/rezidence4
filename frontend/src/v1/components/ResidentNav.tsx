/**
 * ResidentNav — top navigation strip for the 4 resident-facing v1 pages.
 *
 * Rendered inline by each page (not baked into a layout route) because
 * some pages already exist (ResidentAccessPage predates this component)
 * and we want to add nav without a structural route refactor.  The nav is
 * one flat component; adding a 5th tab = one array entry here.
 *
 * Active-link styling uses the `uiClasses.buttonGhost` / `.buttonSecondary`
 * pair to stay visually consistent with the rest of the v1 UI kit and
 * avoid a parallel design language.
 */

import { NavLink } from 'react-router-dom';
import { Inline, uiClasses } from './ui';

interface NavItem {
  to: string;
  label: string;
  /** Shown underneath the label for narrow screens / a11y. */
  aria: string;
}

const ITEMS: ReadonlyArray<NavItem> = [
  { to: '/v1/access', label: 'Пропуска', aria: 'Мои заявки на пропуска' },
  { to: '/v1/my/packages', label: 'Посылки', aria: 'Мои посылки' },
  { to: '/v1/my/announcements', label: 'Объявления', aria: 'Лента объявлений' },
  { to: '/v1/my/documents', label: 'Документы', aria: 'Документы объекта' },
];

export function ResidentNav() {
  return (
    <nav aria-label="Навигация жильца">
      <Inline>
        {ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end
            aria-label={item.aria}
            className={({ isActive }) =>
              `${uiClasses.navLink} ${isActive ? uiClasses.buttonSecondary : uiClasses.buttonGhost}`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </Inline>
    </nav>
  );
}
