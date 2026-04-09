import { useEffect, useRef, useState } from 'react';
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
  const overflowRef = useRef<HTMLDivElement | null>(null);
  const directSecondary = secondary.length === 1 ? secondary[0] : null;
  const overflowActions = directSecondary ? [] : secondary;

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent | TouchEvent) {
      const target = event.target;
      if (overflowRef.current && target instanceof Node && !overflowRef.current.contains(target)) {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, [open]);

  return (
    <div className={`page-action-bar ${className}`.trim()}>
      {directSecondary && (
        <button
          type="button"
          className="btn-outline page-action-overflow-btn"
          onClick={() => {
            setOpen(false);
            directSecondary.onClick();
          }}
        >
          <span>{directSecondary.label}</span>
        </button>
      )}
      {overflowActions.length > 0 && (
        <div className="page-action-overflow" ref={overflowRef}>
          <button
            type="button"
            className="btn-outline page-action-overflow-btn"
            onClick={() => setOpen(v => !v)}
            aria-expanded={open}
            aria-haspopup="menu"
          >
            <span className="u-inline-icon"><AppIcon name="dots" size={14} /> Ещё</span>
          </button>
          {open && (
            <div className="page-action-overflow-menu" role="menu">
              {overflowActions.map((action) => (
                <button
                  key={action.label}
                  type="button"
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
      <button type="button" className="btn-gold page-action-primary" onClick={() => { setOpen(false); onPrimary(); }}>
        <span>{primaryLabel}</span>
      </button>
    </div>
  );
}
