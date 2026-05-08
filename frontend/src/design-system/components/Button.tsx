/**
 * Button Component - DomHub v2.0 Design System
 * Premium button component with variants, sizes, and states
 */

import { forwardRef, ButtonHTMLAttributes, ReactNode } from 'react';
import { Spinner } from './Spinner';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  children: ReactNode;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({
    variant = 'primary',
    size = 'md',
    loading = false,
    disabled = false,
    children,
    leftIcon,
    rightIcon,
    className = '',
    style,
    ...rest
  }, ref) => {
    const baseStyles = {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 'var(--space-2)',
      fontFamily: 'var(--font-sans)',
      fontWeight: 'var(--font-medium)',
      letterSpacing: 'var(--tracking-normal)',
      borderRadius: 'var(--radius-md)',
      border: 'none',
      cursor: disabled || loading ? 'not-allowed' : 'pointer',
      transition: 'background var(--transition-base), border-color var(--transition-base), box-shadow var(--transition-base), color var(--transition-base), transform var(--transition-fast)',
      textDecoration: 'none',
      userSelect: 'none' as const,
      outline: 'none',
      position: 'relative' as const,
    };

    // Size styles
    const sizeStyles = {
      sm: {
        height: '32px',
        padding: '0 var(--space-3)',
        fontSize: 'var(--text-sm)',
        lineHeight: 'var(--leading-tight)',
      },
      md: {
        height: '40px',
        padding: '0 var(--space-4)',
        fontSize: 'var(--text-base)',
        lineHeight: 'var(--leading-normal)',
      },
      lg: {
        height: '48px',
        padding: '0 var(--space-6)',
        fontSize: 'var(--text-lg)',
        lineHeight: 'var(--leading-normal)',
      },
    };

    // Variant styles
    const variantStyles = {
      primary: {
        background: 'var(--color-accent-gold)',
        color: 'var(--color-text-inverse)',
        '--hover-bg': 'var(--color-accent-gold-hover)',
        '--active-bg': '#B89153',
      },
      secondary: {
        background: 'var(--color-bg-surface)',
        color: 'var(--color-text-primary)',
        border: '1px solid var(--color-border)',
        '--hover-bg': 'var(--color-bg-elevated)',
        '--active-bg': 'var(--color-bg-overlay)',
      },
      ghost: {
        background: 'transparent',
        color: 'var(--color-text-secondary)',
        '--hover-bg': 'var(--color-bg-surface)',
        '--active-bg': 'var(--color-bg-elevated)',
      },
      danger: {
        background: 'var(--color-error)',
        color: 'var(--color-text-inverse)',
        '--hover-bg': '#E85353',
        '--active-bg': '#DC2626',
      },
    };

    const disabledStyles = {
      opacity: 0.5,
      cursor: 'not-allowed',
      pointerEvents: 'none' as const,
    };

    const combinedStyles = {
      ...baseStyles,
      ...sizeStyles[size],
      ...variantStyles[variant],
      ...(disabled || loading ? disabledStyles : {}),
      ...style,
    };

    const hoverStyles = !disabled && !loading ? {
      ':hover': {
        background: `var(--hover-bg, ${variantStyles[variant].background})`,
        transform: 'translateY(-1px)',
        boxShadow: 'var(--shadow-md)',
      },
      ':active': {
        background: `var(--active-bg, ${variantStyles[variant].background})`,
        transform: 'scale(0.97)',
      },
      ':focus-visible': {
        outline: '2px solid var(--color-accent-gold)',
        outlineOffset: '2px',
      },
    } : {};

    return (
      <button
        ref={ref}
        style={combinedStyles}
        className={`btn btn-${variant} btn-${size} ${className}`}
        disabled={disabled || loading}
        aria-disabled={disabled || loading}
        {...rest}
        onMouseEnter={(e) => {
          if (!disabled && !loading) {
            Object.assign(e.currentTarget.style, hoverStyles[':hover']);
          }
          rest.onMouseEnter?.(e);
        }}
        onMouseLeave={(e) => {
          if (!disabled && !loading) {
            e.currentTarget.style.background = variantStyles[variant].background;
            e.currentTarget.style.transform = '';
            e.currentTarget.style.boxShadow = '';
          }
          rest.onMouseLeave?.(e);
        }}
        onMouseDown={(e) => {
          if (!disabled && !loading) {
            Object.assign(e.currentTarget.style, hoverStyles[':active']);
          }
          rest.onMouseDown?.(e);
        }}
        onMouseUp={(e) => {
          if (!disabled && !loading) {
            Object.assign(e.currentTarget.style, hoverStyles[':hover']);
          }
          rest.onMouseUp?.(e);
        }}
        onFocus={(e) => {
          if (!disabled && !loading) {
            Object.assign(e.currentTarget.style, hoverStyles[':focus-visible']);
          }
          rest.onFocus?.(e);
        }}
        onBlur={(e) => {
          e.currentTarget.style.outline = '';
          e.currentTarget.style.outlineOffset = '';
          rest.onBlur?.(e);
        }}
      >
        {loading ? (
          <Spinner size={size === 'sm' ? 14 : size === 'md' ? 16 : 18} />
        ) : (
          leftIcon
        )}
        {children}
        {!loading && rightIcon}
      </button>
    );
  }
);

Button.displayName = 'Button';
