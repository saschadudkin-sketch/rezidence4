import { ROLES, canAccessTab, getTabsForRole } from './permissions';

describe('permissions tab access guards', () => {
  test('security can access guardpost and passes', () => {
    expect(canAccessTab(ROLES.SECURITY, 'guardpost')).toBe(true);
    expect(canAccessTab(ROLES.SECURITY, 'passes')).toBe(true);
  });

  test('resident cannot access admin tabs', () => {
    expect(canAccessTab(ROLES.OWNER, 'users')).toBe(false);
    expect(canAccessTab(ROLES.TENANT, 'stats')).toBe(false);
  });

  test('getTabsForRole returns configured order', () => {
    expect(getTabsForRole(ROLES.ADMIN)).toEqual([
      'stats', 'requests', 'users', 'visitlog', 'blacklist', 'chat',
    ]);
  });
});
