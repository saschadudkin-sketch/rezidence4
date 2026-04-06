import { useEffect, useRef } from 'react';

/**
 * ConfirmDialog — WCAG-compliant confirm dialog.
 *
 * Implements:
 *   - Focus trap: keeps keyboard focus inside dialog
 *   - Escape key: calls onCancel
 *   - Focus restore: returns focus to trigger element on close
 *   - aria-modal + role="dialog" + aria-labelledby
 */
export function ConfirmDialog({ message, confirmLabel, cancelLabel = 'Отмена', onConfirm, onCancel }) {
  const panelRef       = useRef(null);
  const prevFocusRef   = useRef(null);
  const confirmBtnRef  = useRef(null);

  // Save current focus, move focus into dialog on mount, restore on unmount
  useEffect(() => {
    prevFocusRef.current = document.activeElement;
    // Defer to next tick so the DOM is painted
    const raf = requestAnimationFrame(() => {
      confirmBtnRef.current?.focus();
    });
    return () => {
      cancelAnimationFrame(raf);
      prevFocusRef.current?.focus();
    };
  }, []);

  // Focus trap
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusable = Array.from<HTMLElement>(
        panel.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
      ).filter(el => !(el as HTMLButtonElement).disabled);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last  = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last)  { e.preventDefault(); first.focus(); }
      }
    };
    panel.addEventListener('keydown', handleKeyDown);
    return () => panel.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  return (
    <div className="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="confirm-msg">
      <div className="confirm-panel" ref={panelRef}>
        <p className="confirm-msg" id="confirm-msg">{message}</p>
        <div className="confirm-actions">
          <button className="btn-outline" onClick={onCancel}>{cancelLabel}</button>
          <button className="btn-danger" onClick={onConfirm} ref={confirmBtnRef}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
