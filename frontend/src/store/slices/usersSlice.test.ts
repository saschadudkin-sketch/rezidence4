/**
 * usersSlice.test.js — тесты reducer пользователей
 */

import { usersReducer } from './usersSlice';

describe('usersReducer', () => {
  const baseState: any = {
    users: { u1: { uid: 'u1', name: 'Тест', phone: '+7 916 123-45-67', role: 'owner', apartment: '12' } },
    phoneDb: { '79161234567': { uid: 'u1', name: 'Тест', phone: '+7 916 123-45-67', role: 'owner', apartment: '12' } },
    avatars: {},
  };

  test('USERS_SET_ALL merges, does not overwrite', () => {
    const action: any = { type: 'USERS_SET_ALL', users: [{ uid: 'u2', name: 'Новый', phone: '+7 929 000-00-00', role: 'tenant', apartment: '34' }] };
    const result = usersReducer(baseState, action);
    expect(result.users.u1).toBeDefined();
    expect(result.users.u2).toBeDefined();
    expect(result.users.u2.name).toBe('Новый');
  });

  test('USERS_SET_ALL with empty array does not clear store', () => {
    const action = { type: 'USERS_SET_ALL', users: [] };
    const result = usersReducer(baseState, action);
    expect(result.users.u1).toBeDefined();
  });

  test('USERS_SET_ALL with null does not clear store', () => {
    const action = { type: 'USERS_SET_ALL', users: null };
    const result = usersReducer(baseState, action);
    expect(result).toBe(baseState);
  });

  test('USER_UPDATE updates specific user', () => {
    const action = { type: 'USER_UPDATE', user: { uid: 'u1', name: 'Обновлён', phone: '+7 916 123-45-67', role: 'owner', apartment: '12' } };
    const result = usersReducer(baseState, action);
    expect(result.users.u1.name).toBe('Обновлён');
  });

  test('AVATAR_SET sets avatar for user', () => {
    const action = { type: 'AVATAR_SET', uid: 'u1', avatar: { emoji: '😀', bg: '#ff0000' } };
    const result = usersReducer(baseState, action);
    expect(result.avatars.u1).toEqual({ emoji: '😀', bg: '#ff0000' });
  });

  test('unknown action returns state', () => {
    const result = usersReducer(baseState, { type: 'UNKNOWN' });
    expect(result).toBe(baseState);
  });
});
