// @ts-check
/**
 * domain/navigation.js - Navigation configuration domain module.
 */

import { ROLES, getTabsForRole } from './permissions';
import { getRoleResponsibilities, hasRoleCapability } from './roleResponsibilities';

/**
 * @typedef {{ role: string }} NavUser
 * @typedef {{ tab: string, icon: string, label: string, badge: number }} NavItem
 */

/**
 * @param {string} role
 * @param {{ pendingP: number, pendingT: number, unreadMsgs: number,
 *            residentNewStatuses: number, blacklistCount: number }} badges
 * @returns {NavItem[]}
 */
export function buildNavItems(role, badges) {
  const { pendingP, pendingT, unreadMsgs, residentNewStatuses, blacklistCount } = badges;
  const isSec = role === ROLES.SECURITY;
  const isCon = role === ROLES.CONCIERGE;
  const passesBadge = isSec ? pendingP + pendingT : isCon ? pendingT : residentNewStatuses;
  const roleResponsibilities = getRoleResponsibilities(role);
  const guardpostLabel = isSec ? 'Скан' : 'Пост';
  const passesLabel = roleResponsibilities.passesNavLabel || (hasRoleCapability(role, 'approve') ? 'Контроль' : 'Пропуска');

  /** @type {Record<string, [string, string, number]>} */
  const NAV_META = {
    passes: ['ticket', passesLabel, passesBadge],
    tech: ['tools', 'Техслужба', 0],
    perms: ['list', 'Доступ', 0],
    templates: ['file', 'Шаблоны', 0],
    history: ['history', 'История', 0],
    chat: ['chat', 'Чат', unreadMsgs],
    visitlog: ['list', 'Журнал доступа', 0],
    residents: ['residents', 'Резиденты', 0],
    blacklist: ['ban', 'Стоп-лист', blacklistCount],
    guardpost: ['shield', guardpostLabel, pendingP],
    stats: ['chart', 'Аналитика', 0],
    requests: ['list', 'Операции', pendingP + pendingT],
    users: ['users', 'Пользователи', 0],
  };

  const tabs = getTabsForRole(role);
  return tabs.map((tab) => {
    const [icon, label, badge] = NAV_META[tab] || ['list', tab, 0];
    return { tab, icon, label, badge };
  });
}

/**
 * @param {string} role
 * @param {string} activeTab
 * @param {{ pendingP: number, pendingT: number, unreadMsgs: number }} badges
 * @returns {Record<string, string>}
 */
export function buildNavClassMap(role, activeTab, badges) {
  const { pendingP, pendingT, unreadMsgs } = badges;
  const isSec = role === ROLES.SECURITY;
  const isCon = role === ROLES.CONCIERGE;
  const tabs = getTabsForRole(role);
  /** @type {Record<string, string>} */
  const map = {};

  for (const k of tabs) {
    const mods = [
      activeTab === k ? 'active' : '',
      isSec && k === 'passes' && pendingT > 0 && activeTab !== 'passes' ? 'blink' : '',
      isSec && k === 'passes' && pendingT === 0 && pendingP > 0 && activeTab !== 'passes' ? 'blink-y' : '',
      isCon && k === 'passes' && pendingT > 0 && activeTab !== 'passes' ? 'blink' : '',
      k === 'chat' && unreadMsgs > 0 && activeTab !== 'chat' ? 'blink-y' : '',
    ].filter(Boolean).join(' ');

    map[k] = mods ? `tn-btn ${mods}` : 'tn-btn';
    map[`${k}_mn`] = mods ? `mn-btn ${mods}` : 'mn-btn';
  }

  return map;
}
