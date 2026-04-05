export type RoleManifest = {
  defaultTab: string;
  tabs: string[];
  pageTitle: string;
  pageSubtitle?: string;
};

export const ROLE_MANIFEST: Record<string, RoleManifest> = {
  owner: {
    defaultTab: 'passes',
    tabs: ['passes', 'tech', 'perms', 'templates', 'history', 'chat'],
    pageTitle: 'Добро пожаловать',
  },
  tenant: {
    defaultTab: 'passes',
    tabs: ['passes', 'tech', 'perms', 'templates', 'history', 'chat'],
    pageTitle: 'Добро пожаловать',
  },
  contractor: {
    defaultTab: 'passes',
    tabs: ['passes', 'tech', 'perms', 'templates', 'history', 'chat'],
    pageTitle: 'Панель подрядчика',
    pageSubtitle: 'Управление пропусками',
  },
  concierge: {
    defaultTab: 'passes',
    tabs: ['passes', 'residents', 'visitlog', 'blacklist', 'chat'],
    pageTitle: 'Рабочее место',
    pageSubtitle: 'Контроль и координация',
  },
  security: {
    defaultTab: 'guardpost',
    tabs: ['guardpost', 'passes', 'residents', 'visitlog', 'blacklist', 'chat'],
    pageTitle: 'Пост охраны',
    pageSubtitle: 'Контроль доступа',
  },
  admin: {
    defaultTab: 'stats',
    tabs: ['stats', 'requests', 'users', 'residents', 'perms', 'visitlog', 'blacklist', 'chat'],
    pageTitle: 'Управление',
    pageSubtitle: 'Резиденции Замоскворечья',
  },
};

export function getRoleManifest(role: string): RoleManifest {
  return ROLE_MANIFEST[role] || ROLE_MANIFEST.owner;
}
