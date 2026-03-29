/**
 * store/requestActionTypes.test.js
 * Проверяет что все экспортируемые константы соответствуют ожидаемым строковым значениям
 */
import {
  REQUEST_SET_STATUS,
  REQUEST_ARRIVE,
  HISTORY_ADD,
} from './requestActionTypes';

describe('requestActionTypes', () => {
  test('REQUEST_SET_STATUS = "REQUEST_SET_STATUS"', () => {
    expect(REQUEST_SET_STATUS).toBe('REQUEST_SET_STATUS');
  });

  test('REQUEST_ARRIVE = "REQUEST_ARRIVE"', () => {
    expect(REQUEST_ARRIVE).toBe('REQUEST_ARRIVE');
  });

  test('HISTORY_ADD = "HISTORY_ADD"', () => {
    expect(HISTORY_ADD).toBe('HISTORY_ADD');
  });

  test('все значения уникальны', () => {
    const values = [REQUEST_SET_STATUS, REQUEST_ARRIVE, HISTORY_ADD];
    expect(new Set(values).size).toBe(values.length);
  });
});
