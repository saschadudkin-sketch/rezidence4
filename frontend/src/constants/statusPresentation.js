export const VALIDATION_REASON_LABEL = {
  expired: 'Срок пропуска истёк',
  blacklisted: 'Пользователь в чёрном списке',
  not_found: 'Пропуск не найден',
  manual_reject: 'Ручной отказ охраной',
  cancelled: 'Пропуск отменён жильцом',
  error: 'Ошибка проверки',
  ok: 'Проверка пройдена',
};

export const REQUEST_STATUS_TONE = {
  pending: 'pending',
  approved: 'approved',
  rejected: 'rejected',
  accepted: 'accepted',
  arrived: 'arrived',
  scheduled: 'pending',
  cancelled: 'rejected',
  expired: 'expired',
};

export const getValidationReasonLabel = (reason) =>
  VALIDATION_REASON_LABEL[reason] || (reason ? String(reason) : null);

export const getStatusToneClass = (status, validationStatus) => {
  if (validationStatus === 'denied') return 'rejected';
  return REQUEST_STATUS_TONE[status] || 'pending';
};
