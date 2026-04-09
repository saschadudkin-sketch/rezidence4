import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusWithoutScroll(target: HTMLElement | null) {
  if (!target) return;
  try {
    target.focus({ preventScroll: true });
  } catch {
    target.focus();
  }
}

export function useModalAccessibility({ onClose, closeOnEsc = true, restoreFocus = true }:{ onClose: () => void; closeOnEsc?: boolean; restoreFocus?: boolean }) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    prevFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusFirst = () => {
      const root = dialogRef.current;
      if (!root) return;
      const first = root.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      focusWithoutScroll(first || root);
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
        focusWithoutScroll(root);
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (e.shiftKey && active === first) {
        e.preventDefault();
        focusWithoutScroll(last);
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        focusWithoutScroll(first);
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('keydown', onKeyDown);
      if (restoreFocus) focusWithoutScroll(prevFocusRef.current);
    };
  }, [onClose, closeOnEsc, restoreFocus]);

  const overlayProps = {
    onClick: (e) => {
      if (e.target === e.currentTarget) onClose();
    },
  };

  return { dialogRef, overlayProps };
}
