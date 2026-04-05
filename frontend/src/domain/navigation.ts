// @ts-check
/**
 * domain/navigation.js — Navigation configuration domain module.
 *
 * Вынесено из Dashboard.jsx useMemo — конфигурация навигации это domain concern,
 * а не UI-вычисление в компоненте. Преимущества:
 *   1. Тестируемость: buildNavItems / buildNavClassMap можно тестировать без React
 *   2. Читаемость: Dashboard больше не содержит 35-строчный useMemo с NAV_META
 *   3. Переиспользуемость: любой компонент может получить навигацию без пробрасывания
 *
 * @typedef {{ role: string }} NavUser
 * @typedef {{ tab: string, icon: string, label: string, badge: number }} NavItem
 */

import { ROLES, getTabsForRole } from './permissions';

/**
 * Метаданные навигации: иконка + лейбл для каждого таба.
 * Иконка и лейбл зависят от роли для некоторых табов (passes).
 *
 * @param {string} role
 * @param {{ pendingP: number, pendingT: number, unreadMsgs: number,
 *            residentNewStatuses: number, blacklistCount: number }} badges
 * @returns {NavItem[]}
 */
export function buildNavItems(role, badges) {
  const { pendingP, pendingT, unreadMsgs, residentNewStatuses, blacklistCount } = badges;
  const isSec = role === ROLES.SECURITY;
  const isCon = role === ROLES.CONCIERGE;
  const passesBadge = isSec ? pendingP + pendingT
    : isCon ? pendingT
    : residentNewStatuses;
  const guardpostLabel = isSec ? 'Скан' : 'Пост';
  const passesLabel = isSec ? 'Проверка' : (isCon ? 'Заявки' : 'Пропуска');

  /** @type {Record<string, [string, string, number]>} icon, label, badge */
  const NAV_META = {
    passes:    ['ticket',    passesLabel,    passesBadge],
    tech:      ['tools',     'Техслужба',   0],
    perms:     ['list',      'Список',      0],
    templates: ['file',      'Шаблоны',     0],
    history:   ['history',   'История',     0],
    chat:      ['chat',      'Чат',         unreadMsgs],
    visitlog:  ['list',      'Журнал',      0],
    residents: ['residents', 'Жильцы',      0],
    blacklist: ['ban',       'ЧС',          blacklistCount],
    guardpost: ['shield',    guardpostLabel, pendingP],
    stats:     ['chart',     'Аналитика',   0],
    requests:  ['list',      'Заявки',      pendingP + pendingT],
    users:     ['users',     'Резиденты',   0],
  };

  const tabs = getTabsForRole(role);
  return tabs.map(tab => {
    const [icon, label, badge] = NAV_META[tab] || ['list', tab, 0];
    return { tab, icon, label, badge };
  });
}

/**
 * CSS-классы для каждой кнопки навигации (blink-эффекты, active-стейт).
 *
 * @param {string} role
 * @param {string} activeTab
 * @param {{ pendingP: number, pendingT: number, unreadMsgs: number }} badges
 * @returns {Record<string, string>} tab → className, tab + '_mn' → mobile className
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
      isSec && k === 'passes' && pendingT > 0             && activeTab !== 'passes' ? 'blink'   : '',
      isSec && k === 'passes' && pendingT === 0 && pendingP > 0 && activeTab !== 'passes' ? 'blink-y' : '',
      isCon && k === 'passes' && pendingT > 0             && activeTab !== 'passes' ? 'blink'   : '',
      k === 'chat' && unreadMsgs > 0                      && activeTab !== 'chat'   ? 'blink-y' : '',
    ].filter(Boolean).join(' ');
    map[k]         = mods ? `tn-btn ${mods}` : 'tn-btn';
    map[k + '_mn'] = mods ? `mn-btn ${mods}` : 'mn-btn';
  }
  return map;
}
