/**
 * integration/requestFlow.test.js
 * Интеграционный тест: создание → одобрение → вход гостя.
 */

import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { AppProvider, useActions, useRequests } from '../store/AppStore';

const wrapper = ({ children }) => <AppProvider>{children}</AppProvider>;

describe('Integration: флоу создания и обработки заявки', () => {
  function useFlow() {
    return {
      actions: useActions(),
      requests: useRequests(),
    };
  }

  it('разовый пропуск жильца сразу активен и после прохода становится arrived', () => {
    const { result } = renderHook(() => useFlow(), { wrapper });

    const find = (id) => result.current.requests.find(r => r.id === id);

    act(() => {
      result.current.actions.addRequest({
        id: 'test-flow-1',
        type: 'pass',
        status: 'approved',
        category: 'guest',
        createdByUid: 'u1',
        createdByName: 'Тест Юзер',
        createdByRole: 'owner',
        createdAt: new Date(),
        arrivedAt: null,
        scheduledFor: null,
        validUntil: null,
        passDuration: 'once',
        photos: [],
        photo: null,
        comment: '',
        priority: 'normal',
      });
    });

    expect(find('test-flow-1').status).toBe('approved');

    act(() => { result.current.actions.arriveRequest('test-flow-1', 'Охранник', 'security'); });
    const arrived = find('test-flow-1');
    expect(arrived.status).toBe('arrived');
    expect(arrived.arrivedAt).toBeInstanceOf(Date);
  });

  it('охрана может отказать в разовом пропуске после автопринятия', () => {
    const { result } = renderHook(() => useFlow(), { wrapper });

    act(() => {
      result.current.actions.addRequest({
        id: 'test-flow-2',
        type: 'pass',
        status: 'approved',
        category: 'guest',
        createdByUid: 'u1',
        createdByName: 'Тест Юзер',
        createdByRole: 'owner',
        createdAt: new Date(),
        arrivedAt: null,
        scheduledFor: null,
        validUntil: null,
        passDuration: 'once',
        photos: [],
        photo: null,
        comment: '',
        priority: 'normal',
      });
    });

    act(() => { result.current.actions.rejectRequest('test-flow-2', 'Охранник', 'security'); });
    expect(result.current.requests.find(r => r.id === 'test-flow-2').status).toBe('rejected');
  });

  it('техзаявка принимается в работу', () => {
    const { result } = renderHook(() => useFlow(), { wrapper });

    act(() => {
      result.current.actions.addRequest({
        id: 'test-flow-3',
        type: 'tech',
        status: 'pending',
        category: 'electrician',
        createdByUid: 'u1',
        createdByName: 'Тест Юзер',
        createdByRole: 'owner',
        createdAt: new Date(),
        arrivedAt: null,
        scheduledFor: null,
        validUntil: null,
        passDuration: null,
        photos: [],
        photo: null,
        comment: 'Не работает розетка',
        priority: 'normal',
      });
    });

    act(() => { result.current.actions.acceptRequest('test-flow-3', 'Консьерж', 'concierge'); });
    expect(result.current.requests.find(r => r.id === 'test-flow-3').status).toBe('accepted');
  });

  it('запланированный разовый пропуск жильца активируется сразу как approved', () => {
    const { result } = renderHook(() => useFlow(), { wrapper });

    const pastDate = new Date(Date.now() - 60_000); // минута назад

    act(() => {
      result.current.actions.addRequest({
        id: 'test-flow-4',
        type: 'pass',
        status: 'scheduled',
        category: 'guest',
        createdByUid: 'u1',
        createdByName: 'Тест Юзер',
        createdByRole: 'owner',
        createdAt: new Date(Date.now() - 120_000),
        arrivedAt: null,
        scheduledFor: pastDate,
        validUntil: null,
        passDuration: 'once',
        photos: [],
        photo: null,
        comment: '',
        priority: 'normal',
      });
    });

    act(() => { result.current.actions.activateScheduled(); });
    expect(result.current.requests.find(r => r.id === 'test-flow-4').status).toBe('approved');
  });
});
