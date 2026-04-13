import { ROLE_MANIFEST } from './roleManifest';
import type { ChatMessage } from '../store/slices/chatSlice';
import type { AppRequest } from '../store/slices/requestsSlice';
import type { AppUser, UserRole } from '../store/slices/usersSlice';

type RoleLike = UserRole | string;
type PermissionUser = Pick<AppUser, 'uid'> & { role: RoleLike };
type PermissionRequest = Pick<AppRequest, 'id' | 'createdByUid' | 'status' | 'type' | 'passDuration'>;
type PermissionMessage = Pick<ChatMessage, 'uid'>;

export type PermissionChecks = {
  editRequest: (req: PermissionRequest) => boolean;
  deleteRequest: (req: PermissionRequest) => boolean;
  approveRequest: (req: PermissionRequest) => boolean;
  rejectRequest: (req: PermissionRequest) => boolean;
  acceptRequest: (req: PermissionRequest) => boolean;
  markArrival: (req: PermissionRequest) => boolean;
  repeatRequest: (req: PermissionRequest) => boolean;
  viewRequest: (req: PermissionRequest) => boolean;
  viewChat: () => boolean;
  editMessage: (msg: PermissionMessage) => boolean;
  deleteMessage: (msg: PermissionMessage) => boolean;
  manageUsers: () => boolean;
  changeRole: (target: AppUser) => boolean;
  deleteUser: (target: AppUser) => boolean;
  editPerms: (targetUid: string) => boolean;
  viewPerms: (targetUid: string) => boolean;
};

export const ROLES = {
  OWNER: 'owner',
  TENANT: 'tenant',
  CONTRACTOR: 'contractor',
  CONCIERGE: 'concierge',
  SECURITY: 'security',
  ADMIN: 'admin',
} as const;

const RESIDENT_ROLES_SET = new Set<UserRole>([ROLES.OWNER, ROLES.TENANT, ROLES.CONTRACTOR]);
const STAFF_ROLES_SET = new Set<UserRole>([ROLES.CONCIERGE, ROLES.SECURITY]);
const MANAGE_ROLES_SET = new Set<UserRole>([ROLES.SECURITY, ROLES.CONCIERGE, ROLES.ADMIN]);
const APPROVE_ROLES_SET = new Set<UserRole>([ROLES.SECURITY, ROLES.ADMIN]);
const REPEATABLE_STATUSES = new Set<AppRequest['status']>(['rejected', 'accepted', 'arrived']);

export const isResident = (role: RoleLike): boolean => RESIDENT_ROLES_SET.has(role as UserRole);
export const isStaff = (role: RoleLike): boolean => STAFF_ROLES_SET.has(role as UserRole);
export const canManageRequests = (role: RoleLike): boolean => MANAGE_ROLES_SET.has(role as UserRole);
export const canApproveRequests = (role: RoleLike): boolean => APPROVE_ROLES_SET.has(role as UserRole);

export const canEditRequest = (user: PermissionUser, req: PermissionRequest): boolean =>
  req.createdByUid === user.uid && req.status === 'pending';

export const canDeleteRequest = (user: PermissionUser, req: PermissionRequest): boolean =>
  (req.createdByUid === user.uid && req.status === 'pending')
  || user.role === ROLES.ADMIN;

export const canApproveRequest = (user: PermissionUser, req: PermissionRequest): boolean =>
  canApproveRequests(user.role) && req.status === 'pending';

export const canRejectRequest = (user: PermissionUser, req: PermissionRequest): boolean =>
  canApproveRequests(user.role)
  && (req.status === 'pending' || (req.type === 'pass' && req.status === 'approved'));

export const canAcceptRequest = (user: PermissionUser, req: PermissionRequest): boolean =>
  canApproveRequests(user.role) && req.status === 'pending';

export const canMarkArrival = (user: PermissionUser, req: PermissionRequest): boolean =>
  user.role === ROLES.SECURITY && req.status === 'approved';

export const canRepeatRequest = (user: PermissionUser, req: PermissionRequest): boolean =>
  req.createdByUid === user.uid && REPEATABLE_STATUSES.has(req.status);

export const canViewRequest = (user: PermissionUser, req: PermissionRequest): boolean =>
  !isResident(user.role) || req.createdByUid === user.uid;

export const canViewChat = (user: Pick<PermissionUser, 'uid'> | null | undefined): boolean => Boolean(user?.uid);

export const canEditMessage = (user: PermissionUser, msg: PermissionMessage): boolean =>
  msg.uid === user.uid || user.role === ROLES.ADMIN;

export const canDeleteMessage = (user: PermissionUser, msg: PermissionMessage): boolean =>
  msg.uid === user.uid || user.role === ROLES.ADMIN;

export const canManageUsers = (user: PermissionUser): boolean => user.role === ROLES.ADMIN;

export const canChangeRole = (user: PermissionUser, targetUser: Pick<AppUser, 'uid'>): boolean =>
  user.role === ROLES.ADMIN && user.uid !== targetUser.uid;

export const canDeleteUser = (user: PermissionUser, targetUser: Pick<AppUser, 'uid'>): boolean =>
  user.role === ROLES.ADMIN && user.uid !== targetUser.uid;

export const canEditPerms = (user: PermissionUser, targetUid: string): boolean =>
  user.uid === targetUid || user.role === ROLES.ADMIN;

export const canViewPerms = (user: PermissionUser, targetUid: string): boolean =>
  user.uid === targetUid || isStaff(user.role) || user.role === ROLES.ADMIN;

export const ALLOWED_TABS_BY_ROLE: Record<UserRole, string[]> = {
  owner: ROLE_MANIFEST.owner.tabs,
  tenant: ROLE_MANIFEST.tenant.tabs,
  contractor: ROLE_MANIFEST.contractor.tabs,
  concierge: ROLE_MANIFEST.concierge.tabs,
  security: ROLE_MANIFEST.security.tabs,
  admin: ROLE_MANIFEST.admin.tabs,
};

export const getTabsForRole = (role: RoleLike): string[] => ALLOWED_TABS_BY_ROLE[role as UserRole] || [];
export const canAccessTab = (role: RoleLike, tab: string): boolean => getTabsForRole(role).includes(tab);

export const can = (user: AppUser): PermissionChecks => ({
  editRequest: (req) => canEditRequest(user, req),
  deleteRequest: (req) => canDeleteRequest(user, req),
  approveRequest: (req) => canApproveRequest(user, req),
  rejectRequest: (req) => canRejectRequest(user, req),
  acceptRequest: (req) => canAcceptRequest(user, req),
  markArrival: (req) => canMarkArrival(user, req),
  repeatRequest: (req) => canRepeatRequest(user, req),
  viewRequest: (req) => canViewRequest(user, req),
  viewChat: () => canViewChat(user),
  editMessage: (msg) => canEditMessage(user, msg),
  deleteMessage: (msg) => canDeleteMessage(user, msg),
  manageUsers: () => canManageUsers(user),
  changeRole: (target) => canChangeRole(user, target),
  deleteUser: (target) => canDeleteUser(user, target),
  editPerms: (targetUid) => canEditPerms(user, targetUid),
  viewPerms: (targetUid) => canViewPerms(user, targetUid),
});
