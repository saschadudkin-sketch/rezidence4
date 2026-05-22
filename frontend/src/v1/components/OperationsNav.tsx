/**
 * OperationsNav — flat navigation for pilot operations workspaces.
 *
 * The resident side already has ResidentNav. This component keeps staff,
 * guard, technician, contractor and admin entry points reachable without
 * relying on manual `/v1/...` URLs during seeded-tenant rehearsals.
 */

import { NavLink } from 'react-router-dom';
import type { UserRole } from '../api';
import { normalizeUserRole, useV1Session } from '../store';
import { Inline, uiClasses } from './ui';

interface NavItem {
  to: string;
  label: string;
  allow: ReadonlySet<UserRole>;
}

const ADMIN_ROLES: ReadonlySet<UserRole> = new Set([
  'property_admin',
  'management_company_admin',
  'platform_admin',
]);

const STAFF_ROLES: ReadonlySet<UserRole> = new Set([
  'concierge',
  'security',
  'staff',
  'property_admin',
  'management_company_admin',
  'platform_admin',
]);

const PACKAGES_ROLES: ReadonlySet<UserRole> = new Set([
  'concierge',
  'security',
  'property_admin',
  'management_company_admin',
  'platform_admin',
]);

const GUARD_ROLES: ReadonlySet<UserRole> = new Set([
  'security',
  'property_admin',
  'management_company_admin',
  'platform_admin',
]);

const TECHNICIAN_ROLES: ReadonlySet<UserRole> = new Set([
  'technician',
  'property_admin',
  'management_company_admin',
  'platform_admin',
]);

const CONTRACTOR_ROLES: ReadonlySet<UserRole> = new Set([
  'contractor',
  'property_admin',
  'management_company_admin',
  'platform_admin',
]);

const ITEMS: ReadonlyArray<NavItem> = [
  { to: '/v1/staff-workspace', label: 'Staff', allow: STAFF_ROLES },
  { to: '/v1/guard', label: 'КПП', allow: GUARD_ROLES },
  { to: '/v1/packages', label: 'Посылки', allow: PACKAGES_ROLES },
  { to: '/v1/technician-workspace', label: 'Техник', allow: TECHNICIAN_ROLES },
  { to: '/v1/contractor-workspace', label: 'Подрядчик', allow: CONTRACTOR_ROLES },
  { to: '/v1/admin/operations', label: 'Обзор', allow: ADMIN_ROLES },
  { to: '/v1/admin/access', label: 'Доступ', allow: ADMIN_ROLES },
  { to: '/v1/admin/notifications', label: 'Outbox', allow: ADMIN_ROLES },
  { to: '/v1/onboarding', label: 'Онбординг', allow: ADMIN_ROLES },
];

export function OperationsNav() {
  const user = useV1Session();
  const role = normalizeUserRole(user.role);
  const visibleItems = ITEMS.filter((item) => item.allow.has(role));

  if (visibleItems.length === 0) return null;

  return (
    <nav aria-label="Пилотная навигация операций">
      <Inline>
        {visibleItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end
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
