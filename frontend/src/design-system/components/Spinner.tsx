/**
 * Spinner Component - DomHub v2.0 Design System
 * Loading spinner with smooth rotation animation
 */

import { CSSProperties } from 'react';

export interface SpinnerProps {
  size?: number;
  color?: string;
  thickness?: number;
  className?: string;
}

export function Spinner({
  size = 16,
  color = 'var(--color-accent-gold)',
  thickness = 2,
  className = ''
}: SpinnerProps) {
  const styles: CSSProperties = {
    width: size,
    height: size,
    border: `${thickness}px solid transparent`,
    borderTop: `${thickness}px solid ${color}`,
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    display: 'inline-block',
  };

  return (
    <div
      className={`spinner ${className}`}
      style={styles}
      role="status"
      aria-label="Loading"
    >
      <span className="sr-only">Loading...</span>
    </div>
  );
}