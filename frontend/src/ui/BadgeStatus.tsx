/**
 * BadgeStatus.jsx — A-06: Visual language kit.
 * Semantic status and role badge component.
 * Unifies .badge (status) and .admin-badge (role) into one component.
 *
 * Usage:
 *   <BadgeStatus status="pending" />          → pending badge
 *   <BadgeStatus status="approved" />         → approved badge
 *   <BadgeStatus role="owner" />              → role badge
 *   <BadgeStatus status="pending" size="sm" /> → smaller badge
 */
import { memo } from 'react';
import { ROLE_LABELS, STS_LABEL } from '../constants';
import type { UserRole } from '../store/slices/usersSlice';
import type { RequestStatus } from '../store/slices/requestsSlice';

type BadgeStatusProps = {
  status?: RequestStatus | string | null;
  role?: UserRole | string | null;
  label?: string;
  size?: 'sm' | 'md';
};

function hasOwnLabel<TLabels extends Record<string, string>>(
  labels: TLabels,
  value: string,
): value is Extract<keyof TLabels, string> {
  return value in labels;
}

const BadgeStatus = memo(function BadgeStatus({ status, role, label, size = 'md' }: BadgeStatusProps) {
  if (role) {
    const text = label ?? (hasOwnLabel(ROLE_LABELS, role) ? ROLE_LABELS[role] : role);
    return (
      <span className={`admin-badge ${role}${size === 'sm' ? ' badge-sm' : ''}`}>
        {text}
      </span>
    );
  }
  if (status) {
    const text = label ?? (hasOwnLabel(STS_LABEL, status) ? STS_LABEL[status] : status);
    return (
      <span className={`badge ${status}${size === 'sm' ? ' badge-sm' : ''}`}>
        {text}
      </span>
    );
  }
  return null;
});

export default BadgeStatus;
