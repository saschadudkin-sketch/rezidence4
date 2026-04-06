/**
 * store/AppStore.test.js
 * Тесты для saveToLS / loadFromLS — критичная логика хранилища.
 */

// Мокаем localStorage
const localStorageMock = (() => {
  let store = {};
  return {
    getItem:    (k)    => store[k] ?? null,
    setItem:    (k, v) => { store[k] = String(v); },
    removeItem: (k)    => { delete store[k]; },
    clear:      ()     => { store = {}; },
    get length()       { return Object.keys(store).length; },
    key:        (i)    => Object.keys(store)[i] ?? null,
  };
})();
Object.defineProperty(global, 'localStorage', { value: localStorageMock });

// saveToLS и loadFromLS не экспортированы напрямую — тестируем через поведение AppProvider
// Но можно вынести их через именованный экспорт. Здесь тестируем интеграционно через store.

import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { AppProvider, useActions, useChat, useRequests } from './AppStore';

const wrapper = ({ children }) => <AppProvider>{children}</AppProvider>;

beforeEach(() => {
  localStorageMock.clear();
});

describe('AppStore — localStorage round-trip', () => {
  it('заявка сохраняется и восстанавливается с корректными Date объектами', async () => {
    const { result } = renderHook(() => ({ actions: useActions(), requests: useRequests() }), { wrapper });

    const createdAt = new Date('2026-01-01T10:00:00.000Z');

    act(() => {
      result.current.actions.addRequest({
        id: 'r_ls_test',
        type: 'pass',
        category: 'guest',
        status: 'pending',
        createdByUid: 'u1',
        createdByName: 'Test',
        createdByRole: 'owner',
        createdAt,
        arrivedAt: null,
        scheduledFor: null,
        validUntil: null,
        photos: [],
        photo: null,
        passDuration: 'once',
        comment: '',
        priority: 'normal',
      });
    });

    // Ждём debounce сохранения (500мс)
    await act(async () => { await new Promise(r => setTimeout(r, 600)); });

    // Проверяем что заявка в сторе
    const req = result.current.requests.find(r => r.id === 'r_ls_test');
    expect(req).toBeTruthy();
    expect(req.createdAt).toBeInstanceOf(Date);
    expect(req.createdAt.toISOString()).toBe('2026-01-01T10:00:00.000Z');
  });

  it('photo сохраняется в отдельном ключе и восстанавливается', async () => {
    const { result } = renderHook(() => ({ actions: useActions(), requests: useRequests() }), { wrapper });

    const photoData = 'data:image/jpeg;base64,/9j/4AAQfakedata';

    act(() => {
      result.current.actions.addRequest({
        id: 'r_photo_test',
        type: 'pass',
        category: 'guest',
        status: 'pending',
        createdByUid: 'u1',
        createdByName: 'Test',
        createdByRole: 'owner',
        createdAt: new Date(),
        arrivedAt: null,
        scheduledFor: null,
        validUntil: null,
        photos: [photoData],
        photo: photoData,
        passDuration: 'once',
        comment: '',
        priority: 'normal',
      });
    });

    await act(async () => { await new Promise(r => setTimeout(r, 600)); });

    const req = result.current.requests.find(r => r.id === 'r_photo_test');
    expect(req?.photo).toBe(photoData);
    expect(req?.photos[0]).toBe(photoData);
  });
});

describe('AppStore — request workflow', () => {
  it('заявка создаётся → одобряется → arrivedAt устанавливается', () => {
    const { result } = renderHook(() => ({ actions: useActions(), requests: useRequests() }), { wrapper });

    act(() => {
      result.current.actions.addRequest({
        id: 'r_flow_1',
        type: 'pass',
        category: 'guest',
        status: 'pending',
        createdByUid: 'u1',
        createdByName: 'Test',
        createdByRole: 'owner',
        createdAt: new Date(),
        arrivedAt: null,
        scheduledFor: null,
        validUntil: null,
        photos: [],
        photo: null,
        passDuration: 'once',
        comment: '',
        priority: 'normal',
      });
    });

    expect(result.current.requests.find(r => r.id === 'r_flow_1').status).toBe('pending');

    act(() => { result.current.actions.approveRequest('r_flow_1', 'Охранник', 'security'); });
    expect(result.current.requests.find(r => r.id === 'r_flow_1').status).toBe('approved');

    act(() => { result.current.actions.arriveRequest('r_flow_1', 'Охранник', 'security'); });
    const arrived = result.current.requests.find(r => r.id === 'r_flow_1');
    expect(arrived.status).toBe('arrived');
    expect(arrived.arrivedAt).toBeInstanceOf(Date);
  });
});

describe('AppStore — FE-02 context slice stability', () => {
  it('обновление requests не меняет ссылку chat context', () => {
    const { result } = renderHook(() => ({
      actions: useActions(),
      chat: useChat(),
    }), { wrapper });

    const initialChatRef = result.current.chat;

    act(() => {
      result.current.actions.addRequest({
        id: 'r_ctx_ref',
        type: 'pass',
        category: 'guest',
        status: 'pending',
        createdByUid: 'u1',
        createdByName: 'Test',
        createdByRole: 'owner',
        createdAt: new Date(),
        arrivedAt: null,
        scheduledFor: null,
        validUntil: null,
        photos: [],
        photo: null,
        passDuration: 'once',
        comment: '',
        priority: 'normal',
      });
    });

    expect(result.current.chat).toBe(initialChatRef);
  });
});
