/**
 * Badge Component - DomHub v2.0 Design System
 * Status badges with semantic colors
 */

import { HTMLAttributes, ReactNode } from 'react';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'success' | 'error' | 'warning' | 'info' | 'muted' | 'accent';
  size?: 'sm' | 'md';
  children: ReactNode;
}

export function Badge({
  variant = 'muted',
  size = 'md',
  children,
  className = '',
  style,
  ...rest
}: BadgeProps) {
  const baseStyles = {
    display: 'inline-flex',
    alignItems: 'center',
    fontFamily: 'var(--font-sans)',
    fontWeight: 'var(--font-medium)',
    borderRadius: 'var(--radius-full)',
    letterSpacing: 'var(--tracking-wide)',
    textTransform: 'uppercase' as const,
    whiteSpace: 'nowrap' as const,
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

  // Variant styles
  const variantStyles = {
    success: {
      background: 'var(--color-success-muted)',
      color: 'var(--color-success)',
    },
    error: {
      background: 'var(--color-error-muted)',
      color: 'var(--color-error)',
    },
    warning: {
      background: 'var(--color-warning-muted)',
      color: 'var(--color-warning)',
    },
    info: {
      background: 'rgba(96,165,250,0.15)',
      color: 'var(--color-info)',
    },
    muted: {
      background: 'var(--color-bg-elevated)',
      color: 'var(--color-text-muted)',
    },
    accent: {
      background: 'var(--color-accent-gold-muted)',
      color: 'var(--color-accent-gold)',
    },
  };

  const combinedStyles = {
    ...baseStyles,
    ...sizeStyles[size],
    ...variantStyles[variant],
    ...style,
  };

  return (
    <span
      className={`badge badge-${variant} badge-${size} ${className}`}
      style={combinedStyles}
      {...rest}
    >
      {children}
    </span>
  );
}