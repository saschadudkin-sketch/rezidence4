/**
 * requestPredicates.js — именованные предикаты для заявок.
 *
 * Заменяют длинные inline-условия вида:
 *   req.status === 'rejected' || req.status === 'accepted' || req.status === 'arrived'
 * на читаемые:
 *   isCompletedRequest(req)
 */

import { canManageRequests, canApproveRequests, isResident as isResidentRole } from '../domain/permissions';
import type { AppRequest } from '../store/slices/requestsSlice';
import type { UserRole } from '../store/slices/usersSlice';

// ─── Статусы ─────────────────────────────────────────────────────────────────

type RequestActionArgs = {
  userRole: UserRole | string;
  onRepeat?: (() => void) | null;
  onEdit?: (() => void) | null;
  onDelete?: (() => void) | null;
  onCancel?: (() => void) | null;
};

/** Заявка ещё активна (можно одобрить/отклонить) */
export const isActiveRequest = (req: AppRequest) =>
  req.status === 'pending' || req.status === 'approved';

// FIX [PERF]: Set.has() O(1) вместо Array.includes() O(n) — вызывается при каждом рендере карточки
const COMPLETED_STATUSES = new Set(['rejected', 'accepted', 'arrived', 'expired', 'cancelled']);

/** Заявка завершена (можно повторить) */
export const isCompletedRequest = (req: AppRequest) => COMPLETED_STATUSES.has(req.status);

/** Заявка ожидает решения */
export const isPendingRequest = (req: AppRequest) => req.status === 'pending';

/** Заявка одобрена, посетитель ещё не вошёл */
export const isApprovedRequest = (req: AppRequest) => req.status === 'approved';

/** Заявка запланирована на будущее */
export const isScheduledRequest = (req: AppRequest) => req.status === 'scheduled';

// ─── Роли (реэкспорт из domain/permissions) ──────────────────────────────────
export { canManageRequests, canApproveRequests, isResidentRole };

// ─── Типы заявок ─────────────────────────────────────────────────────────────

/** Пропуск для посетителя */
export const isPassRequest = (req: AppRequest) => req.type === 'pass';

/** Заявка в техслужбу */
export const isTechRequest = (req: AppRequest) => req.type === 'tech';

// ─── Видимость кнопок действий ───────────────────────────────────────────────

/**
 * Показывать ли блок действий в карточке заявки
 * (кнопки охраны / повтор / редактирование)
 */
export const shouldShowActions = (req: AppRequest, { userRole, onRepeat, onEdit, onDelete, onCancel }: RequestActionArgs) =>
  canManageRequests(userRole)
  || (onRepeat && isCompletedRequest(req))
  || ((onEdit || onDelete) && isPendingRequest(req))
  || (onCancel && (req.status === 'pending' || req.status === 'approved'));
