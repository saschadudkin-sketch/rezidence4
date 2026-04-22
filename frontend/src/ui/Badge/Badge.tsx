import React from 'react';
import styles from './Badge.module.css';

export type BadgeVariant =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'completed'
  | 'cancelled'
  | 'overdue'
  | 'paid'
  | 'info'
  | 'warning';

export type BadgeSize = 'sm' | 'md';

export interface BadgeProps {
  variant: BadgeVariant;
  children: React.ReactNode;
  size?: BadgeSize;
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  variant,
  children,
  size = 'md',
  className = ''
}) => {
  const badgeClasses = [
    styles.badge,
    styles[`badge--${variant}`],
    styles[`badge--${size}`],
    className
  ].filter(Boolean).join(' ');

  return (
    <span className={badgeClasses}>
      {children}
    </span>
  );
};

export { Badge as default };