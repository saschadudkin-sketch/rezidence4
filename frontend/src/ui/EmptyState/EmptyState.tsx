import React from 'react';
import styles from './EmptyState.module.css';
import { Button } from '../Button/Button';

export interface EmptyStateProps {
  title: string;
  subtitle?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  icon?: React.ReactNode;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  subtitle,
  action,
  icon,
  className = ''
}) => {
  const emptyStateClasses = [
    styles.emptyState,
    className
  ].filter(Boolean).join(' ');

  return (
    <div className={emptyStateClasses}>
      {icon && (
        <div className={styles.icon}>
          {icon}
        </div>
      )}

      <h3 className={styles.title}>
        {title}
      </h3>

      {subtitle && (
        <p className={styles.subtitle}>
          {subtitle}
        </p>
      )}

      {action && (
        <div className={styles.action}>
          <Button
            variant="ghost"
            onClick={action.onClick}
          >
            {action.label}
          </Button>
        </div>
      )}
    </div>
  );
};

export { EmptyState as default };