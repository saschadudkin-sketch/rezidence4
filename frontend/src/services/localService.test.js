/**
 * services/localService.test.js
 * Проверяет что все stub-функции возвращают ожидаемые значения
 * и не бросают исключений (заглушки для demo-режима)
 */
import {
  createRequest, updateRequest, deleteRequest, uploadRequestPhoto,
  sendMessage, getAllUsers, saveUser, removeUser,
  savePerms, saveTemplates, getTemplates, getFirestorePerms,
  subscribeRequests, subscribeChat, subscribeUsers,
  fetchAllUsers, fetchPerms, fetchTemplates,
} from './localService';

describe('localService stubs', () => {
  test('createRequest возвращает { mode: "local" }', async () => {
    await expect(createRequest()).resolves.toEqual({ mode: 'local' });
  });

  test('updateRequest возвращает { mode: "local" }', async () => {
    await expect(updateRequest()).resolves.toEqual({ mode: 'local' });
  });

  test('deleteRequest возвращает { mode: "local" }', async () => {
    await expect(deleteRequest()).resolves.toEqual({ mode: 'local' });
  });

  test('uploadRequestPhoto возвращает переданный url', async () => {
    const url = 'http://localhost/uploads/photo.jpg';
    await expect(uploadRequestPhoto('req-1', url)).resolves.toBe(url);
  });

  test('sendMessage возвращает { mode: "local" }', async () => {
    await expect(sendMessage()).resolves.toEqual({ mode: 'local' });
  });

  test('getAllUsers возвращает пустой массив', async () => {
    await expect(getAllUsers()).resolves.toEqual([]);
  });

  test('saveUser возвращает { mode: "local" }', async () => {
    await expect(saveUser()).resolves.toEqual({ mode: 'local' });
  });

  test('removeUser возвращает { mode: "local" }', async () => {
    await expect(removeUser()).resolves.toEqual({ mode: 'local' });
  });

  test('savePerms возвращает { mode: "local" }', async () => {
    await expect(savePerms()).resolves.toEqual({ mode: 'local' });
  });

  test('saveTemplates возвращает { mode: "local" }', async () => {
    await expect(saveTemplates()).resolves.toEqual({ mode: 'local' });
  });

  test('getTemplates возвращает пустой массив', async () => {
    await expect(getTemplates()).resolves.toEqual([]);
  });

  test('getFirestorePerms возвращает null', async () => {
    await expect(getFirestorePerms()).resolves.toBeNull();
  });

  test('fetchAllUsers возвращает пустой массив', async () => {
    await expect(fetchAllUsers()).resolves.toEqual([]);
  });

  test('fetchPerms возвращает null', async () => {
    await expect(fetchPerms()).resolves.toBeNull();
  });

  test('fetchTemplates возвращает пустой массив', async () => {
    await expect(fetchTemplates()).resolves.toEqual([]);
  });

  test('subscribeRequests возвращает функцию отписки', () => {
    const unsub = subscribeRequests();
    expect(typeof unsub).toBe('function');
    expect(() => unsub()).not.toThrow();
  });

  test('subscribeChat возвращает функцию отписки', () => {
    const unsub = subscribeChat();
    expect(typeof unsub).toBe('function');
    expect(() => unsub()).not.toThrow();
  });

  test('subscribeUsers возвращает функцию отписки', () => {
    const unsub = subscribeUsers();
    expect(typeof unsub).toBe('function');
    expect(() => unsub()).not.toThrow();
  });
});
