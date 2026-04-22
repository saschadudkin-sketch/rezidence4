import React, { forwardRef } from 'react';
import styles from './Button.module.css';
import { Spinner } from '../Spinner/Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
  children: React.ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({
    variant = 'primary',
    size = 'md',
    loading = false,
    icon,
    children,
    disabled,
    className = '',
    ...props
  }, ref) => {
    const isDisabled = disabled || loading;

    const buttonClasses = [
      styles.button,
      styles[`button--${variant}`],
      styles[`button--${size}`],
      loading && styles['button--loading'],
      className
    ].filter(Boolean).join(' ');

    return (
      <button
        ref={ref}
        className={buttonClasses}
        disabled={isDisabled}
        aria-busy={loading}
        {...props}
      >
        {loading && (
          <div className={styles.spinner}>
            <Spinner size="sm" variant={variant === 'primary' ? 'inverse' : 'primary'} />
          </div>
        )}
        {icon && !loading && <span className={styles.icon}>{icon}</span>}
        <span className={loading ? styles.hiddenContent : undefined}>
          {children}
        </span>
      </button>
    );
  }
);

Button.displayName = 'Button';

export default Button;