import React, { useId } from 'react';
import styles from './Toggle.module.css';

export type ToggleSize = 'sm' | 'md';

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
  description?: string;
  id?: string;
  size?: ToggleSize;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
}

export const Toggle: React.FC<ToggleProps> = ({
  checked,
  onChange,
  disabled = false,
  label,
  description,
  id: providedId,
  size = 'md',
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
}) => {
  const fallbackId = useId();
  const id = providedId || fallbackId;

  const handleClick = () => {
    if (!disabled) {
      onChange(!checked);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (!disabled && (event.key === ' ' || event.key === 'Enter')) {
      event.preventDefault();
      onChange(!checked);
    }
  };

  // Row variant when label is provided
  if (label) {
    return (
      <div className={styles.toggleRow}>
        <div className={styles.toggleLabels}>
          <label htmlFor={id} className={styles.toggleLabel}>
            {label}
          </label>
          {description && (
            <div className={styles.toggleDescription}>
              {description}
            </div>
          )}
        </div>
        <div
          className={`${styles.toggle} ${styles[`toggle--${size}`]} ${disabled ? styles['toggle--disabled'] : ''}`}
          role="switch"
          aria-checked={checked}
          aria-disabled={disabled || undefined}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy ?? id}
          aria-describedby={ariaDescribedBy}
          tabIndex={disabled ? -1 : 0}
          onClick={handleClick}
          onKeyDown={handleKeyDown}
        >
          <div className={`${styles.toggleTrack} ${checked ? styles['toggleTrack--checked'] : ''}`}>
            <div className={`${styles.toggleThumb} ${checked ? styles['toggleThumb--checked'] : ''}`} />
          </div>
        </div>
      </div>
    );
  }

  // Standalone variant
  return (
    <div
      id={id}
      className={`${styles.toggle} ${styles[`toggle--${size}`]} ${disabled ? styles['toggle--disabled'] : ''}`}
      role="switch"
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
      tabIndex={disabled ? -1 : 0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <div className={`${styles.toggleTrack} ${checked ? styles['toggleTrack--checked'] : ''}`}>
        <div className={`${styles.toggleThumb} ${checked ? styles['toggleThumb--checked'] : ''}`} />
      </div>
    </div>
  );
};

export { Toggle as default };
