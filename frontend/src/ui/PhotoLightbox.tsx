import { useEffect, useRef } from 'react';
import type { MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { AppIcon } from './AppIcon';

type PhotoLightboxProps = {
  src: string;
  onClose: () => void;
};

export function PhotoLightbox({ src, onClose }: PhotoLightboxProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<Element | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement;
    closeButtonRef.current?.focus();

    const fn = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;

      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusables = Array.from(
        dialog.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
      ).filter((node) => !node.hasAttribute('disabled'));
      if (focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', fn);
    return () => {
      document.removeEventListener('keydown', fn);
      if (previousFocusRef.current instanceof HTMLElement) previousFocusRef.current.focus();
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Просмотр фото"
      tabIndex={-1}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,.92)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <img
        src={src}
        alt="фото"
        style={{ maxWidth: '94vw', maxHeight: '88vh', objectFit: 'contain', borderRadius: 6 }}
        onClick={(event: MouseEvent<HTMLImageElement>) => event.stopPropagation()}
      />
      <button
        ref={closeButtonRef}
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        style={{
          position: 'absolute', top: 16, right: 16,
          background: 'rgba(0,0,0,.5)', border: 'none', color: '#fff',
          width: 36, height: 36, borderRadius: '50%', fontSize: 18, cursor: 'pointer',
        }}
        aria-label="Закрыть"
      ><AppIcon name="close" size={16} /></button>
    </div>,
    document.body
  );
}
