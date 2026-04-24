/**
 * StatusPill Component - DomHub v2.0 Design System
 * Status indicators for request lifecycle states
 */

import { CSSProperties, HTMLAttributes, ReactNode } from 'react';

export type RequestStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'completed'
  | 'cancelled'
  | 'expired'
  | 'in-progress';

export interface StatusPillProps extends HTMLAttributes<HTMLSpanElement> {
  status: RequestStatus;
  children?: ReactNode;
  size?: 'sm' | 'md';
}

export function StatusPill({
  status,
  children,
  size = 'md',
  className = '',
  style,
  ...rest
}: StatusPillProps) {
  const statusLabels: Record<RequestStatus, string> = {
    pending: 'Ожидает',
    approved: 'Одобрено',
    rejected: 'Отклонено',
    completed: 'Выполнено',
    cancelled: 'Отменено',
    expired: 'Истек',
    'in-progress': 'В работе',
  };

  const baseStyles = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--space-1)',
    fontFamily: 'var(--font-sans)',
    fontWeight: 'var(--font-medium)',
    borderRadius: 'var(--radius-full)',
    letterSpacing: 'var(--tracking-normal)',
    whiteSpace: 'nowrap' as const,
    border: '1px solid',
  };

  // Size styles
  const sizeStyles = {
    sm: {
      padding: '2px var(--space-2)',
      fontSize: 'var(--text-xs)',
      lineHeight: 'var(--leading-tight)',
    },
    md: {
      padding: '4px var(--space-3)',
      fontSize: 'var(--text-sm)',
      lineHeight: 'var(--leading-tight)',
    },
  };

  // Status variant styles
  const statusStyles: Record<RequestStatus, CSSProperties> = {
    pending: {
      backgroundColor: 'rgba(251,191,36,0.1)',
      color: 'var(--color-warning)',
      borderColor: 'rgba(251,191,36,0.3)',
    },
    approved: {
      backgroundColor: 'var(--color-success-muted)',
      color: 'var(--color-success)',
      borderColor: 'rgba(74,222,128,0.3)',
    },
    rejected: {
      backgroundColor: 'var(--color-error-muted)',
      color: 'var(--color-error)',
      borderColor: 'rgba(248,113,113,0.3)',
    },
    completed: {
      backgroundColor: 'var(--color-success-muted)',
      color: 'var(--color-success)',
      borderColor: 'rgba(74,222,128,0.3)',
    },
    cancelled: {
      backgroundColor: 'rgba(156,163,175,0.1)',
      color: '#9CA3AF',
      borderColor: 'rgba(156,163,175,0.3)',
    },
    expired: {
      backgroundColor: 'rgba(156,163,175,0.1)',
      color: '#6B7280',
      borderColor: 'rgba(107,114,128,0.3)',
    },
    'in-progress': {
      backgroundColor: 'rgba(96,165,250,0.1)',
      color: 'var(--color-info)',
      borderColor: 'rgba(96,165,250,0.3)',
    },
  };

  const combinedStyles = {
    ...baseStyles,
    ...sizeStyles[size],
    ...statusStyles[status],
    ...style,
  };

  const displayText = children || statusLabels[status];

  return (
    <span
      className={`status-pill status-${status} status-${size} ${className}`}
      style={combinedStyles}
      role="status"
      aria-label={`Status: ${statusLabels[status]}`}
      {...rest}
    >
      {displayText}
    </span>
  );
}