import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function useModalAccessibility({ onClose, closeOnEsc = true, restoreFocus = true }:{ onClose: () => void; closeOnEsc?: boolean; restoreFocus?: boolean }) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    prevFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusFirst = () => {
      const root = dialogRef.current;
      if (!root) return;
      const first = root.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (first || root).focus();
    };

    const t = window.setTimeout(focusFirst, 0);

    const onKeyDown = (e: KeyboardEvent) => {
      const root = dialogRef.current;
      if (!root) return;

      if (closeOnEsc && e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key !== 'Tab') return;
      const focusables = Array.from<HTMLElement>(root.querySelectorAll(FOCUSABLE_SELECTOR));
      if (focusables.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('keydown', onKeyDown);
      if (restoreFocus) prevFocusRef.current?.focus();
    };
  }, [onClose, closeOnEsc, restoreFocus]);

  const overlayProps = {
    onClick: (e) => {
      if (e.target === e.currentTarget) onClose();
    },
  };

  return { dialogRef, overlayProps };
}
