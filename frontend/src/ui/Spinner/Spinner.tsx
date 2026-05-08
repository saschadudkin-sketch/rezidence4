import React from 'react';
import styles from './Spinner.module.css';

export type SpinnerSize = 'sm' | 'md' | 'lg';
export type SpinnerVariant = 'primary' | 'secondary' | 'inverse';

export interface SpinnerProps {
  size?: SpinnerSize;
  variant?: SpinnerVariant;
  className?: string;
}

export const Spinner: React.FC<SpinnerProps> = ({
  size = 'md',
  variant = 'primary',
  className = ''
}) => {
  const spinnerClasses = [
    styles.spinner,
    styles[`spinner--${size}`],
    styles[`spinner--${variant}`],
    className
  ].filter(Boolean).join(' ');

  return (
    <div
      className={spinnerClasses}
      role="status" aria-live="polite"
      aria-label="Загрузка"
    >
      <span className={styles.visuallyHidden}>Загрузка...</span>
    </div>
  );
};

export { Spinner as default };
