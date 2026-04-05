import { toast } from './Toasts';
import { SYNC_STATUS } from '../constants/syncStatuses';

export const DEFAULT_FALLBACK_MESSAGE = 'Изменения сохранены локально. Синхронизация будет повторена позже';
export const DEFAULT_SUCCESS_MESSAGE = 'Операция выполнена';

/**
 * Показывает информационный toast, если операция была сохранена локально
 * и удалённая синхронизация отложена.
 */
export function notifyLocalFallback(mode, message) {
  if (mode !== SYNC_STATUS.LOCAL_FALLBACK) return false;
  toast(message || DEFAULT_FALLBACK_MESSAGE, 'info');
  return true;
}

/**
 * Показывает один итоговый toast по результату операции:
 * - success для обычного выполнения
 * - info для local_fallback
 */
export function toastBySyncResult(mode, successMessage, fallbackMessage) {
  if (notifyLocalFallback(mode, fallbackMessage)) return 'fallback';
  toast(successMessage || DEFAULT_SUCCESS_MESSAGE, 'success');
  return 'success';
}
