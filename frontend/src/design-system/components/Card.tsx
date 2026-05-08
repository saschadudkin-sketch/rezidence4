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
      transition: 'background var(--transition-base), border-color var(--transition-base), box-shadow var(--transition-base), transform var(--transition-base)',
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
        background: 'color-mix(in srgb, var(--color-bg-surface) 90%, var(--color-accent-gold) 10%)',
        border: '1px solid color-mix(in srgb, var(--color-accent-gold) 45%, var(--color-border))',
        boxShadow: '0 0 0 1px color-mix(in srgb, var(--color-accent-gold) 10%, transparent)',
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
