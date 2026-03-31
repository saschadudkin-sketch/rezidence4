/**
 * requestPredicates.js — именованные предикаты для заявок.
 *
 * Заменяют длинные inline-условия вида:
 *   req.status === 'rejected' || req.status === 'accepted' || req.status === 'arrived'
 * на читаемые:
 *   isCompletedRequest(req)
 */

import { canManageRequests, canApproveRequests, isResident as isResidentRole } from '../domain/permissions.js';

// ─── Статусы ─────────────────────────────────────────────────────────────────

/** Заявка ещё активна (можно одобрить/отклонить) */
export const isActiveRequest = (req) =>
  req.status === 'pending' || req.status === 'approved';

// FIX [PERF]: Set.has() O(1) вместо Array.includes() O(n) — вызывается при каждом рендере карточки
const COMPLETED_STATUSES = new Set(['rejected', 'accepted', 'arrived', 'expired', 'cancelled']);

/** Заявка завершена (можно повторить) */
export const isCompletedRequest = (req) => COMPLETED_STATUSES.has(req.status);

/** Заявка ожидает решения */
export const isPendingRequest = (req) => req.status === 'pending';

/** Заявка одобрена, посетитель ещё не вошёл */
export const isApprovedRequest = (req) => req.status === 'approved';

/** Заявка запланирована на будущее */
export const isScheduledRequest = (req) => req.status === 'scheduled';

// ─── Роли (реэкспорт из domain/permissions) ──────────────────────────────────
export { canManageRequests, canApproveRequests, isResidentRole };

// ─── Типы заявок ─────────────────────────────────────────────────────────────

/** Пропуск для посетителя */
export const isPassRequest = (req) => req.type === 'pass';

/** Заявка в техслужбу */
export const isTechRequest = (req) => req.type === 'tech';

// ─── Видимость кнопок действий ───────────────────────────────────────────────

/**
 * Показывать ли блок действий в карточке заявки
 * (кнопки охраны / повтор / редактирование)
 */
export const shouldShowActions = (req, { userRole, onRepeat, onEdit, onDelete, onCancel }) =>
  canManageRequests(userRole)
  || (onRepeat && isCompletedRequest(req))
  || ((onEdit || onDelete) && isPendingRequest(req))
  || (onCancel && (req.status === 'pending' || req.status === 'approved'));
