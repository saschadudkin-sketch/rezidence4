import { useState } from 'react';
import { AppIcon } from './AppIcon';

type SecondaryAction = {
  label: string;
  onClick: () => void;
};

type PageActionBarProps = {
  primaryLabel: string;
  onPrimary: () => void;
  secondary?: SecondaryAction[];
  className?: string;
};

export default function PageActionBar({ primaryLabel, onPrimary, secondary = [], className = '' }: PageActionBarProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className={`page-action-bar ${className}`.trim()}>
      {secondary.length > 0 && (
        <div className="page-action-overflow">
          <button
            className="btn-outline page-action-overflow-btn"
            onClick={() => setOpen(v => !v)}
            aria-expanded={open}
            aria-haspopup="menu"
          >
            <span className="u-inline-icon"><AppIcon name="list" size={14} /> Ещё</span>
          </button>
          {open && (
            <div className="page-action-overflow-menu" role="menu">
              {secondary.map((action) => (
                <button
                  key={action.label}
                  className="page-action-overflow-item"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    action.onClick();
                  }}
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <button className="btn-gold page-action-primary" onClick={onPrimary}>
        <span>{primaryLabel}</span>
      </button>
    </div>
  );
}
