import type { RequestStatus } from '../store/slices/requestsSlice';

export const VALIDATION_REASON_LABEL = {
  expired: 'Срок пропуска истёк',
  blacklisted: 'Пользователь в чёрном списке',
  not_found: 'Пропуск не найден',
  manual_reject: 'Ручной отказ охраной',
  cancelled: 'Пропуск отменён жильцом',
  error: 'Ошибка проверки',
  ok: 'Проверка пройдена',
} as const;

export const REQUEST_STATUS_TONE = {
  pending: 'pending',
  approved: 'approved',
  rejected: 'rejected',
  accepted: 'accepted',
  arrived: 'arrived',
  scheduled: 'pending',
  cancelled: 'rejected',
  expired: 'expired',
} as const;

type ValidationReason = keyof typeof VALIDATION_REASON_LABEL;
type ValidationStatus = 'denied' | 'ok' | null | undefined;

export const getValidationReasonLabel = (reason?: ValidationReason | string | null) =>
  (reason && reason in VALIDATION_REASON_LABEL
    ? VALIDATION_REASON_LABEL[reason as ValidationReason]
    : (reason ? String(reason) : null));

export const getStatusToneClass = (status: RequestStatus, validationStatus?: ValidationStatus) => {
  if (validationStatus === 'denied') return 'rejected';
  return REQUEST_STATUS_TONE[status] || 'pending';
};
