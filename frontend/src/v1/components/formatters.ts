/**
 * Shared user-facing formatters for the v1 UI.
 *
 * Keep strings Russian — DomHub onboarding language; backend enum values
 * stay canonical English.
 *
 * IMPORTANT: enum keys MUST mirror backend exactly.  The backend emits
 * `guest_access`, `pending_approval`, etc. — the form has no appetite for
 * short forms.
 */

import type {
  DenyReason,
  IncidentType,
  PassStatus,
  PassType,
  RequestStatus,
  RequestType,
  Severity,
} from '../api/types';

const REQUEST_TYPE_RU: Record<RequestType, string> = {
  guest_access: 'Гость',
  vehicle_access: 'Авто',
  contractor_access: 'Подрядчик',
  courier_access: 'Курьер',
  service_access: 'Сервис',
  temporary_resident_access: 'Временный резидент',
};

const REQUEST_STATUS_RU: Record<RequestStatus, string> = {
  new: 'Новая',
  pending_approval: 'На согласовании',
  escalated: 'Эскалирована',
  approved: 'Одобрено',
  rejected: 'Отклонено',
  cancelled: 'Отменено',
  expired: 'Истекло',
};

const PASS_STATUS_RU: Record<PassStatus, string> = {
  active: 'Активен',
  used: 'Использован',
  revoked: 'Отозван',
  blocked: 'Заблокирован',
  expired: 'Истёк',
};

const PASS_TYPE_RU: Record<PassType, string> = {
  guest: 'Гость',
  vehicle: 'Авто',
  resident: 'Резидент',
  staff: 'Сотрудник',
  contractor: 'Подрядчик',
  courier: 'Курьер',
  service: 'Сервис',
  emergency: 'Экстренный',
};

const DENY_REASON_RU: Record<DenyReason, string> = {
  invalid_qr: 'Невалидный QR-код',
  invalid_pin: 'Невалидный PIN',
  pin_rate_limited: 'Слишком много PIN-попыток',
  invalid_plate: 'Невалидный номер',
  vehicle_blacklisted: 'Авто в чёрном списке',
  pass_revoked: 'Пропуск отозван',
  pass_blocked: 'Пропуск заблокирован',
  pass_used: 'Пропуск уже использован',
  expired: 'Пропуск истёк',
  outside_time_window: 'Вне окна действия',
  unauthorized_vehicle: 'Авто не авторизовано',
  idempotent_replay: 'Повторный сигнал',
};

const INCIDENT_TYPE_RU: Record<IncidentType, string> = {
  expired_pass_attempt: 'Попытка по истекшему пропуску',
  invalid_qr: 'Невалидный QR',
  invalid_pin: 'Невалидный PIN',
  invalid_plate: 'Невалидный номер',
  blacklist_hit: 'Чёрный список',
  outside_time_window: 'Вне окна',
  unauthorized_vehicle: 'Неавторизованное авто',
  manual_override: 'Ручной обход',
  provider_conflict: 'Конфликт провайдера',
  suspicious_repeat_attempt: 'Подозрительные повторы',
  policy_denied: 'Отказ по политике',
  policy_security_review_required: 'Требуется решение охраны',
};

const SEVERITY_RU: Record<Severity, string> = {
  low: 'Низкая',
  medium: 'Средняя',
  high: 'Высокая',
  critical: 'Критическая',
};

export function formatRequestType(t: RequestType): string {
  return REQUEST_TYPE_RU[t] ?? t;
}

export function formatRequestStatus(s: RequestStatus): string {
  return REQUEST_STATUS_RU[s] ?? s;
}

export function formatPassStatus(s: PassStatus): string {
  return PASS_STATUS_RU[s] ?? s;
}

export function formatPassType(t: PassType): string {
  return PASS_TYPE_RU[t] ?? t;
}

export function formatDenyReason(r: DenyReason | string | undefined): string {
  if (!r) return 'Отказ';
  return (DENY_REASON_RU as Record<string, string>)[r] ?? r;
}

export function formatIncidentType(t: IncidentType): string {
  return INCIDENT_TYPE_RU[t] ?? t;
}

export function formatSeverity(s: Severity): string {
  return SEVERITY_RU[s] ?? s;
}

/** Short datetime — used inside compact cards. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

/** Window shorthand — "дд.мм HH:MM → HH:MM" when same day, else full. */
export function formatWindow(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) {
    return `${start} → ${end}`;
  }
  const sameDay =
    s.getFullYear() === e.getFullYear() &&
    s.getMonth() === e.getMonth() &&
    s.getDate() === e.getDate();
  const dateFmt = new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
  });
  const timeFmt = new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });
  if (sameDay) {
    return `${dateFmt.format(s)} · ${timeFmt.format(s)} → ${timeFmt.format(e)}`;
  }
  return `${dateFmt.format(s)} ${timeFmt.format(s)} → ${dateFmt.format(e)} ${timeFmt.format(e)}`;
}

/** Badge tone for pass/request/incident states — keeps UI consistent across cards. */
export function requestStatusTone(
  s: RequestStatus,
): 'success' | 'error' | 'warning' | 'info' | 'neutral' {
  if (s === 'approved') return 'success';
  if (s === 'rejected' || s === 'cancelled') return 'error';
  if (s === 'pending_approval' || s === 'escalated') return 'warning';
  if (s === 'new') return 'info';
  if (s === 'expired') return 'neutral';
  return 'neutral';
}

export function passStatusTone(
  s: PassStatus,
): 'success' | 'error' | 'warning' | 'info' | 'neutral' {
  if (s === 'active') return 'success';
  if (s === 'revoked' || s === 'blocked') return 'error';
  if (s === 'expired') return 'warning';
  if (s === 'used') return 'info';
  return 'neutral';
}

export function severityTone(
  s: Severity,
): 'success' | 'error' | 'warning' | 'info' | 'neutral' {
  if (s === 'critical' || s === 'high') return 'error';
  if (s === 'medium') return 'warning';
  return 'neutral';
}
