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

const BadgeStatus = memo(function BadgeStatus({ status, role, label, size = 'md' }) {
  if (role) {
    const text = label ?? (ROLE_LABELS[role] || role);
    return (
      <span className={`admin-badge ${role}${size === 'sm' ? ' badge-sm' : ''}`}>
        {text}
      </span>
    );
  }
  if (status) {
    const text = label ?? (STS_LABEL?.[status] || status);
    return (
      <span className={`badge ${status}${size === 'sm' ? ' badge-sm' : ''}`}>
        {text}
      </span>
    );
  }
  return null;
});

export default BadgeStatus;
