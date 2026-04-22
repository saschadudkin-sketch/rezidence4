/**
 * Input Component - DomHub v2.0 Design System
 * Form input with label, error states, and optional clear button
 */

import { forwardRef, InputHTMLAttributes, ReactNode, useState } from 'react';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helper?: string;
  showClear?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  variant?: 'default' | 'ghost';
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({
    label,
    error,
    helper,
    showClear = false,
    leftIcon,
    rightIcon,
    variant = 'default',
    className = '',
    style,
    value,
    onChange,
    onClear,
    ...rest
  }, ref) => {
    const [internalValue, setInternalValue] = useState(value || '');
    const currentValue = value !== undefined ? value : internalValue;
    const hasValue = String(currentValue).length > 0;

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (value === undefined) {
        setInternalValue(e.target.value);
      }
      onChange?.(e);
    };

    const handleClear = () => {
      const syntheticEvent = {
        target: { value: '' },
      } as React.ChangeEvent<HTMLInputElement>;

      if (value === undefined) {
        setInternalValue('');
      }
      onChange?.(syntheticEvent);
      onClear?.();
    };

    const baseStyles = {
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--text-base)',
      lineHeight: 'var(--leading-normal)',
      padding: leftIcon || rightIcon || (showClear && hasValue)
        ? '12px 40px 12px 12px'
        : '12px var(--space-4)',
      borderRadius: 'var(--radius-md)',
      border: error
        ? '1px solid var(--color-error)'
        : '1px solid var(--color-border)',
      background: variant === 'ghost' ? 'transparent' : 'var(--color-bg-surface)',
      color: 'var(--color-text-primary)',
      width: '100%',
      transition: 'all var(--transition-base)',
      outline: 'none',
    };

    const focusStyles = {
      borderColor: error ? 'var(--color-error)' : 'var(--color-accent-gold)',
      boxShadow: error
        ? '0 0 0 3px var(--color-error-muted)'
        : '0 0 0 3px var(--color-accent-gold-muted)',
    };

    const containerStyles = {
      position: 'relative' as const,
      width: '100%',
    };

    const labelStyles = {
      display: 'block',
      fontSize: 'var(--text-sm)',
      fontWeight: 'var(--font-medium)',
      color: 'var(--color-text-secondary)',
      marginBottom: 'var(--space-2)',
    };

    const errorStyles = {
      fontSize: 'var(--text-sm)',
      color: 'var(--color-error)',
      marginTop: 'var(--space-1)',
    };

    const helperStyles = {
      fontSize: 'var(--text-sm)',
      color: 'var(--color-text-muted)',
      marginTop: 'var(--space-1)',
    };

    const iconStyles = {
      position: 'absolute' as const,
      top: '50%',
      transform: 'translateY(-50%)',
      pointerEvents: 'none' as const,
      color: 'var(--color-text-muted)',
    };

    const leftIconStyles = {
      ...iconStyles,
      left: 'var(--space-3)',
    };

    const clearButtonStyles = {
      position: 'absolute' as const,
      right: 'var(--space-3)',
      top: '50%',
      transform: 'translateY(-50%)',
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      padding: 'var(--space-1)',
      borderRadius: 'var(--radius-sm)',
      color: 'var(--color-text-muted)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      transition: 'color var(--transition-fast)',
    };

    return (
      <div style={containerStyles}>
        {label && (
          <label style={labelStyles} htmlFor={rest.id}>
            {label}
          </label>
        )}
        <div style={{ position: 'relative' }}>
          {leftIcon && (
            <div style={leftIconStyles}>
              {leftIcon}
            </div>
          )}
          <input
            ref={ref}
            style={{
              ...baseStyles,
              ...(leftIcon ? { paddingLeft: '40px' } : {}),
              ...(rightIcon || (showClear && hasValue) ? { paddingRight: '40px' } : {}),
              ...style,
            }}
            className={`input input-${variant} ${error ? 'input-error' : ''} ${className}`}
            value={currentValue}
            onChange={handleChange}
            onFocus={(e) => {
              Object.assign(e.target.style, focusStyles);
              rest.onFocus?.(e);
            }}
            onBlur={(e) => {
              e.target.style.borderColor = error ? 'var(--color-error)' : 'var(--color-border)';
              e.target.style.boxShadow = '';
              rest.onBlur?.(e);
            }}
            {...rest}
          />
          {rightIcon && !showClear && (
            <div style={{ ...iconStyles, right: 'var(--space-3)' }}>
              {rightIcon}
            </div>
          )}
          {showClear && hasValue && (
            <button
              type="button"
              style={clearButtonStyles}
              onClick={handleClear}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--color-text-secondary)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--color-text-muted)';
              }}
              aria-label="Clear input"
            >
              ×
            </button>
          )}
        </div>
        {error && <div style={errorStyles}>{error}</div>}
        {helper && !error && <div style={helperStyles}>{helper}</div>}
      </div>
    );
  }
);

Input.displayName = 'Input';