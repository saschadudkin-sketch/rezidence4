/**
 * EmptyState Component - DomHub v2.0 Design System
 * Centered layout for empty states with illustration, title, and action
 */

import { HTMLAttributes, ReactNode } from 'react';

export interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  compact?: boolean;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
  className = '',
  style,
  children,
  ...rest
}: EmptyStateProps) {
  const containerStyles = {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center' as const,
    padding: compact ? 'var(--space-8) var(--space-4)' : 'var(--space-12) var(--space-6)',
    minHeight: compact ? 'auto' : '240px',
  };

  const iconStyles = {
    width: compact ? '48px' : '64px',
    height: compact ? '48px' : '64px',
    marginBottom: 'var(--space-4)',
    color: 'var(--color-text-muted)',
    opacity: 0.6,
  };

  const titleStyles = {
    fontSize: compact ? 'var(--text-lg)' : 'var(--text-xl)',
    fontWeight: 'var(--font-semibold)',
    color: 'var(--color-text-primary)',
    marginBottom: description ? 'var(--space-2)' : 'var(--space-4)',
    letterSpacing: 'var(--tracking-tight)',
  };

  const descriptionStyles = {
    fontSize: 'var(--text-base)',
    color: 'var(--color-text-secondary)',
    lineHeight: 'var(--leading-relaxed)',
    maxWidth: '400px',
    marginBottom: action ? 'var(--space-6)' : '0',
  };

  // Default icon if none provided
  const defaultIcon = (
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19V5C21 3.9 20.1 3 19 3ZM19 19H5V5H19V19Z"
        fill="currentColor"
        opacity="0.3"
      />
      <circle
        cx="12"
        cy="12"
        r="3"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
      />
    </svg>
  );

  return (
    <div
      className={`empty-state ${compact ? 'empty-state-compact' : ''} ${className}`}
      style={{
        ...containerStyles,
        ...style,
      }}
      {...rest}
    >
      <div style={iconStyles}>
        {icon || defaultIcon}
      </div>

      <h3 style={titleStyles}>
        {title}
      </h3>

      {description && (
        <p style={descriptionStyles}>
          {description}
        </p>
      )}

      {action && (
        <div>
          {action}
        </div>
      )}

      {children}
    </div>
  );
}