import type { RequestStatus } from '../store/slices/requestsSlice';

export const VALIDATION_REASON_LABEL = {
  expired: 'РЎСЂРѕРє РїСЂРѕРїСѓСЃРєР° РёСЃС‚С‘Рє',
  blacklisted: 'РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ РІ С‡С‘СЂРЅРѕРј СЃРїРёСЃРєРµ',
  not_found: 'РџСЂРѕРїСѓСЃРє РЅРµ РЅР°Р№РґРµРЅ',
  manual_reject: 'Р СѓС‡РЅРѕР№ РѕС‚РєР°Р· РѕС…СЂР°РЅРѕР№',
  cancelled: 'РџСЂРѕРїСѓСЃРє РѕС‚РјРµРЅС‘РЅ Р¶РёР»СЊС†РѕРј',
  error: 'РћС€РёР±РєР° РїСЂРѕРІРµСЂРєРё',
  ok: 'РџСЂРѕРІРµСЂРєР° РїСЂРѕР№РґРµРЅР°',
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
