/**
 * Card Component - DomHub v2.0 Design System
 * Surface container with variants and padding options
 */

import { forwardRef, HTMLAttributes, ReactNode } from 'react';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'elevated' | 'outlined' | 'accent';
  padding?: 'none' | 'sm' | 'md' | 'lg';
  children: ReactNode;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({
    variant = 'default',
    padding = 'md',
    children,
    className = '',
    style,
    ...rest
  }, ref) => {
    const baseStyles = {
      borderRadius: 'var(--radius-lg)',
      transition: 'all var(--transition-base)',
      position: 'relative' as const,
    };

    // Padding styles
    const paddingStyles = {
      none: { padding: '0' },
      sm: { padding: 'var(--space-3)' },
      md: { padding: 'var(--space-4)' },
      lg: { padding: 'var(--space-6)' },
    };

    // Variant styles
    const variantStyles = {
      default: {
        background: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border)',
      },
      elevated: {
        background: 'var(--color-bg-elevated)',
        boxShadow: 'var(--shadow-md)',
        border: 'none',
      },
      outlined: {
        background: 'transparent',
        border: '1px solid var(--color-border-strong)',
      },
      accent: {
        background: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border)',
        borderLeft: '4px solid var(--color-accent-gold)',
      },
    };

    const combinedStyles = {
      ...baseStyles,
      ...paddingStyles[padding],
      ...variantStyles[variant],
      ...style,
    };

    return (
      <div
        ref={ref}
        className={`card card-${variant} ${className}`}
        style={combinedStyles}
        {...rest}
      >
        {children}
      </div>
    );
  }
);

Card.displayName = 'Card';