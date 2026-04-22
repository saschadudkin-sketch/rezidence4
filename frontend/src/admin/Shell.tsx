import React, { ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from './auth';
import s from './styles.module.css';

const LINKS: Array<{ to: string; label: string; end?: boolean }> = [
  { to: '/', label: 'Обзор', end: true },
  { to: '/properties', label: 'Объекты' },
  { to: '/admins',     label: 'Админы' },
  { to: '/audit',      label: 'Журнал' },
];

/**
 * Shell — chrome around every authenticated page.  Fixed sidebar + outlet.
 * The tenant SPA has its own app shell; this one stays tiny and deliberately
 * unstyled like the tenant app so a CSS regression on one side can't leak.
 */
export function Shell({ children }: { children?: ReactNode }) {
  const { admin, logout } = useAuth();

  return (
    <div className={s.shell}>
      <aside className={s.sidebar}>
        <div className={s.brand}>
          DomHub
          <small>Панель платформы</small>
        </div>
        <nav className={s.nav}>
          {LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) =>
                isActive ? `${s.navLink} ${s.navLinkActive}` : s.navLink
              }
            >
              {link.label}
            </NavLink>
          ))}
        </nav>
        <div className={s.sidebarFooter}>
          <div>{admin?.name || admin?.email || 'Админ'}</div>
          <button
            type="button"
            className={s.logoutBtn}
            onClick={() => { void logout(); }}
          >
            Выйти
          </button>
        </div>
      </aside>
      <main className={s.main}>
        {children ?? <Outlet />}
      </main>
    </div>
  );
}
