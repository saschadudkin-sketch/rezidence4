/**
 * domain/permissions.js — Permission Engine
 *
 * Единственное место где описано ЧТО КТО МОЖЕТ ДЕЛАТЬ.
 * Все компоненты и хуки проверяют права только через этот модуль.
 *
 * Паттерн использования:
 *   import { can } from '../domain/permissions';
 *   if (can(user).editRequest(req)) { ... }
 *
 * Или отдельные предикаты:
 *   import { canEditRequest, canDeleteRequest } from '../domain/permissions';
 */

// ─── Роли ────────────────────────────────────────────────────────────────────

export const ROLES = {
  OWNER:      'owner',
  TENANT:     'tenant',
  CONTRACTOR: 'contractor',
  CONCIERGE:  'concierge',
  SECURITY:   'security',
  ADMIN:      'admin',
};

// FIX [PERF]: Set.has() — O(1) вместо Array.includes() O(n)
const RESIDENT_ROLES_SET  = new Set([ROLES.OWNER, ROLES.TENANT, ROLES.CONTRACTOR]);
const STAFF_ROLES_SET     = new Set([ROLES.CONCIERGE, ROLES.SECURITY]);
// Видит все заявки (не только свои) + получает уведомления
const MANAGE_ROLES_SET    = new Set([ROLES.SECURITY, ROLES.CONCIERGE, ROLES.ADMIN]);
// Может одобрять/отклонять заявки (консьерж — только просмотр)
const APPROVE_ROLES_SET   = new Set([ROLES.SECURITY, ROLES.CONCIERGE, ROLES.ADMIN]);

/** Жилец (может создавать заявки и видеть только свои) */
export const isResident = (role) => RESIDENT_ROLES_SET.has(role);

/** Оперативный персонал (обрабатывает заявки в реальном времени) */
export const isStaff = (role) => STAFF_ROLES_SET.has(role);

/** Видит все заявки + получает уведомления о новых */
export const canManageRequests = (role) => MANAGE_ROLES_SET.has(role);

/** Может одобрять/отклонять заявки (НЕ консьерж) */
export const canApproveRequests = (role) => APPROVE_ROLES_SET.has(role);

// ─── Заявки ──────────────────────────────────────────────────────────────────

/**
 * Может ли пользователь редактировать заявку
 * Только создатель пока заявка в статусе pending
 */
export const canEditRequest = (user, req) =>
  req.createdByUid === user.uid && req.status === 'pending';

/**
 * Может ли пользователь удалить заявку
 * Создатель (pending) или администратор
 */
export const canDeleteRequest = (user, req) =>
  (req.createdByUid === user.uid && req.status === 'pending')
  || user.role === ROLES.ADMIN;

/**
 * Может ли пользователь одобрить заявку
 * Только охрана и администратор (НЕ консьерж)
 */
export const canApproveRequest = (user, req) =>
  canApproveRequests(user.role) && req.status === 'pending';

/**
 * Может ли пользователь отклонить заявку
 */
export const canRejectRequest = (user, req) =>
  canApproveRequests(user.role) && req.status === 'pending';

/**
 * Может ли пользователь принять заявку в работу
 */
export const canAcceptRequest = (user, req) =>
  canApproveRequests(user.role) && req.status === 'pending';

/**
 * Может ли пользователь отметить приход посетителя
 * Охрана — только approved
 */
export const canMarkArrival = (user, req) =>
  user.role === ROLES.SECURITY && req.status === 'approved';

/**
 * Может ли пользователь повторить заявку (создать такую же)
 * Только создатель, только завершённые
 */
export const canRepeatRequest = (user, req) =>
  req.createdByUid === user.uid
  && ['rejected', 'accepted', 'arrived'].includes(req.status);

/**
 * Может ли пользователь видеть заявку
 * Жилец видит только свои; персонал и админ — все
 */
export const canViewRequest = (user, req) =>
  !isResident(user.role) || req.createdByUid === user.uid;

// ─── Чат ─────────────────────────────────────────────────────────────────────

/** Доступ к чату — все аутентифицированные пользователи */
export const canViewChat = (user) => Boolean(user?.uid);

/** Может ли редактировать сообщение — своё или администратор */
export const canEditMessage = (user, msg) =>
  msg.uid === user.uid;

/** Может ли удалить сообщение — своё или администратор */
export const canDeleteMessage = (user, msg) =>
  msg.uid === user.uid;

// ─── Пользователи и роли ─────────────────────────────────────────────────────

/** Может ли управлять пользователями (создавать, редактировать, удалять) */
export const canManageUsers = (user) => user.role === ROLES.ADMIN;

/** Может ли изменить роль другого пользователя */
export const canChangeRole = (user, targetUser) =>
  user.role === ROLES.ADMIN && user.uid !== targetUser.uid;

/** Может ли удалить пользователя */
export const canDeleteUser = (user, targetUser) =>
  user.role === ROLES.ADMIN && user.uid !== targetUser.uid;

// ─── Перм-списки (постоянные посетители/рабочие) ────────────────────────────

/** Может ли редактировать перм-список квартиры */
export const canEditPerms = (user, targetUid) =>
  user.uid === targetUid || user.role === ROLES.ADMIN;

/** Может ли просматривать перм-список другого жильца */
export const canViewPerms = (user, targetUid) =>
  user.uid === targetUid
  || isStaff(user.role)
  || user.role === ROLES.ADMIN;

// ─── Доступ к экранaм (route/feature guard) ─────────────────────────────────

export const ALLOWED_TABS_BY_ROLE = {
  [ROLES.OWNER]:      ['passes', 'tech', 'perms', 'templates', 'history', 'chat'],
  [ROLES.TENANT]:     ['passes', 'tech', 'perms', 'templates', 'history', 'chat'],
  [ROLES.CONTRACTOR]: ['passes', 'tech', 'perms', 'templates', 'history', 'chat'],
  [ROLES.CONCIERGE]:  ['passes', 'residents', 'visitlog', 'blacklist', 'chat'],
  [ROLES.SECURITY]:   ['guardpost', 'passes', 'residents', 'visitlog', 'blacklist', 'chat'],
  [ROLES.ADMIN]:      ['stats', 'requests', 'users', 'visitlog', 'blacklist', 'chat'],
};

export const getTabsForRole = (role) => ALLOWED_TABS_BY_ROLE[role] || [];

export const canAccessTab = (role, tab) => getTabsForRole(role).includes(tab);

// ─── Флюент-интерфейс (опционально, для удобства) ────────────────────────────

/**
 * Флюент-обёртка для удобных проверок в компонентах:
 *
 *   const perms = can(user);
 *   if (perms.editRequest(req)) { ... }
 *   if (perms.deleteUser(targetUser)) { ... }
 */
export const can = (user) => ({
  editRequest:   (req)        => canEditRequest(user, req),
  deleteRequest: (req)        => canDeleteRequest(user, req),
  approveRequest:(req)        => canApproveRequest(user, req),
  rejectRequest: (req)        => canRejectRequest(user, req),
  acceptRequest: (req)        => canAcceptRequest(user, req),
  markArrival:   (req)        => canMarkArrival(user, req),
  repeatRequest: (req)        => canRepeatRequest(user, req),
  viewRequest:   (req)        => canViewRequest(user, req),
  viewChat:      ()           => canViewChat(user),
  editMessage:   (msg)        => canEditMessage(user, msg),
  deleteMessage: (msg)        => canDeleteMessage(user, msg),
  manageUsers:   ()           => canManageUsers(user),
  changeRole:    (target)     => canChangeRole(user, target),
  deleteUser:    (target)     => canDeleteUser(user, target),
  editPerms:     (targetUid)  => canEditPerms(user, targetUid),
  viewPerms:     (targetUid)  => canViewPerms(user, targetUid),
});
