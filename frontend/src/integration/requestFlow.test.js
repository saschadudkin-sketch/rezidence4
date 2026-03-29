/**
 * integration/requestFlow.test.js
 * Интеграционный тест: создание → одобрение → вход гостя.
 */

import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { AppProvider, useActions, useRequests } from '../store/AppStore';

const wrapper = ({ children }) => <AppProvider>{children}</AppProvider>;

describe('Integration: флоу создания и одобрения заявки', () => {
  it('заявка создаётся, одобряется и отмечается как arrived', () => {
    const { result: actResult } = renderHook(() => useActions(), { wrapper });
    const { result: reqResult } = renderHook(() => useRequests(), { wrapper });

    const find = (id) => reqResult.current.find(r => r.id === id);

    act(() => {
      actResult.current.addRequest({
        id: 'test-flow-1',
        type: 'pass',
        status: 'pending',
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

    expect(find('test-flow-1').status).toBe('pending');

    act(() => { actResult.current.approveRequest('test-flow-1', 'Охранник', 'security'); });
    expect(find('test-flow-1').status).toBe('approved');

    act(() => { actResult.current.arriveRequest('test-flow-1', 'Охранник', 'security'); });
    const arrived = find('test-flow-1');
    expect(arrived.status).toBe('arrived');
    expect(arrived.arrivedAt).toBeInstanceOf(Date);
  });

  it('заявка отклоняется охранником', () => {
    const { result: actResult } = renderHook(() => useActions(), { wrapper });
    const { result: reqResult } = renderHook(() => useRequests(), { wrapper });

    act(() => {
      actResult.current.addRequest({
        id: 'test-flow-2',
        type: 'pass',
        status: 'pending',
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

    act(() => { actResult.current.rejectRequest('test-flow-2', 'Охранник', 'security'); });
    expect(reqResult.current.find(r => r.id === 'test-flow-2').status).toBe('rejected');
  });

  it('техзаявка принимается в работу', () => {
    const { result: actResult } = renderHook(() => useActions(), { wrapper });
    const { result: reqResult } = renderHook(() => useRequests(), { wrapper });

    act(() => {
      actResult.current.addRequest({
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

    act(() => { actResult.current.acceptRequest('test-flow-3', 'Консьерж', 'concierge'); });
    expect(reqResult.current.find(r => r.id === 'test-flow-3').status).toBe('accepted');
  });

  it('запланированная заявка активируется', () => {
    const { result: actResult } = renderHook(() => useActions(), { wrapper });
    const { result: reqResult } = renderHook(() => useRequests(), { wrapper });

    const pastDate = new Date(Date.now() - 60_000); // минута назад

    act(() => {
      actResult.current.addRequest({
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

    act(() => { actResult.current.activateScheduled(); });
    expect(reqResult.current.find(r => r.id === 'test-flow-4').status).toBe('pending');
  });
});
