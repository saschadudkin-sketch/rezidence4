import {
  setStatusWithHistory,
  arriveWithHistory,
  approveAndArriveWithHistory,
} from './requestWorkflow';

describe('requestWorkflow', () => {
  test('setStatusWithHistory dispatches status + history', () => {
    const dispatch = jest.fn();

    setStatusWithHistory(dispatch, 'r1', 'approved', 'Допуск разрешён', 'Иван', 'security');

    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenNthCalledWith(1, expect.objectContaining({
      type: 'REQUEST_SET_STATUS', id: 'r1', status: 'approved',
    }));
    expect(dispatch).toHaveBeenNthCalledWith(2, expect.objectContaining({
      type: 'HISTORY_ADD', reqId: 'r1', byName: 'Иван', byRole: 'security', label: 'Допуск разрешён',
    }));
  });

  test('arriveWithHistory dispatches arrive + history', () => {
    const dispatch = jest.fn();

    arriveWithHistory(dispatch, 'r2', 'Анна', 'security');

    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenNthCalledWith(1, expect.objectContaining({
      type: 'REQUEST_ARRIVE', id: 'r2',
    }));
    expect(dispatch).toHaveBeenNthCalledWith(2, expect.objectContaining({
      type: 'HISTORY_ADD', reqId: 'r2', label: 'Отмечен вход',
    }));
  });

  test('approveAndArriveWithHistory dispatches 4 actions in order', () => {
    const dispatch = jest.fn();

    approveAndArriveWithHistory(dispatch, 'r3', 'Охрана', 'security');

    expect(dispatch).toHaveBeenCalledTimes(4);
    expect(dispatch).toHaveBeenNthCalledWith(1, expect.objectContaining({
      type: 'REQUEST_SET_STATUS', id: 'r3', status: 'approved',
    }));
    expect(dispatch).toHaveBeenNthCalledWith(2, expect.objectContaining({
      type: 'REQUEST_ARRIVE', id: 'r3',
    }));
    expect(dispatch).toHaveBeenNthCalledWith(3, expect.objectContaining({
      type: 'HISTORY_ADD', reqId: 'r3', label: 'Допуск разрешён',
    }));
    expect(dispatch).toHaveBeenNthCalledWith(4, expect.objectContaining({
      type: 'HISTORY_ADD', reqId: 'r3', label: 'Отмечен вход',
    }));
  });
});
