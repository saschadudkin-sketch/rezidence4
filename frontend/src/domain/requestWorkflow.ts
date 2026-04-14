/** CQ-02: migrated from requestWorkflow.js */

import {
  REQUEST_SET_STATUS,
  REQUEST_ARRIVE,
  HISTORY_ADD,
} from '../store/requestActionTypes';
import type { AppDispatch } from '../store/boundedContexts/contexts';

function addHistory(
  dispatch: AppDispatch,
  reqId: string,
  byName: string,
  byRole: string,
  label: string,
  at: Date,
): void {
  dispatch({ type: HISTORY_ADD, reqId, byName, byRole, label, at });
}

export function setStatusWithHistory(
  dispatch: AppDispatch,
  reqId: string,
  status: string,
  label: string,
  byName: string,
  byRole: string,
): void {
  const now = new Date();
  dispatch({ type: REQUEST_SET_STATUS, id: reqId, status });
  addHistory(dispatch, reqId, byName, byRole, label, now);
}

export function arriveWithHistory(
  dispatch: AppDispatch,
  reqId: string,
  byName: string,
  byRole: string,
): void {
  const now = new Date();
  dispatch({ type: REQUEST_ARRIVE, id: reqId, arrivedAt: now });
  addHistory(dispatch, reqId, byName, byRole, 'Отмечен вход', now);
}

export function approveAndArriveWithHistory(
  dispatch: AppDispatch,
  reqId: string,
  byName: string,
  byRole: string,
): void {
  const now = new Date();
  dispatch({ type: REQUEST_SET_STATUS, id: reqId, status: 'approved' });
  dispatch({ type: REQUEST_ARRIVE, id: reqId, arrivedAt: now });
  addHistory(dispatch, reqId, byName, byRole, 'Допуск разрешён', now);
  addHistory(dispatch, reqId, byName, byRole, 'Отмечен вход', new Date(now.getTime() + 1));
}
