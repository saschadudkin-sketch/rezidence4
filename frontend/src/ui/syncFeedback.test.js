jest.mock('./Toasts', () => ({
  toast: jest.fn(),
}));

import { toast } from './Toasts';
import {
  notifyLocalFallback,
  toastBySyncResult,
  DEFAULT_FALLBACK_MESSAGE,
  DEFAULT_SUCCESS_MESSAGE,
} from './syncFeedback';
import { SYNC_STATUS } from '../constants/syncStatuses';

describe('syncFeedback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test.each([SYNC_STATUS.REMOTE, SYNC_STATUS.LOCAL])(
    'returns false and does not toast for non-fallback mode: %s',
    (mode) => {
      const notified = notifyLocalFallback(mode, 'x');
      expect(notified).toBe(false);
      expect(toast).not.toHaveBeenCalled();
    }
  );

  test('shows provided message for local fallback mode', () => {
    const notified = notifyLocalFallback(SYNC_STATUS.LOCAL_FALLBACK, 'Локально сохранено');
    expect(notified).toBe(true);
    expect(toast).toHaveBeenCalledWith('Локально сохранено', 'info');
  });

  test('uses default message when no message is provided', () => {
    notifyLocalFallback(SYNC_STATUS.LOCAL_FALLBACK);
    expect(toast).toHaveBeenCalledWith(DEFAULT_FALLBACK_MESSAGE, 'info');
  });

  test('toastBySyncResult shows success message for synced result', () => {
    const status = toastBySyncResult(SYNC_STATUS.REMOTE, 'Сохранено', 'Локально');
    expect(status).toBe('success');
    expect(toast).toHaveBeenCalledWith('Сохранено', 'success');
  });

  test('toastBySyncResult shows fallback info message for local_fallback', () => {
    const status = toastBySyncResult(SYNC_STATUS.LOCAL_FALLBACK, 'Сохранено', 'Локально');
    expect(status).toBe('fallback');
    expect(toast).toHaveBeenCalledWith('Локально', 'info');
  });

  test('toastBySyncResult uses default fallback message when not provided', () => {
    const status = toastBySyncResult(SYNC_STATUS.LOCAL_FALLBACK, 'Сохранено');
    expect(status).toBe('fallback');
    expect(toast).toHaveBeenCalledWith(DEFAULT_FALLBACK_MESSAGE, 'info');
  });

  test.each([
    [SYNC_STATUS.LOCAL, 'Сохранено локально', 'success'],
    [SYNC_STATUS.REMOTE, 'Сохранено удалённо', 'success'],
  ])('toastBySyncResult success matrix for %s', (mode, successMessage, type) => {
    const status = toastBySyncResult(mode, successMessage, 'fallback');
    expect(status).toBe('success');
    expect(toast).toHaveBeenCalledWith(successMessage, type);
  });

  test('toastBySyncResult uses default success message when not provided', () => {
    const status = toastBySyncResult(SYNC_STATUS.REMOTE);
    expect(status).toBe('success');
    expect(toast).toHaveBeenCalledWith(DEFAULT_SUCCESS_MESSAGE, 'success');
  });

  test('toastBySyncResult treats empty success/fallback messages as defaults', () => {
    const fallbackStatus = toastBySyncResult(SYNC_STATUS.LOCAL_FALLBACK, '', '');
    expect(fallbackStatus).toBe('fallback');
    expect(toast).toHaveBeenLastCalledWith(DEFAULT_FALLBACK_MESSAGE, 'info');

    const successStatus = toastBySyncResult(SYNC_STATUS.LOCAL, '', '');
    expect(successStatus).toBe('success');
    expect(toast).toHaveBeenLastCalledWith(DEFAULT_SUCCESS_MESSAGE, 'success');
  });
});
