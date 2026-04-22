import React from 'react';
import styles from './Card.module.css';

export type CardPadding = 'sm' | 'md' | 'lg';

export interface CardProps {
  children: React.ReactNode;
  accent?: boolean;
  padding?: CardPadding;
  className?: string;
  onClick?: () => void;
}

export const Card: React.FC<CardProps> = ({
  children,
  accent = false,
  padding = 'md',
  className = '',
  onClick
}) => {
  const isClickable = typeof onClick === 'function';

  const cardClasses = [
    styles.card,
    styles[`card--padding-${padding}`],
    accent && styles['card--accent'],
    isClickable && styles['card--clickable'],
    className
  ].filter(Boolean).join(' ');

  const CardElement = isClickable ? 'button' : 'div';

  return (
    <CardElement
      className={cardClasses}
      onClick={onClick}
      type={isClickable ? 'button' : undefined}
    >
      {children}
    </CardElement>
  );
};

export { Card as default };