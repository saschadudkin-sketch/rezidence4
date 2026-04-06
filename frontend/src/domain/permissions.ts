import { ROLE_MANIFEST } from './roleManifest';
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
 *
 * Типизация — нативный TypeScript (без JSDoc typedef в рантайм-коде).
 */

export type Role = 'owner' | 'tenant' | 'contractor' | 'concierge' | 'security' | 'admin';
export type AppUser = { uid?: string; role?: Role | string; name?: string; apartment?: string };
export type Request = { id: string; createdByUid: string; status: string; type?: string; passDuration?: string };
export type ChatMessage = { uid?: string; role?: Role | string };

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
const APPROVE_ROLES_SET   = new Set([ROLES.SECURITY, ROLES.ADMIN]);

/** Жилец (может создавать заявки и видеть только свои). */
export const isResident = (role?: string): boolean => RESIDENT_ROLES_SET.has(role as Role);

/** Оперативный персонал (обрабатывает заявки в реальном времени). */
export const isStaff = (role?: string): boolean => STAFF_ROLES_SET.has(role as Role);

/** Видит все заявки + получает уведомления о новых. */
export const canManageRequests = (role?: string): boolean => MANAGE_ROLES_SET.has(role as Role);

/** Может одобрять/отклонять заявки. */
export const canApproveRequests = (role?: string): boolean => APPROVE_ROLES_SET.has(role as Role);

// ─── Заявки ──────────────────────────────────────────────────────────────────

/**
 * Может ли пользователь редактировать заявку
 * Только создатель пока заявка в статусе pending
 * @param {AppUser} user @param {Request} req @returns {boolean}
 */
export const canEditRequest = (user: AppUser, req: Request): boolean =>
  req.createdByUid === user.uid && req.status === 'pending';

/**
 * Может ли пользователь удалить заявку
 * Создатель (pending) или администратор
 * @param {AppUser} user @param {Request} req @returns {boolean}
 */
export const canDeleteRequest = (user: AppUser, req: Request): boolean =>
  (req.createdByUid === user.uid && req.status === 'pending')
  || user.role === ROLES.ADMIN;

/**
 * Может ли пользователь одобрить заявку
 * Только роли из canApproveRequests
 */
export const canApproveRequest = (user: AppUser, req: Request): boolean =>
  canApproveRequests(user.role) && req.status === 'pending';

/**
 * Может ли пользователь отклонить заявку
 */
export const canRejectRequest = (user: AppUser, req: Request): boolean =>
  canApproveRequests(user.role) && req.status === 'pending';

/**
 * Может ли пользователь принять заявку в работу
 */
export const canAcceptRequest = (user: AppUser, req: Request): boolean =>
  canApproveRequests(user.role) && req.status === 'pending';

/**
 * Может ли пользователь отметить приход посетителя
 * Охрана — только approved
 */
export const canMarkArrival = (user: AppUser, req: Request): boolean =>
  user.role === ROLES.SECURITY && req.status === 'approved';

/**
 * Может ли пользователь повторить заявку (создать такую же)
 * Только создатель, только завершённые
 */
export const canRepeatRequest = (user: AppUser, req: Request): boolean =>
  req.createdByUid === user.uid
  && ['rejected', 'accepted', 'arrived'].includes(req.status);

/**
 * Может ли пользователь видеть заявку
 * Жилец видит только свои; персонал и админ — все
 */
export const canViewRequest = (user: AppUser, req: Request): boolean =>
  !isResident(user.role) || req.createdByUid === user.uid;

// ─── Чат ─────────────────────────────────────────────────────────────────────

/** Доступ к чату — все аутентифицированные пользователи */
export const canViewChat = (user: AppUser): boolean => Boolean(user?.uid);

/** Может ли редактировать сообщение — своё или администратор */
export const canEditMessage = (user: AppUser, msg: ChatMessage): boolean =>
  msg.uid === user.uid || user.role === ROLES.ADMIN;

/** Может ли удалить сообщение — своё или администратор */
export const canDeleteMessage = (user: AppUser, msg: ChatMessage): boolean =>
  msg.uid === user.uid || user.role === ROLES.ADMIN;

// ─── Пользователи и роли ─────────────────────────────────────────────────────

/** Может ли управлять пользователями (создавать, редактировать, удалять) */
export const canManageUsers = (user: AppUser): boolean => user.role === ROLES.ADMIN;

/** Может ли изменить роль другого пользователя */
export const canChangeRole = (user: AppUser, targetUser: AppUser): boolean =>
  user.role === ROLES.ADMIN && user.uid !== targetUser.uid;

/** Может ли удалить пользователя */
export const canDeleteUser = (user: AppUser, targetUser: AppUser): boolean =>
  user.role === ROLES.ADMIN && user.uid !== targetUser.uid;

// ─── Перм-списки (постоянные посетители/рабочие) ────────────────────────────

/** Может ли редактировать перм-список квартиры */
export const canEditPerms = (user: AppUser, targetUid: string): boolean =>
  user.uid === targetUid || user.role === ROLES.ADMIN;

/** Может ли просматривать перм-список другого жильца */
export const canViewPerms = (user: AppUser, targetUid: string): boolean =>
  user.uid === targetUid
  || isStaff(user.role)
  || user.role === ROLES.ADMIN;

// ─── Доступ к экранaм (route/feature guard) ─────────────────────────────────

export const ALLOWED_TABS_BY_ROLE = {
  [ROLES.OWNER]:      ROLE_MANIFEST.owner.tabs,
  [ROLES.TENANT]:     ROLE_MANIFEST.tenant.tabs,
  [ROLES.CONTRACTOR]: ROLE_MANIFEST.contractor.tabs,
  [ROLES.CONCIERGE]:  ROLE_MANIFEST.concierge.tabs,
  [ROLES.SECURITY]:   ROLE_MANIFEST.security.tabs,
  [ROLES.ADMIN]:      ROLE_MANIFEST.admin.tabs,
};

export const getTabsForRole = (role: string): string[] => ALLOWED_TABS_BY_ROLE[role as Role] || [];

export const canAccessTab = (role: string, tab: string): boolean => getTabsForRole(role).includes(tab);

// ─── Флюент-интерфейс (опционально, для удобства) ────────────────────────────

/**
 * Флюент-обёртка для удобных проверок в компонентах:
 *
 *   const perms = can(user);
 *   if (perms.editRequest(req)) { ... }
 *   if (perms.deleteUser(targetUser)) { ... }
 *
 */
export const can = (user: AppUser) => ({
  editRequest:   (req: Request) => canEditRequest(user, req),
  deleteRequest: (req: Request) => canDeleteRequest(user, req),
  approveRequest:(req: Request) => canApproveRequest(user, req),
  rejectRequest: (req: Request) => canRejectRequest(user, req),
  acceptRequest: (req: Request) => canAcceptRequest(user, req),
  markArrival:   (req: Request) => canMarkArrival(user, req),
  repeatRequest: (req: Request) => canRepeatRequest(user, req),
  viewRequest:   (req: Request) => canViewRequest(user, req),
  viewChat:      ()           => canViewChat(user),
  editMessage:   (msg: ChatMessage) => canEditMessage(user, msg),
  deleteMessage: (msg: ChatMessage) => canDeleteMessage(user, msg),
  manageUsers:   ()           => canManageUsers(user),
  changeRole:    (target: AppUser) => canChangeRole(user, target),
  deleteUser:    (target: AppUser) => canDeleteUser(user, target),
  editPerms:     (targetUid: string) => canEditPerms(user, targetUid),
  viewPerms:     (targetUid: string) => canViewPerms(user, targetUid),
});
