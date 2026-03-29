/**
 * requestWorkflow.js — централизованные переходы статусов заявок.
 *
 * Зачем:
 * - убрать дублирование последовательностей dispatch в разных местах;
 * - держать бизнес-правила статусов + историю в одном модуле;
 * - упростить тестирование и дальнейшее расширение workflow.
 */

import {
  REQUEST_SET_STATUS,
  REQUEST_ARRIVE,
  HISTORY_ADD,
} from '../store/requestActionTypes';

function addHistory(dispatch, reqId, byName, byRole, label, at) {
  dispatch({ type: HISTORY_ADD, reqId, byName, byRole, label, at });
}

export function setStatusWithHistory(dispatch, reqId, status, label, byName, byRole) {
  const now = new Date();
  dispatch({ type: REQUEST_SET_STATUS, id: reqId, status });
  addHistory(dispatch, reqId, byName, byRole, label, now);
}

export function arriveWithHistory(dispatch, reqId, byName, byRole) {
  const now = new Date();
  dispatch({ type: REQUEST_ARRIVE, id: reqId, arrivedAt: now });
  addHistory(dispatch, reqId, byName, byRole, 'Отмечен вход', now);
}

export function approveAndArriveWithHistory(dispatch, reqId, byName, byRole) {
  const now = new Date();
  dispatch({ type: REQUEST_SET_STATUS, id: reqId, status: 'approved' });
  dispatch({ type: REQUEST_ARRIVE, id: reqId, arrivedAt: now });
  addHistory(dispatch, reqId, byName, byRole, 'Допуск разрешён', now);
  addHistory(dispatch, reqId, byName, byRole, 'Отмечен вход', new Date(now.getTime() + 1));
}
