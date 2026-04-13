import type { UserRole } from '../store/slices/usersSlice';

export type NavKey = string;
export type MobileNavItem = readonly [key: NavKey, icon: string, label: string, badge: number];

type NavigationRoleConfig = {
  mobileMaxTabs?: number;
  mobileOrder?: readonly NavKey[];
  mobileTopTabs?: readonly NavKey[];
  mobileBottomTabs?: readonly NavKey[];
  mobileLabels?: Partial<Record<NavKey, string>>;
  hiddenMobileTabs?: readonly NavKey[];
};

const DEFAULT_MOBILE_MAX_TABS = 4;
const COMMON_COMPACT_LABELS: Record<string, string> = {
  visitlog: 'Журнал',
  blacklist: 'Стоп',
};

const NAVIGATION_ROLE_CONFIG: Partial<Record<UserRole, NavigationRoleConfig>> = {
  admin: {
    mobileMaxTabs: 3,
    mobileOrder: ['stats', 'requests', 'users', 'residents', 'visitlog', 'blacklist', 'chat'],
    mobileTopTabs: ['stats', 'requests', 'residents'],
    hiddenMobileTabs: ['chat'],
    mobileLabels: {
      users: 'Пользователи',
      blacklist: 'Стоп',
      visitlog: 'Журнал',
    },
  },
  security: {
    mobileMaxTabs: 5,
    mobileOrder: ['guardpost', 'passes', 'residents', 'visitlog', 'blacklist', 'chat', 'stats'],
    hiddenMobileTabs: ['chat'],
    mobileLabels: {
      guardpost: 'Пост',
      passes: 'Контроль',
      visitlog: 'Журнал',
      chat: 'Чат',
      blacklist: 'Стоп',
      residents: 'Резиденты',
    },
  },
  concierge: {
    mobileMaxTabs: 3,
    mobileOrder: ['passes', 'residents', 'visitlog', 'blacklist', 'chat', 'templates', 'history', 'tech'],
    mobileBottomTabs: ['passes', 'visitlog', 'chat', 'blacklist', 'residents'],
    mobileLabels: {
      passes: 'Пропуска',
      visitlog: 'Журнал',
      chat: 'Чат',
      blacklist: 'Стоп',
      residents: 'Резиденты',
    },
  },
  owner: {
    mobileMaxTabs: 4,
    mobileOrder: ['passes', 'tech', 'templates', 'history', 'chat', 'perms'],
    mobileTopTabs: ['passes', 'tech', 'perms'],
  },
  tenant: {
    mobileMaxTabs: 4,
    mobileOrder: ['passes', 'tech', 'templates', 'history', 'chat', 'perms'],
    mobileTopTabs: ['passes', 'tech', 'perms'],
  },
  contractor: {
    mobileMaxTabs: 4,
    mobileOrder: ['passes', 'tech', 'templates', 'history', 'chat', 'perms'],
    mobileTopTabs: ['passes', 'tech', 'perms'],
  },
};

function getRoleConfig(role: string): NavigationRoleConfig {
  return NAVIGATION_ROLE_CONFIG[role as UserRole] ?? {};
}

export function getMobileMaxTabs(role: string): number {
  return getRoleConfig(role).mobileMaxTabs ?? DEFAULT_MOBILE_MAX_TABS;
}

export function orderMobileTabs(role: string, nav: MobileNavItem[]): MobileNavItem[] {
  const roleOrder = getRoleConfig(role).mobileOrder;
  if (!roleOrder?.length) return nav;

  const rank = new Map(roleOrder.map((tab, index) => [tab, index]));
  return [...nav].sort((a, b) => (rank.get(a[0]) ?? 99) - (rank.get(b[0]) ?? 99));
}

export function splitMobileNav(role: string, nav: MobileNavItem[]) {
  const topTabs = getRoleConfig(role).mobileTopTabs;
  if (!topTabs?.length) {
    return { topNav: nav, bottomNav: nav };
  }

  const topRank = new Map(topTabs.map((tab, index) => [tab, index]));
  const topNav = nav
    .filter(([key]) => topRank.has(key))
    .sort((a, b) => (topRank.get(a[0]) ?? 99) - (topRank.get(b[0]) ?? 99));
  const bottomNav = nav.filter(([key]) => !topRank.has(key));

  return { topNav, bottomNav };
}

export function getMobileLabel(role: string, key: string, fallback: string): string {
  return getRoleConfig(role).mobileLabels?.[key] ?? COMMON_COMPACT_LABELS[key] ?? fallback;
}

export function filterMobileNavItems(role: string, items: MobileNavItem[]): MobileNavItem[] {
  const config = getRoleConfig(role);

  if (config.mobileBottomTabs?.length) {
    const allowedTabs = new Set(config.mobileBottomTabs);
    return items.filter(([key]) => allowedTabs.has(key));
  }

  if (config.hiddenMobileTabs?.length) {
    const hiddenTabs = new Set(config.hiddenMobileTabs);
    return items.filter(([key]) => !hiddenTabs.has(key));
  }

  return items;
}
