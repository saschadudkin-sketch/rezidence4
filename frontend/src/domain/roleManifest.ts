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
    pageTitle: 'Домашний доступ',
  },
  tenant: {
    defaultTab: 'passes',
    tabs: ['passes', 'tech', 'perms', 'templates', 'history', 'chat'],
    pageTitle: 'Домашний доступ',
  },
  contractor: {
    defaultTab: 'passes',
    tabs: ['passes', 'tech', 'perms', 'templates', 'history', 'chat'],
    pageTitle: 'Рабочий доступ',
    pageSubtitle: 'Пропуска и техзаявки',
  },
  concierge: {
    defaultTab: 'passes',
    tabs: ['passes', 'residents', 'visitlog', 'blacklist', 'chat'],
    pageTitle: 'Лобби-операции',
    pageSubtitle: 'Доступ, резиденты и координация',
  },
  security: {
    defaultTab: 'guardpost',
    tabs: ['guardpost', 'passes', 'visitlog', 'residents', 'blacklist', 'chat'],
    pageTitle: 'Контроль доступа',
    pageSubtitle: 'Сканирование, проверка и допуск',
  },
  admin: {
    defaultTab: 'stats',
    tabs: ['stats', 'requests', 'users', 'residents', 'perms', 'visitlog', 'blacklist', 'chat', 'features'],
    pageTitle: 'Операционный центр',
    pageSubtitle: 'Резиденции Замоскворечья',
  },
};

export function getRoleManifest(role: string): RoleManifest {
  return ROLE_MANIFEST[role] || ROLE_MANIFEST.owner;
}
