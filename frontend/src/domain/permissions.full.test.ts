/**
 * domain/permissions.full.test.js
 * Покрывает все экспорты permissions.js которые НЕ покрыты в существующем permissions.test.js:
 *   isResident, isStaff, canManageRequests,
 *   canEditRequest, canDeleteRequest, canApproveRequest, canRejectRequest,
 *   canAcceptRequest, canMarkArrival, canRepeatRequest, canViewRequest,
 *   canViewChat, canEditMessage, canDeleteMessage,
 *   canManageUsers, canChangeRole, canDeleteUser,
 *   canEditPerms, canViewPerms,
 *   can() fluent API
 */

import {
  ROLES,
  isResident, isStaff, canManageRequests,
  canEditRequest, canDeleteRequest,
  canApproveRequest, canRejectRequest, canAcceptRequest,
  canMarkArrival, canRepeatRequest, canViewRequest,
  canViewChat, canEditMessage, canDeleteMessage,
  canManageUsers, canChangeRole, canDeleteUser,
  canEditPerms, canViewPerms,
  can,
} from './permissions';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const user = (role, uid = 'u1') => ({ uid, role });
const req  = (status, createdByUid = 'u1', type = 'pass') => ({ status, createdByUid, type });
const msg  = (uid) => ({ uid });

// ─── Role predicates ──────────────────────────────────────────────────────────

describe('isResident', () => {
  test.each(['owner', 'tenant', 'contractor'])('%s → true', (role) => {
    expect(isResident(role)).toBe(true);
  });
  test.each(['concierge', 'security', 'admin'])('%s → false', (role) => {
    expect(isResident(role)).toBe(false);
  });
  test('неизвестная роль → false', () => {
    expect(isResident('superuser')).toBe(false);
  });
});

describe('isStaff', () => {
  test.each(['concierge', 'security'])('%s → true', (role) => {
    expect(isStaff(role)).toBe(true);
  });
  test.each(['owner', 'tenant', 'contractor', 'admin'])('%s → false', (role) => {
    expect(isStaff(role)).toBe(false);
  });
});

describe('canManageRequests', () => {
  test.each(['security', 'concierge', 'admin'])('%s → true', (role) => {
    expect(canManageRequests(role)).toBe(true);
  });
  test.each(['owner', 'tenant', 'contractor'])('%s → false', (role) => {
    expect(canManageRequests(role)).toBe(false);
  });
});

// ─── Request permissions ──────────────────────────────────────────────────────

describe('canEditRequest', () => {
  test('создатель может редактировать свою pending-заявку', () => {
    expect(canEditRequest(user('owner'), req('pending'))).toBe(true);
  });
  test('создатель не может редактировать approved-заявку', () => {
    expect(canEditRequest(user('owner'), req('approved'))).toBe(false);
  });
  test('чужую pending-заявку нельзя редактировать', () => {
    expect(canEditRequest(user('owner', 'u2'), req('pending', 'u1'))).toBe(false);
  });
  test('охрана не может редактировать (нет прямого права)', () => {
    expect(canEditRequest(user('security', 'u2'), req('pending', 'u1'))).toBe(false);
  });
});

describe('canDeleteRequest', () => {
  test('создатель удаляет свою pending-заявку', () => {
    expect(canDeleteRequest(user('owner'), req('pending'))).toBe(true);
  });
  test('admin удаляет любую заявку любого статуса', () => {
    expect(canDeleteRequest(user('admin', 'a1'), req('approved', 'u1'))).toBe(true);
    expect(canDeleteRequest(user('admin', 'a1'), req('arrived',  'u1'))).toBe(true);
  });
  test('создатель не может удалить approved (только pending)', () => {
    expect(canDeleteRequest(user('owner'), req('approved'))).toBe(false);
  });
  test('чужую pending-заявку нельзя удалить (не admin)', () => {
    expect(canDeleteRequest(user('owner', 'u2'), req('pending', 'u1'))).toBe(false);
  });
});

describe('canApproveRequest', () => {
  test.each(['security', 'admin'])('%s одобряет pending', (role) => {
    expect(canApproveRequest(user(role), req('pending'))).toBe(true);
  });
  test('concierge не одобряет pending (backend parity)', () => {
    expect(canApproveRequest(user('concierge'), req('pending'))).toBe(false);
  });
  test('owner не может одобрить (BUG-3)', () => {
    expect(canApproveRequest(user('owner'), req('pending'))).toBe(false);
  });
  test('нельзя одобрить уже approved заявку', () => {
    expect(canApproveRequest(user('security'), req('approved'))).toBe(false);
  });
});

describe('canRejectRequest', () => {
  test('security отклоняет pending', () => {
    expect(canRejectRequest(user('security'), req('pending'))).toBe(true);
  });
  test('owner не может отклонить', () => {
    expect(canRejectRequest(user('owner'), req('pending'))).toBe(false);
  });
  test('нельзя отклонить уже rejected', () => {
    expect(canRejectRequest(user('admin'), req('rejected'))).toBe(false);
  });
});

describe('canAcceptRequest', () => {
  test('security принимает pending tech в работу', () => {
    expect(canAcceptRequest(user('security'), req('pending', 'u1', 'tech'))).toBe(true);
  });
  test('concierge может принять pending tech в работу', () => {
    expect(canAcceptRequest(user('concierge'), req('pending', 'u1', 'tech'))).toBe(true);
  });
  test('security не принимает pass через accept flow', () => {
    expect(canAcceptRequest(user('security'), req('pending', 'u1', 'pass'))).toBe(false);
  });
  test('owner не может принять', () => {
    expect(canAcceptRequest(user('owner'), req('pending', 'u1', 'tech'))).toBe(false);
  });
});

describe('canMarkArrival', () => {
  test('security отмечает приход на approved-заявке', () => {
    expect(canMarkArrival(user('security'), req('approved'))).toBe(true);
  });
  test('concierge не может отметить приход', () => {
    expect(canMarkArrival(user('concierge'), req('approved'))).toBe(false);
  });
  test('security не может отметить приход на pending', () => {
    expect(canMarkArrival(user('security'), req('pending'))).toBe(false);
  });
  test('admin не может отметить приход (только security)', () => {
    expect(canMarkArrival(user('admin'), req('approved'))).toBe(false);
  });
});

describe('canRepeatRequest', () => {
  test.each(['rejected', 'accepted', 'arrived'])('создатель повторяет %s заявку', (status) => {
    expect(canRepeatRequest(user('owner'), req(status))).toBe(true);
  });
  test('нельзя повторить pending', () => {
    expect(canRepeatRequest(user('owner'), req('pending'))).toBe(false);
  });
  test('нельзя повторить чужую заявку', () => {
    expect(canRepeatRequest(user('owner', 'u2'), req('rejected', 'u1'))).toBe(false);
  });
});

describe('canViewRequest', () => {
  test('жилец видит свои заявки', () => {
    expect(canViewRequest(user('owner'), req('pending'))).toBe(true);
  });
  test('жилец не видит чужие заявки', () => {
    expect(canViewRequest(user('owner', 'u2'), req('pending', 'u1'))).toBe(false);
  });
  test('охрана видит все заявки', () => {
    expect(canViewRequest(user('security', 'g1'), req('pending', 'u1'))).toBe(true);
  });
  test('admin видит все заявки', () => {
    expect(canViewRequest(user('admin', 'a1'), req('pending', 'u1'))).toBe(true);
  });
  test('concierge видит все заявки', () => {
    expect(canViewRequest(user('concierge', 'c1'), req('pending', 'u1'))).toBe(true);
  });
});

// ─── Chat permissions ─────────────────────────────────────────────────────────

describe('canViewChat', () => {
  test('аутентифицированный пользователь видит чат', () => {
    expect(canViewChat({ uid: 'u1' })).toBe(true);
  });
  test('null user — нет доступа', () => {
    expect(canViewChat(null)).toBe(false);
  });
  test('user без uid — нет доступа', () => {
    expect(canViewChat({})).toBe(false);
  });
});

describe('canEditMessage', () => {
  test('автор может редактировать своё сообщение', () => {
    expect(canEditMessage(user('owner'), msg('u1'))).toBe(true);
  });
  test('другой пользователь не может редактировать', () => {
    expect(canEditMessage(user('owner', 'u2'), msg('u1'))).toBe(false);
  });
  test('admin может редактировать чужое сообщение', () => {
    expect(canEditMessage(user('admin', 'a1'), msg('u1'))).toBe(true);
  });
});

describe('canDeleteMessage', () => {
  test('автор удаляет своё сообщение', () => {
    expect(canDeleteMessage(user('owner'), msg('u1'))).toBe(true);
  });
  test('admin удаляет любое сообщение', () => {
    expect(canDeleteMessage(user('admin', 'a1'), msg('u1'))).toBe(true);
  });
  test('другой пользователь (не admin) не может удалить', () => {
    expect(canDeleteMessage(user('owner', 'u2'), msg('u1'))).toBe(false);
  });
});

// ─── User management permissions ──────────────────────────────────────────────

describe('canManageUsers', () => {
  test('admin управляет пользователями', () => {
    expect(canManageUsers(user('admin'))).toBe(true);
  });
  test.each(['owner', 'security', 'concierge'])('%s не управляет пользователями', (role) => {
    expect(canManageUsers(user(role))).toBe(false);
  });
});

describe('canChangeRole', () => {
  test('admin меняет роль другого пользователя', () => {
    expect(canChangeRole(user('admin', 'a1'), user('owner', 'u1'))).toBe(true);
  });
  test('admin не может сам себе поменять роль', () => {
    expect(canChangeRole(user('admin', 'a1'), user('admin', 'a1'))).toBe(false);
  });
  test('не-admin не может менять роли', () => {
    expect(canChangeRole(user('security', 'g1'), user('owner', 'u1'))).toBe(false);
  });
});

describe('canDeleteUser', () => {
  test('admin удаляет другого пользователя', () => {
    expect(canDeleteUser(user('admin', 'a1'), user('owner', 'u1'))).toBe(true);
  });
  test('admin не может удалить сам себя', () => {
    expect(canDeleteUser(user('admin', 'a1'), user('admin', 'a1'))).toBe(false);
  });
  test('не-admin не может удалять', () => {
    expect(canDeleteUser(user('concierge', 'c1'), user('owner', 'u1'))).toBe(false);
  });
});

// ─── Perms permissions ────────────────────────────────────────────────────────

describe('canEditPerms', () => {
  test('пользователь редактирует свой список', () => {
    expect(canEditPerms(user('owner', 'u1'), 'u1')).toBe(true);
  });
  test('admin редактирует список любого', () => {
    expect(canEditPerms(user('admin', 'a1'), 'u1')).toBe(true);
  });
  test('другой пользователь не может редактировать', () => {
    expect(canEditPerms(user('owner', 'u2'), 'u1')).toBe(false);
  });
});

describe('canViewPerms', () => {
  test('пользователь видит свой список', () => {
    expect(canViewPerms(user('owner', 'u1'), 'u1')).toBe(true);
  });
  test('admin видит любой список', () => {
    expect(canViewPerms(user('admin', 'a1'), 'u1')).toBe(true);
  });
  test('staff (security/concierge) видит любой список', () => {
    expect(canViewPerms(user('security', 'g1'), 'u1')).toBe(true);
    expect(canViewPerms(user('concierge', 'c1'), 'u1')).toBe(true);
  });
  test('другой жилец не видит чужой список', () => {
    expect(canViewPerms(user('owner', 'u2'), 'u1')).toBe(false);
  });
});

// ─── can() fluent API ─────────────────────────────────────────────────────────

describe('can() fluent interface', () => {
  test('can(user).editRequest(req) работает', () => {
    const p = can(user('owner', 'u1'));
    expect(p.editRequest(req('pending', 'u1'))).toBe(true);
    expect(p.editRequest(req('approved', 'u1'))).toBe(false);
  });

  test('can(user).approveRequest(req) работает', () => {
    expect(can(user('security')).approveRequest(req('pending'))).toBe(true);
    expect(can(user('owner')).approveRequest(req('pending'))).toBe(false);
  });

  test('can(user).markArrival(req) работает', () => {
    expect(can(user('security')).markArrival(req('approved'))).toBe(true);
    expect(can(user('admin')).markArrival(req('approved'))).toBe(false);
  });

  test('can(user).deleteMessage(msg) работает', () => {
    expect(can(user('admin', 'a1')).deleteMessage(msg('u1'))).toBe(true);
    expect(can(user('owner', 'u2')).deleteMessage(msg('u1'))).toBe(false);
  });

  test('can(user).viewChat() работает', () => {
    expect(can(user('owner')).viewChat()).toBe(true);
    expect(can(null).viewChat()).toBe(false);
  });

  test('can(user).editPerms(targetUid) работает', () => {
    expect(can(user('owner', 'u1')).editPerms('u1')).toBe(true);
    expect(can(user('owner', 'u2')).editPerms('u1')).toBe(false);
  });

  test('can(user).manageUsers() работает', () => {
    expect(can(user('admin')).manageUsers()).toBe(true);
    expect(can(user('security')).manageUsers()).toBe(false);
  });

  test('can(user).deleteUser(target) работает', () => {
    const admin = user('admin', 'a1');
    expect(can(admin).deleteUser(user('owner', 'u1'))).toBe(true);
    expect(can(admin).deleteUser(admin)).toBe(false); // нельзя себя
  });
});
